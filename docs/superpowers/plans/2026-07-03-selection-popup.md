# Selection Popup (划词悬浮窗) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global-shortcut-triggered floating popup that captures the current text selection in any foreground macOS app, lets the user click 「加入采集区」, and appends it as a `> [!quote]` callout into the note capture area via the existing `quote-captured` pipeline.

**Architecture:** A new `selection-popup` webview window (transparent, frameless, always-on-top) is pre-declared in `tauri.conf.json` and shown/hidden on demand. A new global shortcut (`Alt+Cmd+P`, configurable) triggers `run_popup_capture`, which *eagerly* simulates Cmd+C and reads the clipboard while the source app is still focused, caches the text in `AppState`, then emits a `popup-payload` event (cursor coords + hasText) to the popup window. The popup positions itself at the cursor and shows buttons; clicking 「加入采集区」 invokes `submit_popup_capture`, which formats the cached text via `quote::format_clip` and emits `quote-captured` to the `main` window — reusing the existing `main.ts` listener, `insertAtCaret`, autosave, and `write_note` unchanged.

**Tech Stack:** Tauri 2 (Rust backend, vanilla TS/Vite frontend), `tauri-plugin-global-shortcut`, `core-graphics` 0.25 (cursor position), `arboard` 3 (clipboard), `macos-accessibility-client` (a11y check), Vitest.

## Global Constraints

- **Platform:** macOS only for this plan. All `simulate_copy` / `get_cursor_pos` code is gated behind `#[cfg(target_os = "macos")]` with non-macOS stubs returning errors/`None`, matching the existing `capture.rs` pattern.
- **Coding style (Rust):** `rustfmt`, snake_case modules/functions, `serde`-serializable command payloads, two-space indent.
- **Coding style (TS):** ES modules, explicit imports, two-space indent, double quotes, semicolons, camelCase.
- **No new Tauri core permissions** beyond what `capabilities/default.json` already grants (`set-position`, `set-size`, `set-always-on-top`, `set-focus`, `set-ignore-cursor-events`, `cursor-position`, `start-dragging` are all present). The `selection-popup` window label must be added to the capabilities `windows` array.
- **macOSPrivateApi** is already enabled at app level (`tauri.conf.json:14` + `Cargo.toml:18`), so transparent + always-on-top windows work.
- **Reuse rule:** `quote::format_clip`, the `main.ts:521` `quote-captured` listener, `append.ts::buildCaretInsert`, `editor::insertAtCaret`, and `write_note` must NOT be modified. `notes.rs` is untouched.
- **Tests:** `npm test` (Vitest) before submitting TS changes; `cargo check` (and `cargo test` where unit tests exist) from `src-tauri/` before submitting Rust changes. Verify the live flow with `npm run tauri dev`.
- **Commits:** short imperative subjects, conventional prefix, end with `Co-Authored-By: Claude <noreply@anthropic.com>`.

**Reference spec:** `docs/superpowers/specs/2026-07-03-selection-popup-design.md`

---

## File Structure

New files:
- `src-tauri/src/cursor.rs` — global cursor position (macOS `CGEvent`), plus a pure `to_logical` helper. Responsibility: "where is the mouse on screen".
- `src-tauri/src/popup.rs` — `PopupCache` (Mutex<Option<String>>), `PopupPayload` serde struct, `run_popup_capture(app)`, and the `submit_popup_capture` / `dismiss_popup` Tauri commands. Responsibility: the popup capture/submit lifecycle.
- `popup.html` — Vite entry page for the popup window. Responsibility: load `src/popup/main.ts`.
- `src/popup/main.ts` — popup frontend: listen for `popup-payload`, clamp+position+show, button handlers, Esc/focus-loss dismiss, empty-state auto-hide. Responsibility: popup UI behavior.
- `src/popup/clamp.ts` — pure `clampToScreen` helper. Responsibility: keep the popup on-screen.
- `src/popup/clamp.test.ts` — Vitest for `clampToScreen`.
- `src/popup/styles.css` — popup styles.

Modified files:
- `src-tauri/src/config.rs` — add `shortcut_popup` field + default.
- `src-tauri/src/commands.rs` — add `popup_cache: PopupCache` to `AppState`; extend `apply_shortcuts` with a `popup` param.
- `src-tauri/src/shortcuts.rs` — `apply` gains a `popup` param; register a third chord.
- `src-tauri/src/capture.rs` — extract `check_accessibility` and `read_selection_text` helpers (behavior-preserving) for reuse by `popup.rs`.
- `src-tauri/src/lib.rs` — register `cursor`/`popup` modules, init `popup_cache` in `AppState`, pass `shortcut_popup` to `shortcuts::apply`, register the two new commands.
- `src-tauri/tauri.conf.json` — add the `selection-popup` window.
- `src-tauri/capabilities/default.json` — add `"selection-popup"` to the `windows` array.
- `vite.config.ts` — add `popup` build entry.
- `src/settings/main.ts` — add `shortcut_popup` to the `Config` interface and a third `KeyRecorder` row; include it in `apply_shortcuts` and `set_config` calls.

