use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use tauri::{AppHandle, Emitter};

pub fn run_capture(app: &AppHandle) {
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(clipboard) => clipboard,
        Err(_) => return,
    };
    let backup = clipboard.get_text().ok();

    let _ = clipboard.set_text(String::new());

    if simulate_copy().is_err() {
        if let Some(text) = backup {
            let _ = clipboard.set_text(text);
        }
        return;
    }

    std::thread::sleep(std::time::Duration::from_millis(120));

    let selection = clipboard.get_text().unwrap_or_default();

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
        return;
    }

    let block = crate::quote::format_quote(trimmed);
    let _ = app.emit_to("main", "quote-captured", block);
}

fn simulate_copy() -> Result<(), Box<dyn std::error::Error>> {
    let mut enigo = Enigo::new(&Settings::default())?;
    enigo.key(Key::Meta, Direction::Press)?;
    enigo.key(Key::Unicode('c'), Direction::Click)?;
    enigo.key(Key::Meta, Direction::Release)?;
    Ok(())
}
