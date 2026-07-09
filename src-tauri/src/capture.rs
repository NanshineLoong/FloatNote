use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

/// Re-entrancy guard. The global-shortcut callback can fire more than once per
/// physical press on macOS; two concurrent `run_capture` routines would race on
/// the single shared system clipboard (one clearing/restoring it while the other
/// reads → empty selection). Only one capture may run at a time.
static CAPTURING: AtomicBool = AtomicBool::new(false);

pub struct CaptureGuard {
    _priv: (),
}

impl CaptureGuard {
    /// Returns `Some` if this caller acquired the lock, `None` if a capture is
    /// already in flight.
    pub fn try_enter() -> Option<Self> {
        if CAPTURING.swap(true, Ordering::SeqCst) {
            None
        } else {
            Some(Self { _priv: () })
        }
    }
}

impl Drop for CaptureGuard {
    fn drop(&mut self) {
        CAPTURING.store(false, Ordering::SeqCst);
    }
}

#[cfg(target_os = "macos")]
fn log_line(msg: &str) {
    use std::io::Write;
    eprintln!("[capture] {msg}");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/floatnote-capture.log")
    {
        let _ = writeln!(file, "{msg}");
    }
}

#[cfg(not(target_os = "macos"))]
fn log_line(msg: &str) {
    eprintln!("[capture] {msg}");
}

pub fn run_capture(app: &AppHandle) {
    let Some(_guard) = CaptureGuard::try_enter() else {
        log_line("already capturing, skipping");
        return;
    };

    if !check_accessibility(app) {
        return;
    }

    log_line("fired");

    let Some(captured) = read_selection() else {
        return;
    };

    let source = crate::source::capture_source(app);
    let payload = crate::source::QuotePayload {
        text: captured.text,
        html: captured.html,
        source,
    };
    let _ = app.emit_to("main", "quote-captured", payload);

    if let Some(window) = crate::windows::note_window(app) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

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

/// What `read_selection` pulled off the clipboard after simulating Cmd+C.
/// `html` is the `text/html` flavor when the source app wrote one (browsers,
/// rich-text editors); `None` for plain-text-only sources (Terminal, etc.).
pub struct CapturedContent {
    pub text: String,
    pub html: Option<String>,
}

/// Backup clipboard, simulate Cmd+C, read the new clipboard content, restore.
/// Returns the trimmed selection text plus any HTML flavor the source wrote,
/// or None if the selection was empty or capture failed. Restoring the
/// clipboard is text-only today (a pre-existing limitation: an HTML flavor
/// originally on the clipboard is replaced by its plain-text backup). Restoring
/// HTML too is tracked as a follow-up.
pub fn read_selection() -> Option<CapturedContent> {
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
    let text = clipboard.get_text().unwrap_or_default();
    // Read the HTML flavor too so the frontend can preserve list/table/bold
    // formatting when converting to Markdown. `get().html()` errors when no
    // HTML flavor is present (plain-text sources) — that's the common, benign
    // case, so we just drop to None.
    let html = clipboard.get().html().ok().filter(|h| !h.trim().is_empty());
    log_line(&format!(
        "selection len = {} html = {}",
        text.len(),
        html.is_some()
    ));

    match backup {
        Some(text) => {
            let _ = clipboard.set_text(text);
        }
        None => {
            let _ = clipboard.set_text(String::new());
        }
    }

    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        log_line("empty selection, ignoring");
        None
    } else {
        Some(CapturedContent {
            text: trimmed,
            html,
        })
    }
}

#[cfg(target_os = "macos")]
mod cg {
    // `CGEventSourceFlagsState` is not exposed by the core-graphics crate, so
    // declare it directly. It returns the *current* modifier flags from real
    // hardware, letting us wait until the capture chord is physically released.
    extern "C" {
        pub fn CGEventSourceFlagsState(state_id: i32) -> u64;
    }

    // kCGEventSourceStateCombinedSessionState
    pub const COMBINED_SESSION_STATE: i32 = 0;

    // Modifier bits within CGEventFlags.
    pub const MASK_SHIFT: u64 = 0x0002_0000;
    pub const MASK_CONTROL: u64 = 0x0004_0000;
    pub const MASK_OPTION: u64 = 0x0008_0000;
    pub const MASK_COMMAND: u64 = 0x0010_0000;
    pub const MODIFIER_MASK: u64 = MASK_SHIFT | MASK_CONTROL | MASK_OPTION | MASK_COMMAND;
}

#[cfg(target_os = "macos")]
fn simulate_copy() -> Result<(), Box<dyn std::error::Error>> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use std::time::Duration;

    // The capture shortcut (e.g. ⌥⌘C) is a modifier chord, so those modifiers
    // are still physically held when this fires. Events posted to the HID tap
    // are merged with the *real* hardware modifier state, so injecting Cmd+C now
    // would be seen as ⌥⌘C (not a copy). Wait for the user to let go of the
    // chord first, then inject a clean Cmd+C.
    let mut waited = 0u32;
    loop {
        let flags = unsafe { cg::CGEventSourceFlagsState(cg::COMBINED_SESSION_STATE) };
        if flags & cg::MODIFIER_MASK == 0 {
            break;
        }
        if waited >= 1000 {
            log_line("warning: modifiers still held after 1s, injecting anyway");
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
        waited += 10;
    }
    log_line(&format!("waited {waited}ms for modifier release"));

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "failed to create CGEventSource")?;

    const KEY_C: u16 = 8;
    let key_down = CGEvent::new_keyboard_event(source.clone(), KEY_C, true)
        .map_err(|_| "failed to create key-down event")?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);

    let key_up = CGEvent::new_keyboard_event(source, KEY_C, false)
        .map_err(|_| "failed to create key-up event")?;
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn simulate_copy() -> Result<(), Box<dyn std::error::Error>> {
    Err("capture is only supported on macOS".into())
}