---

### Task 1: Add `shortcut_popup` config field

**Files:**
- Modify: `src-tauri/src/config.rs`
- Test: `src-tauri/src/config.rs` (inline `#[cfg(test)]`)

**Interfaces:**
- Produces: `Config.shortcut_popup: String` (default `"Alt+Cmd+P"`), serialized as `shortcut_popup` in JSON. Consumed by Task 6 (`shortcuts::apply`) and Task 9 (settings UI).

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/config.rs` (after the `roundtrip` test, before the closing `}`):

```rust
    #[test]
    fn popup_shortcut_has_default() {
        let config = Config::default();
        assert_eq!(config.shortcut_popup, "Alt+Cmd+P");
    }

    #[test]
    fn partial_json_keeps_popup_default() {
        let config: Config = serde_json::from_str(r#"{"font_size":20}"#).unwrap();
        assert_eq!(config.shortcut_popup, "Alt+Cmd+P");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml config::tests`
Expected: COMPILE ERROR — `no field 'shortcut_popup' on type 'Config'`.

- [ ] **Step 3: Add the field and default**

In `src-tauri/src/config.rs`, add the field to the struct (after `shortcut_toggle`):

```rust
    pub shortcut_capture: String,
    pub shortcut_toggle: String,
    /// 划词悬浮窗快捷键（弹窗式抓取），默认 ⌥⌘P。与 shortcut_capture（直接抓取）独立。
    pub shortcut_popup: String,
```

Add the default in `impl Default for Config` (after `shortcut_toggle`):

```rust
            shortcut_capture: "Alt+Cmd+C".to_string(),
            shortcut_toggle: "Alt+Cmd+N".to_string(),
            shortcut_popup: "Alt+Cmd+P".to_string(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml config::tests`
Expected: PASS (5 tests, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/config.rs
git commit -m "feat(config): add shortcut_popup field (Alt+Cmd+P)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `cursor.rs` — global cursor position

**Files:**
- Create: `src-tauri/src/cursor.rs`
- Modify: `src-tauri/src/lib.rs` (register module)
- Test: `src-tauri/src/cursor.rs` (inline `#[cfg(test)]`)

**Interfaces:**
- Consumes: `core_graphics` crate (already in `Cargo.toml:26` under macOS deps).
- Produces: `cursor::get_cursor_pos() -> Option<(f64, f64)>` — global cursor in logical screen points; `None` on non-macOS or failure. Also pure helper `cursor::to_logical(x, y, scale) -> (f64, f64)`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/cursor.rs`:

```rust
//! Global mouse cursor position.

/// Convert physical pixels to logical points given a scale factor.
/// Pure helper, unit-tested.
pub fn to_logical(x: f64, y: f64, scale: f64) -> (f64, f64) {
    if scale <= 0.0 {
        (x, y)
    } else {
        (x / scale, y / scale)
    }
}

#[cfg(target_os = "macos")]
pub fn get_cursor_pos() -> Option<(f64, f64)> {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
    // A freshly-created event's location is the current cursor position.
    let event = CGEvent::new(source).ok()?;
    let loc = event.location();
    Some((loc.x, loc.y))
}

#[cfg(not(target_os = "macos"))]
pub fn get_cursor_pos() -> Option<(f64, f64)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_logical_divides_by_scale() {
        assert_eq!(to_logical(200.0, 100.0, 2.0), (100.0, 50.0));
    }

    #[test]
    fn to_logical_identity_at_scale_one() {
        assert_eq!(to_logical(123.0, 456.0, 1.0), (123.0, 456.0));
    }

    #[test]
    fn to_logical_passthrough_on_zero_scale() {
        assert_eq!(to_logical(200.0, 100.0, 0.0), (200.0, 100.0));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cursor`
Expected: COMPILE ERROR — `error[E0433]: failed to resolve: use of undeclared crate or module 'cursor'` (module not declared in `lib.rs`).

- [ ] **Step 3: Register the module**

In `src-tauri/src/lib.rs`, add to the module list (keep alphabetical, after `mod commands;`):

```rust
mod agent;
mod capture;
mod commands;
mod config;
mod cursor;
mod notes;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cursor`
Expected: PASS (3 tests).

- [ ] **Step 5: Run cargo check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/cursor.rs src-tauri/src/lib.rs
git commit -m "feat(cursor): add global cursor position module

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: `PopupCache` + `AppState` field

**Files:**
- Create: `src-tauri/src/popup.rs` (skeleton with `PopupCache` only)
- Modify: `src-tauri/src/commands.rs` (add field to `AppState`)
- Modify: `src-tauri/src/lib.rs` (register module, init field)
- Test: `src-tauri/src/popup.rs` (inline)

**Interfaces:**
- Produces: `popup::PopupCache` struct with `new()`, `set(String)`, `take() -> Option<String>`, `clear()`. `AppState.popup_cache: PopupCache`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/popup.rs`:

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml popup`
Expected: COMPILE ERROR — module not declared in `lib.rs`.

- [ ] **Step 3: Register module and add to AppState**

In `src-tauri/src/lib.rs`, add `mod popup;` (after `mod notes;`, before `mod project;` to stay alphabetical — actually place after `mod project;` is wrong; insert between `notes` and `project`):

```rust
mod notes;
mod popup;
mod project;
```

In `src-tauri/src/commands.rs`, add the field to `AppState` (after `write_suppress`):

```rust
    /// 自身写入抑制表，与 watcher 共享。
    pub write_suppress: SuppressList,
    /// 划词弹窗急切抓取的待提交文本。
    pub popup_cache: crate::popup::PopupCache,
```

In `src-tauri/src/lib.rs`, initialize the field in the `app.manage(AppState { ... })` block (after `write_suppress,`):

```rust
                write_suppress,
                popup_cache: crate::popup::PopupCache::new(),
            });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml popup`
Expected: PASS (4 tests).

- [ ] **Step 5: Run cargo check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/popup.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(popup): add PopupCache and AppState field

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: `submit_popup_capture` / `dismiss_popup` commands

**Files:**
- Modify: `src-tauri/src/popup.rs` (add commands + `PopupPayload`)
- Modify: `src-tauri/src/lib.rs` (register commands)

**Interfaces:**
- Produces: Tauri commands `submit_popup_capture(state: State<AppState>) -> Result<(), String>` and `dismiss_popup(state: State<AppState>, app: AppHandle) -> Result<(), String>`. `PopupPayload { x: f64, y: f64, has_text: bool }` (serde camelCase → `{ x, y, hasText }`).
- Consumes: `crate::quote::format_clip`, `AppState.popup_cache`, `crate::windows::note_window` (for focus after submit).

- [ ] **Step 1: Add the payload struct and commands**

Append to `src-tauri/src/popup.rs` (below `impl Default for PopupCache`):

```rust
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
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` list (after `commands::apply_shortcuts,`):

```rust
            commands::apply_shortcuts,
            popup::submit_popup_capture,
            popup::dismiss_popup,
        ])
