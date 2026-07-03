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
