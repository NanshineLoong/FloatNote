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