```

- [ ] **Step 3: Run cargo check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean. (If `Emitter`/`Manager` import conflicts arise, ensure `use tauri::{AppHandle, Emitter, Manager, State};` is at the top of the appended block — it is. `lib.rs` already has `use tauri::{Manager, WindowEvent};` separately, which is fine.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/popup.rs src-tauri/src/lib.rs
git commit -m "feat(popup): add submit/dismiss commands

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Extract shared capture helpers + `run_popup_capture`

**Files:**
- Modify: `src-tauri/src/capture.rs` (extract `check_accessibility` + `read_selection_text`)
- Modify: `src-tauri/src/popup.rs` (add `run_popup_capture`)
- Modify: `src-tauri/src/shortcuts.rs` is NOT touched yet (Task 6 wires the shortcut)

**Interfaces:**
- Produces: `capture::check_accessibility(app: &AppHandle) -> bool` (returns false + emits `accessibility-needed` if untrusted; true if ok or non-macOS), `capture::read_selection_text() -> Option<String>` (backup clipboard → simulate_copy → read → restore → trim; None if empty/failed). `popup::run_popup_capture(app: &AppHandle)`.

- [ ] **Step 1: Extract helpers in `capture.rs` (behavior-preserving)**

In `src-tauri/src/capture.rs`, add these two pub functions (place them above `pub fn run_capture`):

```rust
/// macOS Accessibility trust check. Returns true if capture may proceed.
/// On macOS, if untrusted, prompts once and emits `accessibility-needed` to
/// the `main` window; returns false. On non-macOS, returns true (the actual
/// capture stub will fail later with a clear error).
pub fn check_accessibility(app: &AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        static PROMPTED: AtomicBool = AtomicBool::new(false);
        if !macos_accessibility_client::accessibility::application_is_trusted() {
            log_line("accessibility NOT trusted — cannot simulate Cmd+C");
            if !PROMPTED.swap(true, Ordering::SeqCst) {
                macos_accessibility_client::accessibility::application_is_trusted_with_prompt();
            }
            let _ = app.emit_to("main", "accessibility-needed", ());
            return false;
        }
    }
    let _ = app;
    true
}

