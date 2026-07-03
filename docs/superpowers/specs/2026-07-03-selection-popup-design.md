# Selection Popup (划词悬浮窗) — Design Spec

- **Date:** 2026-07-03
- **Status:** Approved (design), pending implementation plan
- **Scope:** MVP, macOS only
- **Out of scope:** Windows capture (phase 2), AI translate/QA buttons (placeholders only), automatic selection-triggered popup (modifier/mouse-release detection)

## 1. Goal

Let the user select text in **any** foreground application (Chrome, Safari, Terminal, Notes, …), press a global shortcut, and get a small floating popup near the cursor with an **「加入采集区」** button. Clicking the button appends the selected text — as a `> [!quote]` callout block — into the currently active note in the existing `main` capture window, reusing the current insert/autosave pipeline.

Non-goals for the MVP:
- Auto-popup on selection release (PopClip-style). The trigger is a global shortcut.
- AI actions (translate / ask). Buttons are shown disabled.
- Windows support. macOS only this phase.
- Showing a text preview in the popup. Pure buttons.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Trigger vs. existing ⌥⌘C | New dedicated shortcut (default `Alt+Cmd+P`); existing ⌥⌘C direct-capture behavior unchanged |
| Button set | Primary 「加入采集区」 + disabled placeholders 「翻译」/「提问」 |
| Text preview in popup | None — pure buttons |
| Platform scope | macOS only for MVP |
| Popup window creation | Pre-declared in `tauri.conf.json`, show/hide at runtime (matches `main` window pattern) |
| Capture timing | Eager — grab selected text *before* showing popup, while source app still focused |
| Delivery to capture area | Reuse existing `quote-captured` event → `main.ts` listener → `insertAtCaret` → autosave → `write_note` |

## 3. Architecture

### 3.1 New components

- **`src-tauri/src/popup.rs`** (new module) — `run_popup_capture(app)`: the eager-capture entry point. Performs accessibility check, clipboard backup/clear, `simulate_copy`, read clipboard, restore clipboard, fetch global cursor position, cache the text in `AppState`, emit `popup-payload` to the `selection-popup` window. Includes a re-entrancy guard (AtomicBool, mirroring `capture.rs`).
- **`src-tauri/src/cursor.rs`** (new module) — `get_cursor_pos() -> (f64, f64)`: returns global screen cursor position. macOS implementation uses `CGEventGetLocation` via the existing `core-graphics = "0.25"` dependency. Non-macOS stub returns an error (parity with `capture.rs`).
- **`selection-popup` window** — pre-declared in `tauri.conf.json` `windows` array, backed by a new `popup.html` Vite entry. Flags: `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `visible: false`, `resizable: false`, fixed size ~200×56, `url: "popup.html"`.
- **`src/popup/main.ts`** (new frontend entry) + **`popup.html`** (new Vite entry page) — minimal button UI; listens for `popup-payload`, positions and shows the window, handles button clicks and Esc/cancel.
- **`shortcut_popup`** config key — added to `config.rs` (default `"Alt+Cmd+P"`), wired into `shortcuts.rs::apply` as a third registered chord that calls `popup::run_popup_capture`.

### 3.2 Reused, unchanged

- `capture.rs` `simulate_copy` and the clipboard backup/restore dance — shared logic extracted or called from `popup.rs`. The modifier-release wait loop in `simulate_copy` is harmless when invoked from a button-free shortcut path (no modifiers held by the time it runs), so it can be reused as-is; if extraction is cleaner, factor a `copy_selection_once()` helper.
- `quote.rs::format_clip` — used verbatim to format the cached text.
- `main.ts:507` `quote-captured` listener — receives the block unchanged; **no edit**.
- `commands.rs::write_note` and `notes.rs` — **not touched**. The editor remains the single source of truth that persists via autosave.
- `capabilities/default.json` — already pre-authorizes `set-position`, `set-size`, `set-always-on-top`, `set-focus`, `set-ignore-cursor-events`, `cursor-position`, `start-dragging`. Add the `selection-popup` window label to the `windows` list; no new core permissions required.

### 3.3 New Tauri commands

- `submit_popup_capture() -> Result<(), String>` — reads cached text from `AppState`, formats via `quote::format_clip`, emits `quote-captured` to `main`, hides the popup, clears the cache. Registered in `lib.rs`.
- `dismiss_popup() -> Result<(), String>` — hides the popup and clears the cache (Esc / focus-lost cancel).

`get_cursor_pos()` is an **internal Rust function** (in `cursor.rs`), called by `run_popup_capture`; its result is carried to the frontend inside the `popup-payload` event. It is not exposed as a Tauri command.

### 3.4 App state

Add to the shared `State` (the existing `AppState` struct used for config/note state):
- `popup_capture: Mutex<Option<String>>` — the eagerly-captured text, awaiting submit.

## 4. Data flow

```
1. User selects text in any foreground app (e.g. Chrome).
2. User presses ⌥⌘P.
   → global-shortcut callback → popup::run_popup_capture(app)
