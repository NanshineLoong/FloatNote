use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Emitter;

pub fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    #[cfg(target_os = "macos")]
    let tray_icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    #[cfg(not(target_os = "macos"))]
    let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-windows.png"))?;

    TrayIconBuilder::with_id("main")
        .icon(tray_icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => crate::windows::show_settings(app),
            "history" => crate::windows::show_history(app),
            "quit" => app.exit(0),
            id if id.starts_with("chat_open:") => {
                let conversation_id = id.trim_start_matches("chat_open:").to_string();
                crate::windows::set_note_visible(app, true);
                let _ = app.emit("chat://open-id", conversation_id);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::windows::toggle_note(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn refresh_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(build_menu(app)?))?;
    }
    Ok(())
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = MenuItem::with_id(app, "settings", "设置...", true, None::<&str>)?;
    let history = MenuItem::with_id(app, "history", "查看全部对话...", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::new(app)?;
    let recent_header = MenuItem::with_id(app, "recent_header", "最近对话", false, None::<&str>)?;
    menu.append(&recent_header)?;
    if let Ok(store) = crate::chat_history::ChatHistoryStore::default_for_user() {
        let recent = store.list_recent(5).unwrap_or_default();
        if recent.is_empty() {
            let empty = MenuItem::with_id(app, "recent_empty", "暂无对话", false, None::<&str>)?;
            menu.append(&empty)?;
        } else {
            for entry in recent {
                let label = format_chat_label(&entry.title, &entry.scope_label);
                let item = MenuItem::with_id(app, format!("chat_open:{}", entry.id), label, true, None::<&str>)?;
                menu.append(&item)?;
            }
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&history)?;
    menu.append(&settings)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn compact(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index >= max_chars {
            out.push('…');
            return out;
        }
        out.push(ch);
    }
    out
}

fn format_chat_label(title: &str, scope_label: &str) -> String {
    let title = compact(title.trim(), 18);
    let scope = compact(scope_label.trim(), 14);
    if scope.is_empty() {
        title
    } else {
        format!("{title} ({scope})")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_chat_label_weakens_scope_with_parentheses() {
        assert_eq!(format_chat_label("生成周报草稿", "FloatNote"), "生成周报草稿 (FloatNote)");
        assert_eq!(format_chat_label("生成周报草稿", ""), "生成周报草稿");
        assert!(!format_chat_label("生成周报草稿", "FloatNote").contains("·"));
    }
}
