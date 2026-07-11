//! Selection-popup capture lifecycle: caches the eagerly-captured text,
//! emits the popup-payload event, and exposes submit/dismiss commands.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// Holds the text + source captured by `run_popup_capture` until the user
/// clicks 「加入采集区」 (submit) or cancels. Single-slot cache: a new capture
/// overwrites any pending one. `html` carries the clipboard's `text/html`
/// flavor so formatting survives the round-trip to the note window.
pub struct PopupCache {
    next_generation: AtomicU64,
    session: Mutex<Option<PopupSession>>,
}

struct PopupSession {
    generation_id: u64,
    capture: Option<CachedCapture>,
}

struct CachedCapture {
    text: String,
    html: Option<String>,
    source: Option<crate::source::Source>,
}

impl PopupCache {
    pub fn new() -> Self {
        Self {
            next_generation: AtomicU64::new(0),
            session: Mutex::new(None),
        }
    }

    fn next_generation(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn set(
        &self,
        text: String,
        html: Option<String>,
        source: Option<crate::source::Source>,
    ) -> u64 {
        let generation_id = self.next_generation();
        *self.session.lock().unwrap() = Some(PopupSession {
            generation_id,
            capture: Some(CachedCapture { text, html, source }),
        });
        generation_id
    }

    pub fn begin_empty(&self) -> u64 {
        let generation_id = self.next_generation();
        *self.session.lock().unwrap() = Some(PopupSession {
            generation_id,
            capture: None,
        });
        generation_id
    }

    pub fn take(
        &self,
        generation_id: u64,
    ) -> Option<(String, Option<String>, Option<crate::source::Source>)> {
        let mut slot = self.session.lock().unwrap();
        if slot.as_ref()?.generation_id != generation_id {
            return None;
        }
        let capture = slot.take()?.capture?;
        Some((capture.text, capture.html, capture.source))
    }

    pub fn clear(&self) {
        *self.session.lock().unwrap() = None;
    }

    pub fn clear_if(&self, generation_id: u64) -> bool {
        let mut slot = self.session.lock().unwrap();
        if slot
            .as_ref()
            .is_some_and(|session| session.generation_id == generation_id)
        {
            *slot = None;
            true
        } else {
            false
        }
    }
}

impl Default for PopupCache {
    fn default() -> Self {
        Self::new()
    }
}

use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;

/// Payload emitted to the `selection-popup` window on capture.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PopupPayload {
    pub x: f64,
    pub y: f64,
    pub generation_id: u64,
    pub origin: PopupOrigin,
    pub has_text: bool,
}

#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PopupOrigin {
    Auto,
    Shortcut,
}

fn should_emit(origin: PopupOrigin, has_text: bool) -> bool {
    has_text || origin == PopupOrigin::Shortcut
}

/// User clicked 「加入采集区」: forward the cached {text, html, source} to the
/// note window exactly as the direct-capture path does.
#[tauri::command]
pub fn submit_popup_capture(
    generation_id: u64,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let (text, html, source) = match state.popup_cache.take(generation_id) {
        Some((t, h, s)) if !t.trim().is_empty() => (t, h, s),
        _ => return Err("选区已失效或没有可加入的文本".to_string()),
    };
    let payload = crate::source::QuotePayload {
        text: text.trim().to_string(),
        html,
        source,
    };
    app.emit_to("main", "quote-captured", payload)
        .map_err(|e| format!("emit failed: {e}"))?;

    // Hide the popup window (do not destroy it).
    if let Some(popup) = app.get_webview_window("selection-popup") {
        let _ = popup.hide();
    }
    Ok(())
}

/// User cancelled (Esc / focus lost / empty state). Hide popup, drop cache.
#[tauri::command]
pub fn dismiss_popup(
    generation_id: Option<u64>,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let should_hide = if let Some(generation_id) = generation_id {
        state.popup_cache.clear_if(generation_id)
    } else {
        state.popup_cache.clear();
        true
    };
    if should_hide {
        if let Some(popup) = app.get_webview_window("selection-popup") {
            let _ = popup.hide();
        }
    }
    Ok(())
}

/// Global shortcut entry: eagerly capture the selection while the source app
/// is still focused, cache it, then tell the popup window to show at the cursor.
pub fn run_popup_capture(app: &AppHandle) {
    run_popup_capture_with_origin(app, PopupOrigin::Shortcut, None);
}

