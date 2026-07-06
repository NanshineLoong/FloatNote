use crate::agent::{ActiveNote, AgentHandle, HostToSidecar};
use crate::watcher::{FileWatcher, SuppressList};
use crate::{config::Config, notes, project, versions};
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
    /// sidecar 启动失败时记录错误信息，供前端初始化时查询。
    pub agent_spawn_error: Mutex<Option<String>>,
    /// agent_send 记录的当前活动笔记，供 apply_write 定位文件。
    pub active_note: Mutex<Option<ActiveNote>>,
    /// 单调递增的 requestId 计数器。
    pub agent_seq: AtomicU64,
    /// 文件系统监听器；None 表示尚未初始化。
    pub watcher: Mutex<Option<FileWatcher>>,
    /// 自身写入抑制表，与 watcher 共享。
    pub write_suppress: SuppressList,
    /// 划词弹窗急切抓取的待提交文本。
    pub popup_cache: crate::popup::PopupCache,
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
pub fn write_note(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    crate::watcher::mark_self_write(&state.write_suppress, &path);
    std::fs::write(&path, &content).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_note(state: State<AppState>, dir: String) -> Result<notes::NoteEntry, String> {
    let dir_path = std::path::PathBuf::from(&dir);
    std::fs::create_dir_all(&dir_path).map_err(|error| error.to_string())?;
    let stem = notes::timestamp_stem(chrono::Local::now().naive_local());
    let filename = notes::unique_filename(&dir_path, &stem);
    let path = dir_path.join(&filename);
    let path_str = path.to_string_lossy().to_string();
    crate::watcher::mark_self_write(&state.write_suppress, &path_str);
    std::fs::write(&path, "").map_err(|error| error.to_string())?;
    Ok(notes::NoteEntry {
        name: filename.trim_end_matches(".md").to_string(),
        path: path_str,
    })
}

#[tauri::command]
pub fn rename_note(state: State<AppState>, dir: String, old_name: String, new_stem: String) -> Result<String, String> {
    let dir_path = std::path::Path::new(&dir);
    let new_path =
        notes::rename_note(dir_path, &old_name, &new_stem).map_err(|error| error.to_string())?;
    versions::rename(dir_path, &old_name, &new_stem).map_err(|error| error.to_string())?;
    crate::watcher::mark_self_write(&state.write_suppress, &new_path);
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
    state: State<AppState>,
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
    crate::watcher::mark_self_write(&state.write_suppress, &path);
    std::fs::write(&path, &restored).map_err(|error| error.to_string())?;
    Ok(restored)
}

/// 配置 sidecar 的 provider / model / key / base_url（经 stdin 发 Configure）。
#[tauri::command]
pub fn agent_configure(
    state: State<AppState>,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<(), String> {
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::Configure {
            provider,
            model,
            api_key,
            base_url,
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

/// 助手展开状态，供前端启动时读取。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantState {
    pub open: bool,
}

#[tauri::command]
pub fn get_assistant_state(state: State<AppState>) -> AssistantState {
    let config = state.config.lock().unwrap();
    AssistantState {
        open: config.assistant_open,
    }
}

/// 折叠/展开助手（顶栏 robot_icon 单击）。前端据返回的新状态重算布局。
#[tauri::command]
pub fn toggle_assistant(state: State<AppState>) -> Result<AssistantState, String> {
    let mut config = state.config.lock().unwrap();
    config.assistant_open = !config.assistant_open;
    crate::config::save(&state.config_path, &config).map_err(|error| error.to_string())?;
    Ok(AssistantState {
        open: config.assistant_open,
    })
}

/// 助手运行状态：是否已就绪、是否有启动错误。前端初始化时查询。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub ready: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_agent_status(state: State<AppState>) -> AgentStatus {
    let ready = *state.agent_ready.lock().unwrap();
    let error = state.agent_spawn_error.lock().unwrap().clone();
    AgentStatus { ready, error }
}

/// 笔记窗发布当前活动笔记，供 apply_write 定位文件。
#[tauri::command]
pub fn set_active_note(state: State<AppState>, dir: String, note_id: String, path: String) {
    *state.active_note.lock().unwrap() = Some(ActiveNote { dir, note_id, path });
}

/// 查询当前活动笔记（独立助手窗发消息前用来定位 dir / noteId / path）。
#[tauri::command]
pub fn get_active_note(state: State<AppState>) -> Option<ActiveNote> {
    state.active_note.lock().unwrap().clone()
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
pub fn apply_shortcuts(
    app: tauri::AppHandle,
    capture: String,
    toggle: String,
    popup: String,
) -> Result<(), String> {
    crate::shortcuts::apply(&app, &capture, &toggle, &popup)
}

#[tauri::command]
pub fn list_projects(root: String) -> Result<Vec<project::ProjectEntry>, String> {
    project::list_projects(std::path::Path::new(&root)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resolve_projects(paths: Vec<String>) -> Vec<project::ProjectEntry> {
    project::resolve_projects(&paths)
}

#[tauri::command]
pub fn create_project(root: String, name: String) -> Result<project::ProjectEntry, String> {
    project::create_project(std::path::Path::new(&root), &name).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_pieces(project_dir: String) -> Result<Vec<notes::NoteEntry>, String> {
    project::list_pieces(std::path::Path::new(&project_dir)).map_err(|error| error.to_string())
}

/// Resolve an MRU list of standalone-document paths to the ones still on disk.
/// Mirrors `resolve_projects` for loose `.md` files outside any project.
#[tauri::command]
pub fn resolve_documents(paths: Vec<String>) -> Vec<notes::NoteEntry> {
    project::resolve_documents(&paths)
}

/// Rename a project folder in place; returns the new path. The frontend updates
/// the MRU entry to this new path on success.
#[tauri::command]
pub fn rename_project(dir: String, new_name: String) -> Result<String, String> {
    project::rename_project(std::path::Path::new(&dir), &new_name)
        .map_err(|error| error.to_string())
}

/// Move a project folder to the OS trash. The frontend confirms first.
#[tauri::command]
pub fn delete_project(dir: String) -> Result<(), String> {
    project::delete_project(std::path::Path::new(&dir)).map_err(|error| error.to_string())
}

/// Move a note file (piece or standalone document) to the OS trash and purge
/// its version history. `dir` is the containing directory; `name` is the file
/// stem (note id).
#[tauri::command]
pub fn delete_note(state: State<AppState>, dir: String, name: String) -> Result<(), String> {
    let path = std::path::Path::new(&dir).join(format!("{name}.md"));
    let path_str = path.to_string_lossy().to_string();
    crate::watcher::mark_self_write(&state.write_suppress, &path_str);
    notes::delete_note(&path).map_err(|error| error.to_string())?;
    versions::purge(std::path::Path::new(&dir), &name).map_err(|error| error.to_string())?;
    Ok(())
}

/// 切换文件系统监听到指定目录；前端在打开/切换项目时调用。
#[tauri::command]
pub fn watch_dir(state: State<AppState>, dir: String) -> Result<(), String> {
    let mut guard = state.watcher.lock().unwrap();
    match guard.as_mut() {
        Some(watcher) => watcher.watch_dir(std::path::Path::new(&dir)),
        None => Ok(()), // watcher 不可用时静默跳过
    }
}

/// 停止文件系统监听。
#[tauri::command]
pub fn unwatch_dir(state: State<AppState>) {
    if let Some(watcher) = state.watcher.lock().unwrap().as_mut() {
        watcher.unwatch();
    }
}

pub fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("FloatNote"))
        .join("config.json")
}