/// Backup clipboard, simulate Cmd+C, read the new clipboard content, restore.
/// Returns the trimmed selection text, or None if empty or on failure.
pub fn read_selection_text() -> Option<String> {
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(error) => {
            log_line(&format!("clipboard init error: {error}"));
            return None;
        }
    };
    let backup = clipboard.get_text().ok();
    let _ = clipboard.set_text(String::new());

    if let Err(error) = simulate_copy() {
        log_line(&format!("simulate_copy error: {error}"));
        if let Some(text) = backup {
            let _ = clipboard.set_text(text);
        }
        return None;
    }

    std::thread::sleep(std::time::Duration::from_millis(150));
    let selection = clipboard.get_text().unwrap_or_default();
    log_line(&format!("selection len = {}", selection.len()));

    match backup {
        Some(text) => {
            let _ = clipboard.set_text(text);
        }
        None => {
            let _ = clipboard.set_text(String::new());
        }
    }

    let trimmed = selection.trim().to_string();
    if trimmed.is_empty() {
        log_line("empty selection, ignoring");
        None
    } else {
        Some(trimmed)
    }
}
```

Now refactor `pub fn run_capture` to use them. Replace the body of `run_capture` (from line 50 through line 122) with:

```rust
pub fn run_capture(app: &AppHandle) {
    let Some(_guard) = CaptureGuard::try_enter() else {
        log_line("already capturing, skipping");
        return;
    };

    if !check_accessibility(app) {
        return;
    }

    log_line("fired");

    let Some(trimmed) = read_selection_text() else {
        return;
    };

    let block = crate::quote::format_clip(&trimmed);
    let _ = app.emit_to("main", "quote-captured", block);

    if let Some(window) = crate::windows::note_window(app) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}
```

Leave the `CaptureGuard`, `log_line`, `cg` module, and `simulate_copy` exactly as they are. The `Ordering` import is already present (`use std::sync::atomic::{AtomicBool, Ordering};` at line 1).

- [ ] **Step 2: Run cargo test to confirm no regression in quote tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (cursor, popup, config, quote tests all green; no new failures).

- [ ] **Step 3: Add `run_popup_capture` to `popup.rs`**

Append to `src-tauri/src/popup.rs` (below `dismiss_popup`):

```rust
use std::sync::atomic::{AtomicBool, Ordering};

/// Re-entrancy guard shared with `capture::run_capture` so a popup capture and
/// a direct capture can't race the single shared clipboard.
static CAPTURING: AtomicBool = AtomicBool::new(false);

/// Global shortcut entry: eagerly capture the selection while the source app
/// is still focused, cache it, then tell the popup window to show at the cursor.
pub fn run_popup_capture(app: &AppHandle) {
    if CAPTURING.swap(true, Ordering::SeqCst) {
        return; // a capture is already in flight
    }
    // Always release the guard on return.
    struct ReleaseGuard;
    impl Drop for ReleaseGuard {
        fn drop(&mut self) {
            CAPTURING.store(false, Ordering::SeqCst);
        }
    }
    let _guard = ReleaseGuard;

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
```

- [ ] **Step 4: Run cargo check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/capture.rs src-tauri/src/popup.rs
git commit -m "feat(popup): run_popup_capture eager capture + shared helpers

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Wire the `shortcut_popup` chord

**Files:**
- Modify: `src-tauri/src/shortcuts.rs`
- Modify: `src-tauri/src/commands.rs` (`apply_shortcuts` signature)
- Modify: `src-tauri/src/lib.rs` (pass popup to `apply` at startup)

**Interfaces:**
- Produces: `shortcuts::apply(app, capture, toggle, popup)`; `commands::apply_shortcuts(app, capture, toggle, popup)`.
- Consumes: `Config.shortcut_popup` (Task 1), `popup::run_popup_capture` (Task 5).

- [ ] **Step 1: Extend `shortcuts::apply`**

Replace the entire contents of `src-tauri/src/shortcuts.rs` with:

```rust
use std::str::FromStr;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub fn apply(
    app: &AppHandle,
    capture: &str,
    toggle: &str,
    popup: &str,
) -> Result<(), String> {
    let global_shortcut = app.global_shortcut();
    let _ = global_shortcut.unregister_all();

    let capture_shortcut =
        Shortcut::from_str(capture).map_err(|error| format!("capture: {error:?}"))?;
    let toggle_shortcut =
        Shortcut::from_str(toggle).map_err(|error| format!("toggle: {error:?}"))?;
    let popup_shortcut =
        Shortcut::from_str(popup).map_err(|error| format!("popup: {error:?}"))?;

    let capture_app = app.clone();
    global_shortcut
        .on_shortcut(capture_shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                crate::capture::run_capture(&capture_app);
            }
        })
        .map_err(|error| format!("register capture: {error:?}"))?;

    let toggle_app = app.clone();
    global_shortcut
        .on_shortcut(toggle_shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                crate::windows::toggle_note(&toggle_app);
            }
        })
        .map_err(|error| format!("register toggle: {error:?}"))?;

    let popup_app = app.clone();
    global_shortcut
        .on_shortcut(popup_shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                crate::popup::run_popup_capture(&popup_app);
            }
        })
        .map_err(|error| format!("register popup: {error:?}"))?;

    Ok(())
}
```

- [ ] **Step 2: Update `apply_shortcuts` command**

In `src-tauri/src/commands.rs`, replace the `apply_shortcuts` function (line 242-245) with:

```rust
#[tauri::command]
pub fn apply_shortcuts(
    app: tauri::AppHandle,
    capture: String,
    toggle: String,
    popup: String,
) -> Result<(), String> {
    crate::shortcuts::apply(&app, &capture, &toggle, &popup)
}
```

- [ ] **Step 3: Pass popup at startup**

In `src-tauri/src/lib.rs`, update the startup `shortcuts::apply` call (lines 90-97) to pass the popup shortcut:

```rust
            {
                let config = app.state::<AppState>().config.lock().unwrap().clone();
                if let Err(error) = shortcuts::apply(
                    app.handle(),
                    &config.shortcut_capture,
                    &config.shortcut_toggle,
                    &config.shortcut_popup,
                ) {
                    eprintln!("shortcut registration failed: {error}");
                }
            }