pub fn run_auto_popup_capture(app: &AppHandle, selection_event: u64) {
    run_popup_capture_with_origin(app, PopupOrigin::Auto, Some(selection_event));
}

fn run_popup_capture_with_origin(
    app: &AppHandle,
    origin: PopupOrigin,
    selection_event: Option<u64>,
) {
    // Share capture.rs's guard so a popup capture and a direct capture can't
    // race the single shared system clipboard.
    let Some(_guard) = crate::capture::CaptureGuard::try_enter() else {
        return; // a capture is already in flight
    };

    if !crate::capture::check_accessibility(app) {
        return;
    }

    let captured = crate::capture::capture_current_selection(app);
    if selection_event
        .is_some_and(|event| !crate::selection_monitor::is_current_selection_event(event))
    {
        return;
    }
    let has_text = captured.is_some();
    if !should_emit(origin, has_text) {
        return;
    }
    let generation_id = if let Some(ref c) = captured {
        // Source app is still frontmost here (popup window is shown only below).
        let source = crate::source::capture_source(app);
        state_set(app, c.text.clone(), c.html.clone(), source).unwrap_or(0)
    } else {
        state_begin_empty(app).unwrap_or(0)
    };
    if generation_id == 0 {
        return;
    }

    let (x, y) = crate::cursor::get_cursor_pos().unwrap_or((0.0, 0.0));

    let payload = PopupPayload {
        x,
        y,
        generation_id,
        origin,
        has_text,
    };
    let _ = app.emit_to("selection-popup", "popup-payload", payload);
}

/// Helper: stash the captured text + html + source into the managed AppState.
fn state_set(
    app: &AppHandle,
    text: String,
    html: Option<String>,
    source: Option<crate::source::Source>,
) -> Option<u64> {
    if let Some(state) = app.try_state::<AppState>() {
        return Some(state.popup_cache.set(text, html, source));
    }
    None
}

fn state_begin_empty(app: &AppHandle) -> Option<u64> {
    app.try_state::<AppState>()
        .map(|state| state.popup_cache.begin_empty())
}

pub fn dismiss_active(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.popup_cache.clear();
    }
    if let Some(popup) = app.get_webview_window("selection-popup") {
        let _ = popup.hide();
    }
}

pub fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window("selection-popup")
        .and_then(|popup| popup.is_visible().ok())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_returns_none_when_empty() {
        let cache = PopupCache::new();
        assert!(cache.take(1).is_none());
    }

    #[test]
    fn set_then_take_matching_generation_roundtrips() {
        let cache = PopupCache::new();
        let generation = cache.set("hello".to_string(), None, None);
        let (t, h, s) = cache.take(generation).unwrap();
        assert_eq!(t, "hello");
        assert!(h.is_none());
        assert!(s.is_none());
        assert!(cache.take(generation).is_none());
    }

    #[test]
    fn stale_generation_cannot_take_new_capture() {
        let cache = PopupCache::new();
        let stale = cache.set("a".to_string(), None, None);
        let current = cache.set("b".to_string(), Some("<b>x</b>".to_string()), None);
        assert!(cache.take(stale).is_none());
        let (t, h, _s) = cache.take(current).unwrap();
        assert_eq!(t, "b");
        assert_eq!(h.as_deref(), Some("<b>x</b>"));
    }

    #[test]
    fn stale_generation_cannot_dismiss_new_capture() {
        let cache = PopupCache::new();
        let stale = cache.set("a".to_string(), None, None);
        let current = cache.set("b".to_string(), None, None);
        assert!(!cache.clear_if(stale));
        assert!(cache.take(current).is_some());
    }

    #[test]
    fn empty_shortcut_session_can_be_dismissed_by_generation() {
        let cache = PopupCache::new();
        let generation = cache.begin_empty();
        assert!(cache.clear_if(generation));
        assert!(!cache.clear_if(generation));
    }

    #[test]
    fn automatic_empty_capture_is_silent_but_shortcut_can_report_it() {
        assert!(!should_emit(PopupOrigin::Auto, false));
        assert!(should_emit(PopupOrigin::Shortcut, false));
        assert!(should_emit(PopupOrigin::Auto, true));
    }
}
