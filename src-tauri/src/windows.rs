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

/// 显示或隐藏笔记窗（关闭按钮与托盘切换都走这里）。助手活在窗内，随之一并显隐。
pub fn set_note_visible(app: &AppHandle, visible: bool) {
    let Some(window) = note_window(app) else {
        return;
    };
    if visible {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = window.hide();
    }
}

pub fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