```

- [ ] **Step 4: Run cargo check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean. (The settings UI still calls `apply_shortcuts` with only `{ capture, toggle }` — that call is updated in Task 9. Until then, `npm run tauri dev` settings-save would fail, but `cargo check`/`cargo test` do not invoke it. Do NOT run the app until Task 9.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/shortcuts.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(shortcuts): register configurable popup shortcut

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: `selection-popup` window, capabilities, Vite entry

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `vite.config.ts`
- Create: `popup.html`

**Interfaces:**
- Produces: a `selection-popup` webview window backed by `popup.html`; `popup` Vite build entry.

- [ ] **Step 1: Add the window to `tauri.conf.json`**

In `src-tauri/tauri.conf.json`, add a third entry to the `windows` array (after the `settings` entry, before the closing `]`):

```json
      {
        "label": "selection-popup",
        "url": "popup.html",
        "width": 208,
        "height": 56,
        "transparent": true,
        "decorations": false,
        "alwaysOnTop": true,
        "resizable": false,
        "visible": false,
        "skipTaskbar": true,
        "hiddenTitle": true,
        "titleBarStyle": "Overlay"
      }
```

- [ ] **Step 2: Add the window label to capabilities**

In `src-tauri/capabilities/default.json`, change the `windows` array (line 5) to:

```json
  "windows": ["main", "settings", "assistant", "selection-popup"],
```

- [ ] **Step 3: Add the Vite entry**

In `vite.config.ts`, replace the `input` block (lines 9-12) with:

```ts
      input: {
        main: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
        popup: resolve(__dirname, "popup.html"),
      },
```

- [ ] **Step 4: Create `popup.html`**

Create `popup.html` at the repo root (next to `index.html` and `settings.html`):

```html
<!DOCTYPE html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FloatNote Popup</title>
  </head>
  <body>
    <div id="popup" class="popup-root" hidden>
      <div id="popup-empty" class="popup-empty" hidden>未识别到选中文本</div>
      <div id="popup-actions" class="popup-actions">
        <button id="btn-capture" class="popup-btn popup-btn-primary" type="button">加入采集区</button>
        <button id="btn-translate" class="popup-btn popup-btn-ghost" type="button" disabled>翻译</button>
        <button id="btn-ask" class="popup-btn popup-btn-ghost" type="button" disabled>提问</button>
      </div>
    </div>
    <script type="module" src="/src/popup/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Run cargo check + npm run build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

