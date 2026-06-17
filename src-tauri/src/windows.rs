use tauri::{AppHandle, Manager, WebviewWindow};

pub fn note_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

pub fn toggle_note(app: &AppHandle) {
    if let Some(window) = note_window(app) {
        let visible = window.is_visible().unwrap_or(false);
        set_note_visible(app, !visible);
    }
}

/// 显示或隐藏笔记窗，并让独立助手窗随之显隐（隐藏时一并收起，显示时按原状态恢复）。
/// 笔记窗的关闭按钮与托盘切换都走这里，确保助手窗不会脱离笔记窗孤立留在屏幕上。
pub fn set_note_visible(app: &AppHandle, visible: bool) {
    let Some(window) = note_window(app) else {
        return;
    };
    if visible {
        let _ = window.show();
        let _ = window.set_focus();
        crate::assistant_window::restore_with_note(app);
    } else {
        crate::assistant_window::hide_with_note(app);
        let _ = window.hide();
    }
}

pub fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

