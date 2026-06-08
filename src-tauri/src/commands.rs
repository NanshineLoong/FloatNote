use crate::{config::Config, notes};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

pub struct AppState {
    pub config: Mutex<Config>,
    pub config_path: PathBuf,
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_config(state: State<AppState>, new_config: Config) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    *config = new_config;
    crate::config::save(&state.config_path, &config).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_working_dir(state: State<AppState>, dir: String) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.working_dir = Some(dir);
    crate::config::save(&state.config_path, &config).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_notes(dir: String) -> Result<Vec<notes::NoteEntry>, String> {
    notes::list_markdown(std::path::Path::new(&dir)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_note(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_note(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_note(dir: String) -> Result<notes::NoteEntry, String> {
    let dir_path = std::path::PathBuf::from(&dir);
    std::fs::create_dir_all(&dir_path).map_err(|error| error.to_string())?;
    let stem = notes::timestamp_stem(chrono::Local::now().naive_local());
    let filename = notes::unique_filename(&dir_path, &stem);
    let path = dir_path.join(&filename);
    std::fs::write(&path, "").map_err(|error| error.to_string())?;
    Ok(notes::NoteEntry {
        name: filename.trim_end_matches(".md").to_string(),
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn rename_note(dir: String, old_name: String, new_stem: String) -> Result<String, String> {
    notes::rename_note(std::path::Path::new(&dir), &old_name, &new_stem)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn apply_shortcuts(app: tauri::AppHandle, capture: String, toggle: String) -> Result<(), String> {
    crate::shortcuts::apply(&app, &capture, &toggle)
}

pub fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("FloatNote"))
        .join("config.json")
}