3. run_popup_capture:
   a. Re-entrancy guard (AtomicBool); bail if already running.
   b. Accessibility trust check (reuse capture.rs check).
      - Untrusted → emit_to("main", "accessibility-needed", ()) (existing banner); return.
   c. Backup clipboard text; clear clipboard.
   d. simulate_copy()                      ← source app still focused, selection intact
   e. sleep 150ms; read clipboard = selected text
   f. Restore clipboard from backup.
   g. cursor::get_cursor_pos()             ← global screen coords
   h. Store text in State.popup_capture (Mutex<Option<String>>).
   i. emit_to("selection-popup", "popup-payload", { x, y, hasText: text.is_some() && !text.is_empty() })
   - Does NOT touch the main window yet.
4. Popup frontend receives "popup-payload":
   a. clamp (x, y) to visible screen rect (account for popup size + scale factor).
   b. setPosition(clampedX, clampedY).
   c. show().
   d. hasText == false → show "未识别到选中文本" state, disable 加入采集区, auto-hide after 3s.
   e. hasText == true  → enable 加入采集区.
5. User clicks 「加入采集区」:
   a. invoke("submit_popup_capture")
   b. Rust: read State.popup_capture → quote::format_clip → emit_to("main", "quote-captured", block)
   c. hide popup (do not destroy); clear State.popup_capture.
   d. If main window visible → set_focus (reuse capture.rs:116 pattern); else leave hidden (block queued for next toggle).
6. main window existing listener (main.ts:507) receives quote-captured
   → buildCaretInsert + insertAtCaret → editor.focus() → autosave → invoke("write_note")
```

### 4.1 Timing invariant

Step 3d runs **before** the popup is shown, while the source app still has focus and the selection is intact. Step 5 only confirms submission and never re-reads the source app. This eliminates the "popup steals focus → selection lost" race.

## 5. Popup window spec

`tauri.conf.json` addition (alongside `main` and `settings`):

```jsonc
{
  "label": "selection-popup",
  "url": "popup.html",
  "width": 200, "height": 56,
  "transparent": true,
  "decorations": false,
  "alwaysOnTop": true,
  "resizable": false,
  "visible": false,
  "skipTaskbar": true,        // no-op on macOS; harmless
  "hiddenTitle": true,
  "titleBarStyle": "Overlay"
}
```

`vite.config.ts` gains a third entry (`popup.html`) alongside `index.html` and `settings.html`.

UI (pure buttons, no preview):
- Row of three small buttons: 「加入采集区」(primary, enabled when hasText) · 「翻译」(disabled) · 「提问」(disabled).
- Empty-state: a single line "未识别到选中文本", auto-hide after 3s.
- `Esc` key → `invoke("dismiss_popup")`.
- Window `Focused(false)` event → `invoke("dismiss_popup")` (clicking elsewhere cancels).

## 6. Shortcut wiring

- `config.rs`: add `shortcut_popup: String`, default `"Alt+Cmd+P"`. Add to `Config::default`, to the (de)serialization, and to the settings UI save/load path.
- `shortcuts.rs::apply(app, capture, toggle, popup)`: register a third chord; on `ShortcutState::Pressed` call `popup::run_popup_capture(&popup_app)`. Signature gains a `popup` arg; update callers (`lib.rs:92-97`, the `apply_shortcuts` command in `commands.rs:243`).
- Capability `global-shortcut:allow-unregister-all` already granted; no new ACL.
- Settings UI (`src/settings/main.ts`): add a third keybinding field bound to `shortcut_popup`.

## 7. Error handling & edge cases

- **Accessibility not granted** — reuse the existing `accessibility-needed` event and `main.ts:516-524` banner. Popup does not appear.
- **Empty selection / clipboard still empty after `simulate_copy`** — `hasText = false`; popup shows empty-state and auto-hides. No spurious quote block inserted.
- **Re-entrancy** — `run_popup_capture` guards with an AtomicBool (mirror `capture.rs:8-30`). Concurrent presses bail.
- **Cursor off-screen / multi-monitor negative coords** — `clampToScreen(x, y, popupW, popupH, screenW, screenH)` pure function in the popup frontend clamps into the visible rect of the screen containing the cursor. MVP clamps to a single screen; multi-monitor edge cases are best-effort.
- **Popup loses focus** — `Focused(false)` → dismiss (treat as cancel). User can re-trigger.
- **Clipboard restore failure** — existing try-logic in `capture.rs` is reused; worst case the user's clipboard is cleared, same as the current direct-capture path. Acceptable parity.
- **Popup already visible when shortcut pressed again** — re-entrancy guard short-circuits; alternatively hide-then-reshow. MVP: short-circuit.

## 8. Testing

Per CLAUDE.md (Vitest for frontend, `cargo check` for backend, manual `npm run tauri dev` for platform flows).

Frontend (`src/popup/popup.test.ts`, new):
- `clampToScreen`: cursor at edges/corners/negative coords stays in-bounds.
- payload → UI state mapping: `hasText=true` enables primary button; `hasText=false` shows empty-state and disables primary.
- Esc/dismiss path clears local state.

Frontend unchanged: `append.test.ts` (insert path untouched).

Rust:
- `cargo check` from `src-tauri/` must pass.
- `cursor.rs`: any coordinate normalization helper (e.g. physical→logical) gets `#[cfg(test)]` unit tests. The screen-edge clamp lives in the frontend (`clampToScreen`), tested via Vitest below.
- `popup.rs`: the `State.popup_capture` get/set/clear is unit-testable (no IO).
- `simulate_copy`, `CGEventGetLocation`, and the global-shortcut path are platform IO — no unit tests; verified manually.

