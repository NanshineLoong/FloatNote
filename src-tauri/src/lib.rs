mod agent;
mod capture;
mod commands;
mod config;
mod cursor;
mod notes;
mod popup;
mod project;
mod shortcuts;
mod source;
mod tray;
mod versions;
mod watcher;
mod windows;

use commands::AppState;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let path = commands::config_path(app.handle());
            let config = config::load(&path);
            let write_suppress = watcher::new_suppress_list();
            let file_watcher = match watcher::FileWatcher::new(app.handle().clone(), write_suppress.clone()) {
                Ok(w) => Some(w),
                Err(e) => {
                    eprintln!("文件监听器不可用，外部修改将不会实时刷新: {e}");
                    None
                }
            };
            app.manage(AppState {
                config: Mutex::new(config),
                config_path: path,
                agent: Mutex::new(None),
                agent_ready: Mutex::new(false),
                agent_spawn_error: Mutex::new(None),
                active_note: Mutex::new(None),
                agent_seq: std::sync::atomic::AtomicU64::new(0),
                watcher: Mutex::new(file_watcher),
                write_suppress,
                popup_cache: crate::popup::PopupCache::new(),
            });

            // 拉起 agent-sidecar；失败存入状态供前端查询，不阻断 app 启动。
            match agent::spawn(app.handle()) {
                Ok(handle) => {
                    *app.state::<AppState>().agent.lock().unwrap() = Some(handle);
                }
                Err(error) => {
                    eprintln!("agent sidecar spawn failed: {error}");
                    *app.state::<AppState>().agent_spawn_error.lock().unwrap() =
                        Some(format!("助手启动失败: {error}"));
                }
            }

            #[cfg(target_os = "macos")]
            let _ = app
                .handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Hide instead of close the note window so it can be re-opened later.
            if let Some(note_win) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                note_win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        crate::windows::set_note_visible(&handle, false);
                    }
                });
            }

            // Hide instead of close the settings window so it can be re-opened later.
            if let Some(settings_win) = app.get_webview_window("settings") {
                let win = settings_win.clone();
                settings_win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win.hide();
                    }
                });
            }

            tray::build_tray(app.handle())?;

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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::set_working_dir,
            commands::list_notes,
            commands::read_note,
            commands::write_note,
            commands::create_note,
            commands::rename_note,
            commands::list_projects,
            commands::resolve_projects,
            commands::create_project,
            commands::list_pieces,
            commands::resolve_documents,
            commands::rename_project,
            commands::delete_project,
            commands::delete_note,
            commands::list_versions,
            commands::snapshot_note,
            commands::restore_version,
            commands::watch_dir,
            commands::unwatch_dir,
            commands::agent_configure,
            commands::agent_send,
            commands::agent_cancel,
            commands::set_active_note,
            commands::get_active_note,
            commands::get_assistant_state,
            commands::toggle_assistant,
            commands::get_agent_status,
            commands::apply_shortcuts,
            popup::submit_popup_capture,
            popup::dismiss_popup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FloatNote");
}
