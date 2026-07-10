//! Selection-popup capture lifecycle: caches the eagerly-captured text,
//! emits the popup-payload event, and exposes submit/dismiss commands.

use std::sync::Mutex;

/// Holds the text + source captured by `run_popup_capture` until the user
/// clicks 「加入采集区」 (submit) or cancels. Single-slot cache: a new capture
/// overwrites any pending one. `html` carries the clipboard's `text/html`
/// flavor so formatting survives the round-trip to the note window.
pub struct PopupCache {
    text: Mutex<Option<String>>,
    html: Mutex<Option<String>>,
    source: Mutex<Option<crate::source::Source>>,
}

impl PopupCache {
    pub fn new() -> Self {
        Self {
            text: Mutex::new(None),
            html: Mutex::new(None),
            source: Mutex::new(None),
        }
    }

    pub fn set(&self, text: String, html: Option<String>, source: Option<crate::source::Source>) {
        *self.text.lock().unwrap() = Some(text);
        *self.html.lock().unwrap() = html;
        *self.source.lock().unwrap() = source;
    }

    /// Take the cached (text, html, source), clearing all slots. Returns None
    /// if no text.
    pub fn take(&self) -> Option<(String, Option<String>, Option<crate::source::Source>)> {
        let text = self.text.lock().unwrap().take();
        let html = self.html.lock().unwrap().take();
        let source = self.source.lock().unwrap().take();
        text.map(|t| (t, html, source))
    }

    pub fn clear(&self) {
        *self.text.lock().unwrap() = None;
        *self.html.lock().unwrap() = None;
        *self.source.lock().unwrap() = None;
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
    pub has_text: bool,
}

/// User clicked 「加入采集区」: forward the cached {text, html, source} to the
/// note window exactly as the direct-capture path does.
#[tauri::command]
pub fn submit_popup_capture(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let (text, html, source) = match state.popup_cache.take() {
        Some((t, h, s)) if !t.trim().is_empty() => (t, h, s),
        _ => return Err("没有可加入的选中文本".to_string()),
    };
    let payload = crate::source::QuotePayload {
        text: text.trim().to_string(),
        html,
        source,
    };
    app.emit_to("main", "quote-captured", payload)
        .map_err(|e| format!("emit failed: {e}"))?;

    if let Some(window) = crate::windows::note_window(&app) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    // Hide the popup window (do not destroy it).
    if let Some(popup) = app.get_webview_window("selection-popup") {
        let _ = popup.hide();
    }
    Ok(())
}

/// User cancelled (Esc / focus lost / empty state). Hide popup, drop cache.
#[tauri::command]
pub fn dismiss_popup(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    state.popup_cache.clear();
    if let Some(popup) = app.get_webview_window("selection-popup") {
        let _ = popup.hide();
    }
    Ok(())
}

/// Global shortcut entry: eagerly capture the selection while the source app
/// is still focused, cache it, then tell the popup window to show at the cursor.
pub fn run_popup_capture(app: &AppHandle) {
    run_popup_capture_with(app, false);
}

/// Automatic-popup entry. `via_menu=true` first tries AX menu copy, which keeps
/// Option-held selection capture from being interpreted as Option+Cmd+C.
pub fn run_popup_capture_with(app: &AppHandle, via_menu: bool) {
    // Share capture.rs's guard so a popup capture and a direct capture can't
    // race the single shared system clipboard.
    let Some(_guard) = crate::capture::CaptureGuard::try_enter() else {
        return; // a capture is already in flight
    };

    if !crate::capture::check_accessibility(app) {
        return;
    }

    let captured = if via_menu {
        crate::capture::read_selection_via_menu().or_else(crate::capture::read_selection)
    } else {
        crate::capture::read_selection()
    };
    let has_text = captured.is_some();
    if let Some(ref c) = captured {
        // Source app is still frontmost here (popup window is shown only below).
        let source = crate::source::capture_source(app);
        state_set(app, c.text.clone(), c.html.clone(), source);
    }

    let (x, y) = crate::cursor::get_cursor_pos().unwrap_or((0.0, 0.0));

    let payload = PopupPayload { x, y, has_text };
    let _ = app.emit_to("selection-popup", "popup-payload", payload);
}

/// Helper: stash the captured text + html + source into the managed AppState.
fn state_set(
    app: &AppHandle,
    text: String,
    html: Option<String>,
    source: Option<crate::source::Source>,
) {
    if let Some(state) = app.try_state::<AppState>() {
        state.popup_cache.set(text, html, source);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_returns_none_when_empty() {
        let cache = PopupCache::new();
        assert!(cache.take().is_none());
    }

    #[test]
    fn set_then_take_roundtrips() {
        let cache = PopupCache::new();
        cache.set("hello".to_string(), None, None);
        let (t, h, s) = cache.take().unwrap();
        assert_eq!(t, "hello");
        assert!(h.is_none());
        assert!(s.is_none());
        // take clears the slot
        assert!(cache.take().is_none());
    }

    #[test]
    fn set_overwrites_previous() {
        let cache = PopupCache::new();
        cache.set("a".to_string(), None, None);
        cache.set("b".to_string(), Some("<b>x</b>".to_string()), None);
        let (t, h, _s) = cache.take().unwrap();
        assert_eq!(t, "b");
        assert_eq!(h.as_deref(), Some("<b>x</b>"));
    }

    #[test]
    fn clear_drops_pending() {
        let cache = PopupCache::new();
        cache.set("x".to_string(), None, None);
        cache.clear();
        assert!(cache.take().is_none());
    }
}