Manual verification checklist (`npm run tauri dev`):
1. Chrome: select text → ⌥⌘P → popup appears near cursor → click 加入采集区 → quote block appears in main window.
2. Safari, Terminal, Notes: same flow.
3. No selection + ⌥⌘P → empty-state popup, auto-hides, nothing inserted.
4. Popup visible → press Esc → popup hides, nothing inserted.
5. Popup visible → click elsewhere → popup hides (focus-lost cancel).
6. ⌥⌘C (existing direct capture) still works unchanged alongside ⌥⌘P.
7. Accessibility revoked → ⌥⌘P shows the existing a11y banner, no popup.
8. Rapid double-press ⌥⌘P → no duplicate captures (re-entrancy guard).

## 9. Cross-platform notes (phase 2 teaser)

- Windows needs: `simulate_copy` for Ctrl+C via SendInput (the `windows` crate), and `GetCursorPos` for global cursor. Currently `capture.rs:188` is a macOS-only stub; `cursor.rs` mirrors that boundary.
- The popup window, frontend, `submit_popup_capture`, and `quote-captured` reuse are already cross-platform; only the two platform-IO functions need Windows implementations in phase 2.
- Linux is not a FloatNote target.

## 10. Files touched

New:
- `src-tauri/src/popup.rs`
- `src-tauri/src/cursor.rs`
- `popup.html`
- `src/popup/main.ts`
- `src/popup/popup.test.ts`

Modified:
- `src-tauri/src/lib.rs` — register `popup`/`cursor` modules, new commands, pass `popup` app handle to `shortcuts::apply`.
- `src-tauri/src/shortcuts.rs` — third chord + `popup` param.
- `src-tauri/src/config.rs` — `shortcut_popup` field + default.
- `src-tauri/src/commands.rs` — `apply_shortcuts` passes popup; optional new commands registered here or in `lib.rs`.
- `src-tauri/src/state.rs` (or wherever `AppState` lives) — `popup_capture: Mutex<Option<String>>`.
- `src-tauri/tauri.conf.json` — `selection-popup` window.
- `src-tauri/capabilities/default.json` — add `selection-popup` to `windows` list.
- `vite.config.ts` — `popup.html` entry.
- `src/settings/main.ts` — third keybinding field.
- `src-tauri/src/capture.rs` — factor shared copy/clipboard helpers for reuse (minimal, behavior-preserving).

## 11. Open questions

None for the MVP. (AI button behavior, Windows, and auto-trigger are explicitly out of scope.)
