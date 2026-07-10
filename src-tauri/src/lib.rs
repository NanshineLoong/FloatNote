mod agent;
mod ax_copy;
mod capture;
mod chat_history;
mod commands;
mod config;
mod cursor;
mod notes;
mod paths;
mod platform;
mod popup;
mod project;
mod selection_monitor;
mod shortcuts;
mod source;
mod state;
mod trash;
mod tray;
mod versions;
mod watcher;
mod windows;

#[cfg(test)]
mod testutil;

use state::AppState;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .register_uri_scheme_protocol("floatnote-img", |ctx, request| {
            use std::path::PathBuf;
            // URI path is like "/<percent-encoded absolute path>". Strip the
            // leading "/", percent-decode, then validate + serve.
            let raw = request.uri().path();
            let encoded = raw.strip_prefix('/').unwrap_or(raw);
            let decoded = percent_encoding::percent_decode_str(encoded)
                .decode_utf8_lossy()
                .into_owned();
            let path = PathBuf::from(&decoded);
            let state = ctx.app_handle().state::<AppState>();
            if !crate::notes::is_safe_image_path(&path) || !state.authorized_roots.allows_image(&path) {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::FORBIDDEN)
                    .header(tauri::http::header::CONTENT_TYPE, "text/plain")
                    .body("forbidden".as_bytes().to_vec())
                    .unwrap();
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            match std::fs::read(&path) {
                Ok(bytes) => tauri::http::Response::builder()
                    .header(
                        tauri::http::header::CONTENT_TYPE,
                        crate::notes::image_content_type(ext),
                    )
                    .body(bytes)
                    .unwrap(),
                Err(_) => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(tauri::http::header::CONTENT_TYPE, "text/plain")
                    .body("not found".as_bytes().to_vec())
                    .unwrap(),
            }
        })
        .setup(|app| {
            let path = commands::config_path(app.handle());
            let config = config::load(&path);
            let write_suppress = watcher::new_suppress_list();
            let file_watcher =
                match watcher::FileWatcher::new(app.handle().clone(), write_suppress.clone()) {
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
                pending_edits: Mutex::new(std::collections::HashMap::new()),
                pending_skill_lists: Mutex::new(std::collections::HashMap::new()),
                authorized_roots: state::AuthorizedRoots::default(),
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
                if config.auto_popup_mode != "off" {
                    selection_monitor::install(app.handle().clone());
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::list_notes,
            commands::save_pasted_image,
            commands::import_image_files,
            commands::read_note,
            commands::write_note,
            commands::create_note,
            commands::rename_note,
            commands::list_projects,
            commands::resolve_projects,
            commands::create_project,
            commands::open_existing_project,
            commands::list_pieces,
            commands::resolve_documents,
            commands::rename_project,
            commands::delete_project,
            commands::delete_note,
            commands::list_versions,
            commands::snapshot_note,
            commands::restore_version,
            commands::chat_get_for_scope,
            commands::chat_create,
            commands::chat_list_for_scope,
            commands::chat_list_all,
            commands::chat_open,
            commands::chat_update_title,
            commands::chat_delete,
            commands::chat_clear_before,
            commands::watch_dir,
            commands::unwatch_dir,
            commands::agent_configure,
            commands::agent_send,
            commands::agent_new_session,
            commands::agent_open_session,
            commands::agent_cancel,
            commands::agent_list_skills,
            commands::resolve_permission,
            commands::set_active_note,
            commands::get_active_note,
            commands::get_assistant_state,
            commands::toggle_assistant,
            commands::get_agent_status,
            commands::apply_shortcuts,
            commands::set_auto_popup_mode,
            commands::get_window_shortcuts,
            commands::open_url,
            source::app_icon,
            popup::submit_popup_capture,
            popup::dismiss_popup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FloatNote");
}