Run: `npm run build`
Expected: builds; `tsc` will fail because `src/popup/main.ts` and `src/popup/styles.css` do not exist yet — that is expected and fixed in Task 8. If `tsc` complains only about the missing `main.ts` import, proceed. (If you want a green build here, create a one-line stub `src/popup/main.ts` containing `console.log("popup");` and an empty `src/popup/styles.css`, then revert the stub in Task 8.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json vite.config.ts popup.html
git commit -m "feat(popup): add selection-popup window and vite entry

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Popup frontend (`clamp.ts`, `main.ts`, styles)

**Files:**
- Create: `src/popup/clamp.ts`
- Create: `src/popup/clamp.test.ts`
- Create: `src/popup/main.ts`
- Create: `src/popup/styles.css`

**Interfaces:**
- Consumes: Tauri `listen` (`@tauri-apps/api/event`), `getCurrentWindow` + `LogicalPosition` (`@tauri-apps/api/window`), `invoke` (`@tauri-apps/api/core`); backend `popup-payload` event (`{ x, y, hasText }`), `submit_popup_capture`, `dismiss_popup` commands.
- Produces: a popup that positions at the cursor, shows buttons, submits on click, dismisses on Esc/focus-loss, and shows an empty state when `hasText` is false.

- [ ] **Step 1: Write the failing test for `clampToScreen`**

Create `src/popup/clamp.ts`:

```ts
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Clamp the popup's top-left (x, y) so a w×h popup stays within `bounds`.
 * Bounds are logical screen coordinates (minX/minY may be negative on
 * multi-monitor layouts with displays to the left/above the primary).
 */
export function clampToScreen(
  x: number,
  y: number,
  w: number,
  h: number,
  bounds: Rect,
): { x: number; y: number } {
  const minX = bounds.minX;
  const maxX = bounds.maxX - w;
  const minY = bounds.minY;
  const maxY = bounds.maxY - h;

  const cx = Math.min(Math.max(x, minX), Math.max(minX, maxX));
  const cy = Math.min(Math.max(y, minY), Math.max(minY, maxY));
  return { x: cx, y: cy };
}
```

Create `src/popup/clamp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clampToScreen } from "./clamp";

describe("clampToScreen", () => {
  const screen = { minX: 0, minY: 0, maxX: 1920, maxY: 1080 };

  it("leaves a position unchanged when fully inside", () => {
    expect(clampToScreen(500, 500, 208, 56, screen)).toEqual({ x: 500, y: 500 });
  });

  it("clamps to the right edge", () => {
    const { x, y } = clampToScreen(1900, 500, 208, 56, screen);
    expect(x).toBe(1920 - 208);
    expect(y).toBe(500);
  });

  it("clamps to the bottom edge", () => {
    const { x, y } = clampToScreen(500, 1060, 208, 56, screen);
    expect(x).toBe(500);
    expect(y).toBe(1080 - 56);
  });

  it("clamps a negative cursor on a left-side monitor", () => {
    const leftMonitor = { minX: -1920, minY: 0, maxX: 0, maxY: 1080 };
    const { x, y } = clampToScreen(-2000, 1060, 208, 56, leftMonitor);
    expect(x).toBe(-1920);
    expect(y).toBe(1080 - 56);
  });

  it("clamps a top-left cursor on a negative-origin monitor", () => {
    const leftMonitor = { minX: -1920, minY: -1080, maxX: 0, maxY: 0 };
    const { x, y } = clampToScreen(-2000, -1100, 208, 56, leftMonitor);
    expect(x).toBe(-1920);
    expect(y).toBe(-1080);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/popup/clamp.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./clamp"` (file not found) — but it was created in Step 1, so this should actually PASS. If it passes on first run, that is fine — the test is written alongside the implementation (the helper has no dependencies). Proceed.

- [ ] **Step 3: Write the popup frontend**

Create `src/popup/styles.css`:

```css
:root {
  --popup-bg: rgba(32, 32, 36, 0.96);
  --popup-text: #f5f5f5;
  --popup-primary: #4c8dff;
  --popup-ghost-border: rgba(255, 255, 255, 0.18);
  --popup-ghost-text: rgba(255, 255, 255, 0.55);
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  overflow: hidden;
  user-select: none;
}

.popup-root {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  padding: 6px 8px;
}

.popup-actions {
  display: flex;
  gap: 6px;
  background: var(--popup-bg);
  padding: 6px;
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
}

.popup-empty {
  background: var(--popup-bg);
  color: var(--popup-ghost-text);
  padding: 8px 14px;
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.popup-btn {
  appearance: none;
  border: none;
  border-radius: 7px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.popup-btn:disabled {
  cursor: default;
}

.popup-btn-primary {
  background: var(--popup-primary);
  color: #fff;
}

.popup-btn-primary:disabled {
  opacity: 0.45;
}

.popup-btn-ghost {
  background: transparent;
  color: var(--popup-ghost-text);
  border: 1px solid var(--popup-ghost-border);
}

.popup-btn-ghost:disabled {
  opacity: 0.5;
}
```

Create `src/popup/main.ts`:

```ts
import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { clampToScreen, type Rect } from "./clamp";

const POPUP_W = 208;
const POPUP_H = 56;

interface PopupPayload {
  x: number;
  y: number;
  hasText: boolean;
}

const root = document.querySelector<HTMLElement>("#popup")!;
const emptyEl = document.querySelector<HTMLElement>("#popup-empty")!;
const actionsEl = document.querySelector<HTMLElement>("#popup-actions")!;
const captureBtn = document.querySelector<HTMLButtonElement>("#btn-capture")!;

let hideTimer: number | null = null;
let unlistenFocus: (() => void) | null = null;

function clearHideTimer(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

async function dismiss(): Promise<void> {
  clearHideTimer();
  try {
    await invoke("dismiss_popup");
  } catch {
    // ignore — window may already be hidden
  }
}

function renderState(hasText: boolean): void {
  if (hasText) {
    emptyEl.hidden = true;
    actionsEl.hidden = false;
    captureBtn.disabled = false;
  } else {
    actionsEl.hidden = true;
    emptyEl.hidden = false;
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      void dismiss();
    }, 3000);
  }
}

async function getBoundsAt(x: number, y: number): Promise<Rect> {
  const win = getCurrentWindow();
  // Move to the cursor first so currentMonitor() reports the monitor the
  // cursor is on (handles multi-monitor layouts).
  await win.setPosition(new LogicalPosition(x, y));
  const monitor = await win.currentMonitor();
  if (!monitor) {
    // Fallback: no clamp.
    return { minX: x - 100, minY: y - 100, maxX: x + 1920, maxY: y + 1080 };
  }
  const sf = monitor.scaleFactor || (await win.scaleFactor()) || 1;
  const mx = monitor.position.x / sf;
  const my = monitor.position.y / sf;
  return {
    minX: mx,
    minY: my,
    maxX: mx + monitor.size.width / sf,
    maxY: my + monitor.size.height / sf,
  };
}

async function showAt(x: number, y: number, hasText: boolean): Promise<void> {
  const bounds = await getBoundsAt(x, y);
  const { x: cx, y: cy } = clampToScreen(x, y, POPUP_W, POPUP_H, bounds);
  const win = getCurrentWindow();
  await win.setPosition(new LogicalPosition(cx, cy));
  renderState(hasText);
  root.hidden = false;
  await win.show();
  await win.setFocus();
}

async function onSubmit(): Promise<void> {
  try {
    await invoke("submit_popup_capture");
  } catch (error) {
    console.error("submit_popup_capture failed", error);
  }
}

async function setupListeners(): Promise<void> {
  await listen<PopupPayload>("popup-payload", (event) => {
    void showAt(event.payload.x, event.payload.y, event.payload.hasText);
  });

  unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    // Dismiss when the popup loses focus (user clicked elsewhere).
    if (!focused) {
      void dismiss();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      void dismiss();
    }
  });

  captureBtn.addEventListener("click", () => {
    void onSubmit();
  });
}

void setupListeners();
```

- [ ] **Step 4: Run tests and build**

Run: `npx vitest run src/popup/clamp.test.ts`
Expected: PASS (5 tests).

Run: `npm test`
Expected: all tests PASS (existing + new clamp tests).

Run: `npm run build`
Expected: `tsc` clean + Vite build succeeds (now that `main.ts` and `styles.css` exist).

- [ ] **Step 5: Commit**

```bash
git add src/popup/
git commit -m "feat(popup): popup frontend with clamp positioning

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Settings UI — third keybinding field

**Files:**
- Modify: `src/settings/main.ts`

**Interfaces:**
- Consumes: `Config.shortcut_popup` (Task 1); `apply_shortcuts` now takes `popup` (Task 6); `KeyRecorder` (`src/settings/key-recorder.ts`).

- [ ] **Step 1: Add `shortcut_popup` to the settings `Config` interface**

In `src/settings/main.ts`, add to the `Config` interface (after `shortcut_toggle`):

```ts
interface Config {
  working_dir: string | null;
  shortcut_capture: string;
  shortcut_toggle: string;
  shortcut_popup: string;
  font_size: number;
  launch_at_login: boolean;
  ai_provider: string;
  ai_model: string;
  ai_api_key: string;
  ai_base_url: string;
}
```

- [ ] **Step 2: Add the third recorder row to the settings HTML**

In the 快捷键 section (after the `recorder-toggle` row, before the closing `</section>` of that section — i.e. after line 72), add:

```html
        <div class="settings-row">
          <label class="settings-label">划词弹窗</label>
          <div id="recorder-popup" class="key-recorder" tabindex="0">
            <span class="key-recorder-label">${escapeHtml(config.shortcut_popup)}</span>
          </div>
        </div>
```

- [ ] **Step 3: Instantiate the third recorder**

In the `render()` function, after the `toggleRecorder` declaration (line 127-130), add:

```ts
  const popupRecorder = new KeyRecorder(
    document.querySelector("#recorder-popup")!,
    config.shortcut_popup,
  );
```

- [ ] **Step 4: Include `popup` in `apply_shortcuts` and `set_config`**

In the save handler (around line 150-155), update the validation call:

```ts
    const capture = captureRecorder.value;
    const toggle = toggleRecorder.value;
    const popup = popupRecorder.value;

    // 1. 验证快捷键
    try {
      await invoke("apply_shortcuts", { capture, toggle, popup });
    } catch (error) {
      statusEl.textContent = `快捷键无效或被占用：${error}`;
      statusEl.classList.add("error");
      return;
    }
```

In the `newConfig` object (around line 165), add `shortcut_popup`:

```ts
    const newConfig: Config = {
      ...config,
      shortcut_capture: capture,
      shortcut_toggle: toggle,
      shortcut_popup: popup,
      launch_at_login: document.querySelector<HTMLInputElement>("#autostart")!.checked,
      ai_provider: providerSelect.value,
      ai_model: modelInput.value.trim(),
      ai_api_key: document.querySelector<HTMLInputElement>("#ai-api-key")!.value.trim(),
      ai_base_url: document.querySelector<HTMLInputElement>("#ai-base-url")!.value.trim(),
    };
```

- [ ] **Step 5: Build to verify types**

Run: `npm run build`
Expected: `tsc` clean + Vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/settings/main.ts
git commit -m "feat(settings): add shortcut_popup keybinding field

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the app**

Run: `npm run tauri dev`
Expected: app launches; tray icon present; no Rust compile errors.

- [ ] **Step 2: Verify the happy path in Chrome**

1. Open Chrome, select some text on any page.
2. Press `Alt+Cmd+P`.
3. A small floating popup with 「加入采集区」(enabled) + 翻译/提问 (disabled) appears near the cursor.
4. Click 「加入采集区」.
5. The popup disappears; the `main` note window (if visible) receives a `> [!quote]` callout block at the caret. If `main` is hidden, toggle it with `Alt+Cmd+N` and confirm the block is present.

- [ ] **Step 3: Verify across other apps**

Repeat Step 2 in Safari, Terminal, and Notes. Confirm the popup appears and the block lands in the note each time.

- [ ] **Step 4: Verify the empty-selection state**

With nothing selected in any app, press `Alt+Cmd+P`. Confirm: popup shows "未识别到选中文本" and auto-hides after ~3s; no block is inserted into the note.

- [ ] **Step 5: Verify cancel paths**

- Select text → `Alt+Cmd+P` → press `Esc`. Popup hides; no block inserted.
- Select text → `Alt+Cmd+P` → click anywhere outside the popup. Popup hides (focus-loss); no block inserted.

- [ ] **Step 6: Verify existing direct capture still works**

Select text → press `Alt+Cmd+C` (the existing direct-capture shortcut). Confirm a `> [!quote]` block is inserted directly with no popup. (Regression check.)

- [ ] **Step 7: Verify accessibility-gated path**

Revoke FloatNote's Accessibility permission in System Settings → Privacy & Security → Accessibility. Select text → `Alt+Cmd+P`. Confirm: the existing a11y banner appears in the `main` window and no popup shows. Re-grant permission and re-test.

- [ ] **Step 8: Verify re-entrancy guard**

Select text → press and hold `Alt+Cmd+P` rapidly / press it 3× quickly. Confirm only one popup appears and only one block is ever inserted (no duplicate captures).

- [ ] **Step 9: Verify the settings field**

Open Settings (tray right-click → 设置). Confirm the 「划词弹窗」 row shows `Alt+Cmd+P`. Record a new shortcut (e.g. `Alt+Cmd+L`), save, and confirm the new chord triggers the popup. Restore to `Alt+Cmd+P` and save.

- [ ] **Step 10: Final commit (only if any fixes were needed)**

If any fixes were applied during verification, commit them. Otherwise no commit.

---

## Self-Review

**Spec coverage:**
- §2 decisions: shortcut_popup new key (T1, T6, T9); disabled translate/ask buttons (T7 popup.html); no preview (T7); macOS-only (T2/T5 cfg gates); pre-declared window (T7); eager capture (T5); reuse `quote-captured` (T4). ✓
- §3.1 new components: `popup.rs` (T3/T4/T5), `cursor.rs` (T2), `selection-popup` window (T7), `popup.html`+`src/popup/main.ts` (T7/T8), `shortcut_popup` config (T1). ✓
- §3.2 reused: `simulate_copy` via `read_selection_text` (T5); `format_clip` (T4); `main.ts:521` listener unchanged (no task touches it — correct); `write_note`/`notes.rs` untouched. ✓
- §3.3 commands: `submit_popup_capture`, `dismiss_popup` (T4); `get_cursor_pos` internal (T2). ✓
- §3.4 state: `popup_cache` (T3). ✓
- §4 data flow steps 1–6: T5 (capture+emit), T8 (show), T4 (submit→emit→focus), main.ts listener unchanged. ✓
- §5 window spec: T7 matches. ✓
- §6 shortcut wiring: T6, T9. ✓
- §7 error handling: a11y (T5 `check_accessibility`), empty (T5 `has_text`, T8 empty state), re-entrancy (T5 guard), clamp (T8), focus-loss (T8 `onFocusChanged`). ✓
- §8 testing: clamp Vitest (T8), cursor `to_logical` unit (T2), `PopupCache` unit (T3), `cargo check` per Rust task, manual checklist (T10). ✓
- §10 files touched: all covered. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" found. Every code step shows the actual code.

**Type consistency:**
- `Config.shortcut_popup` (T1) ↔ `Config` interface in `src/settings/main.ts` (T9) ↔ `apply_shortcuts(... popup: String)` (T6) ↔ `invoke("apply_shortcuts", { capture, toggle, popup })` (T9). ✓
- `PopupPayload { x, y, has_text }` (serde camelCase → `{ x, y, hasText }`) (T4) ↔ `PopupPayload` TS interface `{ x, y, hasText }` (T8). ✓
- `PopupCache::set/take/clear` (T3) used by `state_set` (T5) and `submit_popup_capture`/`dismiss_popup` (T4). ✓
- `cursor::get_cursor_pos() -> Option<(f64, f64)>` (T2) used in `run_popup_capture` (T5). ✓
- `clampToScreen(x, y, w, h, bounds: Rect)` (T8) signature matches the test and the call site. ✓
- `shortcuts::apply(app, capture, toggle, popup)` (T6) matches the call in `lib.rs` (T6 Step 3) and `apply_shortcuts` (T6 Step 2). ✓

No issues found. Plan is ready.
