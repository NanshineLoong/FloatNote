use tauri::{AppHandle, Emitter};

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
    // macOS: simulating Cmd+C requires Accessibility permission. Without it,
    // the synthetic events are silently dropped and nothing is captured.
    #[cfg(target_os = "macos")]
    {
        use std::sync::atomic::{AtomicBool, Ordering};
        static PROMPTED: AtomicBool = AtomicBool::new(false);

        if !macos_accessibility_client::accessibility::application_is_trusted() {
            log_line("accessibility NOT trusted — cannot simulate Cmd+C");
            if !PROMPTED.swap(true, Ordering::SeqCst) {
                macos_accessibility_client::accessibility::application_is_trusted_with_prompt();
            }
            let _ = app.emit_to("main", "accessibility-needed", ());
            return;
        }
    }

    log_line("fired");

    let mut clipboard = match arboard::Clipboard::new() {
        Ok(clipboard) => clipboard,
        Err(error) => {
            log_line(&format!("clipboard init error: {error}"));
            return;
        }
    };
    let backup = clipboard.get_text().ok();

    let _ = clipboard.set_text(String::new());

    if let Err(error) = simulate_copy() {
        log_line(&format!("simulate_copy error: {error}"));
        if let Some(text) = backup {
            let _ = clipboard.set_text(text);
        }
        return;
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

    let trimmed = selection.trim();
    if trimmed.is_empty() {
        log_line("empty selection, ignoring");
        return;
    }

    let block = crate::quote::format_quote(trimmed);
    let _ = app.emit_to("main", "quote-captured", block);
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
