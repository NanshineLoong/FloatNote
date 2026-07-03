//! Selection-popup capture lifecycle: caches the eagerly-captured text,
//! emits the popup-payload event, and exposes submit/dismiss commands.

use std::sync::Mutex;

/// Holds the text captured by `run_popup_capture` until the user clicks
/// 「加入采集区」 (submit) or cancels. Single-slot cache: a new capture
/// overwrites any pending one.
pub struct PopupCache {
    text: Mutex<Option<String>>,
}

impl PopupCache {
    pub fn new() -> Self {
        Self {
            text: Mutex::new(None),
        }
    }

    pub fn set(&self, value: String) {
        *self.text.lock().unwrap() = Some(value);
    }

    /// Take the cached text, clearing the slot. Returns None if nothing cached.
    pub fn take(&self) -> Option<String> {
        self.text.lock().unwrap().take()
    }

    pub fn clear(&self) {
        *self.text.lock().unwrap() = None;
    }
}

impl Default for PopupCache {
    fn default() -> Self {
        Self::new()
    }
}

use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::AppState;

/// Payload emitted to the `selection-popup` window on capture.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PopupPayload {
    pub x: f64,
    pub y: f64,
    pub has_text: bool,
}

/// User clicked 「加入采集区」: format the cached text and forward it to the
/// note window exactly as the direct-capture path does.
#[tauri::command]
pub fn submit_popup_capture(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let text = match state.popup_cache.take() {
        Some(t) if !t.trim().is_empty() => t,
        _ => return Err("没有可加入的选中文本".to_string()),
    };
    let block = crate::quote::format_clip(text.trim());
    app.emit_to("main", "quote-captured", block)
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
    // Share capture.rs's guard so a popup capture and a direct capture can't
    // race the single shared system clipboard.
    let Some(_guard) = crate::capture::CaptureGuard::try_enter() else {
        return; // a capture is already in flight
    };

    if !crate::capture::check_accessibility(app) {
        return;
    }

    let text = crate::capture::read_selection_text(); // Option<String>
    let has_text = text.is_some();
    if let Some(ref t) = text {
        state_set(app, t.clone());
    }

    let (x, y) = crate::cursor::get_cursor_pos().unwrap_or((0.0, 0.0));

    let payload = PopupPayload { x, y, has_text };
    let _ = app.emit_to("selection-popup", "popup-payload", payload);
}

/// Helper: stash the captured text into the managed AppState.
fn state_set(app: &AppHandle, text: String) {
    if let Some(state) = app.try_state::<AppState>() {
        state.popup_cache.set(text);
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
        cache.set("hello".to_string());
        assert_eq!(cache.take().as_deref(), Some("hello"));
        // take clears the slot
        assert!(cache.take().is_none());
    }

    #[test]
    fn set_overwrites_previous() {
        let cache = PopupCache::new();
        cache.set("a".to_string());
        cache.set("b".to_string());
        assert_eq!(cache.take().as_deref(), Some("b"));
    }

    #[test]
    fn clear_drops_pending() {
        let cache = PopupCache::new();
        cache.set("x".to_string());
        cache.clear();
        assert!(cache.take().is_none());
    }
}
