mod capture;
mod commands;
mod config;
mod notes;
mod quote;
mod shortcuts;
mod tray;
mod windows;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;

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
            });

            #[cfg(target_os = "macos")]
            let _ = app
                .handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory);

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
            commands::apply_shortcuts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FloatNote");
}
