use crate::agent::{ActiveNote, AgentHandle, HostToSidecar};
use crate::{config::Config, notes, versions};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Manager, State};

pub struct AppState {
    pub config: Mutex<Config>,
    pub config_path: PathBuf,
    /// 活的 sidecar 句柄；None 表示尚未起或已断开。
    pub agent: Mutex<Option<AgentHandle>>,
    /// sidecar 是否已发 `ready`。
    pub agent_ready: Mutex<bool>,
    /// agent_send 记录的当前活动笔记，供 apply_write 定位文件。
    pub active_note: Mutex<Option<ActiveNote>>,
    /// 单调递增的 requestId 计数器。
    pub agent_seq: AtomicU64,
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
    let dir_path = std::path::Path::new(&dir);
    let new_path =
        notes::rename_note(dir_path, &old_name, &new_stem).map_err(|error| error.to_string())?;
    versions::rename(dir_path, &old_name, &new_stem).map_err(|error| error.to_string())?;
    Ok(new_path)
}

#[tauri::command]
pub fn list_versions(dir: String, note_id: String) -> Vec<versions::VersionEntry> {
    versions::list(std::path::Path::new(&dir), &note_id)
}

#[tauri::command]
pub fn snapshot_note(
    dir: String,
    note_id: String,
    content: String,
    source: String,
) -> Result<u32, String> {
    versions::snapshot(std::path::Path::new(&dir), &note_id, &content, &source)
        .map_err(|error| error.to_string())
}

/// 回退：先把"当前内容"留为安全版本，再把第 v 版写回笔记文件，并返回其内容。
#[tauri::command]
pub fn restore_version(
    dir: String,
    note_id: String,
    path: String,
    current_content: String,
    v: u32,
) -> Result<String, String> {
    let dir_path = std::path::Path::new(&dir);
    versions::snapshot(dir_path, &note_id, &current_content, "manual")
        .map_err(|error| error.to_string())?;
    let restored =
        versions::read_version(dir_path, &note_id, v).map_err(|error| error.to_string())?;
    std::fs::write(&path, &restored).map_err(|error| error.to_string())?;
    Ok(restored)
}

/// 配置 sidecar 的 provider / model / key（经 stdin 发 Configure）。
#[tauri::command]
pub fn agent_configure(
    state: State<AppState>,
    provider: String,
    model: String,
    api_key: Option<String>,
) -> Result<(), String> {
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::Configure {
            provider,
            model,
            api_key,
        })
        .map_err(|error| error.to_string())
}

/// 发一条用户消息给 tutor；记录活动笔记，返回 requestId。
#[tauri::command]
pub fn agent_send(
    state: State<AppState>,
    dir: String,
    note_id: String,
    path: String,
    note_text: String,
    user_text: String,
) -> Result<String, String> {
    let seq = state.agent_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let request_id = format!("r{seq}");

    *state.active_note.lock().unwrap() = Some(ActiveNote {
        dir,
        note_id: note_id.clone(),
        path,
    });

    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::Prompt {
            request_id: request_id.clone(),
            note_id,
            note_text,
            user_text,
        })
        .map_err(|error| error.to_string())?;
    Ok(request_id)
}

/// 取消进行中的对话（经 stdin 发 Cancel）。
#[tauri::command]
pub fn agent_cancel(state: State<AppState>, request_id: String) -> Result<(), String> {
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::Cancel { request_id })
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

