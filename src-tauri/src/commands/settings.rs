use crate::config::WindowShortcuts;
use crate::state::AppState;
use tauri::{Emitter, State};

#[tauri::command]
pub fn get_window_shortcuts(state: State<AppState>) -> WindowShortcuts {
    state.config.lock().unwrap().window_shortcuts.clone()
}

#[tauri::command]
pub fn apply_shortcuts(
    app: tauri::AppHandle,
    state: State<AppState>,
    capture: String,
    toggle: String,
    popup: String,
    window_shortcuts: WindowShortcuts,
) -> Result<(), String> {
    crate::shortcuts::apply(&app, &capture, &toggle, &popup)?;
    {
        let mut config = state.config.lock().unwrap();
        config.shortcut_capture = capture;
        config.shortcut_toggle = toggle;
        config.shortcut_popup = popup;
        config.window_shortcuts = window_shortcuts;
        crate::config::save(&state.config_path, &config).map_err(|error| error.to_string())?;
    }
    let _ = app.emit("window-shortcuts-changed", ());
    Ok(())
}

#[tauri::command]
pub fn set_auto_popup_mode(
    mode: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if !is_valid_auto_popup_mode(&mode) {
        return Err(format!("无效的 auto_popup_mode: {mode}"));
    }
    {
        let mut config = state.config.lock().unwrap();
        config.auto_popup_mode = mode.clone();
        crate::config::save(&state.config_path, &config).map_err(|error| error.to_string())?;
    }
    if should_install_selection_monitor(&mode) {
        crate::selection_monitor::install(app);
    } else {
        crate::selection_monitor::uninstall();
    }
    Ok(())
}

fn is_valid_auto_popup_mode(mode: &str) -> bool {
    matches!(mode, "off" | "auto" | "shortcut")
}

pub(crate) fn should_install_selection_monitor(mode: &str) -> bool {
    mode == "auto"
}

#[cfg(test)]
mod tests {
    use super::{is_valid_auto_popup_mode, should_install_selection_monitor};

    #[test]
    fn auto_popup_mode_is_an_explicit_allowlist() {
        assert!(is_valid_auto_popup_mode("off"));
        assert!(is_valid_auto_popup_mode("auto"));
        assert!(is_valid_auto_popup_mode("shortcut"));
        assert!(!is_valid_auto_popup_mode("every"));
        assert!(!is_valid_auto_popup_mode("modifier"));
        assert!(!is_valid_auto_popup_mode("always"));
        assert!(!is_valid_auto_popup_mode("OFF"));
        assert!(should_install_selection_monitor("auto"));
        assert!(!should_install_selection_monitor("shortcut"));
        assert!(!should_install_selection_monitor("off"));
    }
}
