mod agent;
mod capture;
mod commands;
mod config;
mod notes;
mod project;
mod quote;
mod shortcuts;
mod tray;
mod versions;
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
            app.manage(AppState {
                config: Mutex::new(config),
                config_path: path,
                agent: Mutex::new(None),
                agent_ready: Mutex::new(false),
                active_note: Mutex::new(None),
                agent_seq: std::sync::atomic::AtomicU64::new(0),
            });

            // 拉起 agent-sidecar；失败仅打印，不阻断 app 启动。
            match agent::spawn(app.handle()) {
                Ok(handle) => {
                    *app.state::<AppState>().agent.lock().unwrap() = Some(handle);
                }
                Err(error) => eprintln!("agent sidecar spawn failed: {error}"),
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

            tray::build_tray(app.handle())?;

            {
                let config = app.state::<AppState>().config.lock().unwrap().clone();
                if let Err(error) =
                    shortcuts::apply(app.handle(), &config.shortcut_capture, &config.shortcut_toggle)
                {
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
            commands::create_project,
            commands::list_pieces,
            commands::list_versions,
            commands::snapshot_note,
            commands::restore_version,
            commands::agent_configure,
            commands::agent_send,
            commands::agent_cancel,
            commands::set_active_note,
            commands::get_active_note,
            commands::get_assistant_state,
            commands::toggle_assistant,
            commands::apply_shortcuts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FloatNote");
}
