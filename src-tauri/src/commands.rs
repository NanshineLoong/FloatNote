use crate::agent::{ActiveNote, AgentHandle, HostToSidecar, NoteUpdated, PendingEdit, SkillSummary};
use crate::chat_history::{
    ChatConversationIndexEntry, ChatHistoryStore, ChatScopeType, ChatTitleState,
};
use crate::watcher::{FileWatcher, SuppressList};
use crate::{
    config::{Config, WindowShortcuts},
    notes, project, versions,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

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
    /// apply_edit 待裁决表：request_id → PendingEdit。
    /// `handle_apply_edit` 暂存，`resolve_permission` 取出落盘并回 sidecar。
    pub pending_edits: Mutex<HashMap<String, PendingEdit>>,
    /// `agent_list_skills` 的 host 侧一次性等待表：call_id → oneshot sender。
    /// reader 线程收到 `SkillsList` 时取出 sender 解除等待。
    pub pending_skill_lists: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Vec<SkillSummary>>>>,
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
pub fn list_notes(dir: String) -> Result<Vec<notes::NoteEntry>, String> {
    notes::list_markdown(std::path::Path::new(&dir)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_note(path: String) -> Result<notes::NoteContent, String> {
    let content = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mtime = notes::mtime_millis(std::path::Path::new(&path));
    Ok(notes::NoteContent { content, mtime })
}

#[tauri::command]
pub fn write_note(
    state: State<AppState>,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
) -> Result<notes::WriteOutcome, String> {
    let p = std::path::Path::new(&path);
    if let Some(expected) = expected_mtime {
        if notes::mtime_millis(p) != Some(expected) {
            return Ok(notes::WriteOutcome {
                conflict: true,
                mtime: None,
            });
        }
    }
    crate::watcher::mark_self_write(&state.write_suppress, &path);
    notes::write_atomic(p, &content).map_err(|error| error.to_string())?;
    let mtime = notes::mtime_millis(p);
    Ok(notes::WriteOutcome {
        conflict: false,
        mtime,
    })
}

#[tauri::command]
pub fn create_note(
    state: State<AppState>,
    dir: String,
    title: Option<String>,
) -> Result<notes::NoteEntry, String> {
    let dir_path = std::path::PathBuf::from(&dir);
    std::fs::create_dir_all(&dir_path).map_err(|error| error.to_string())?;
    // When a title is supplied, sanitize it into the file stem so the new note
    // carries a meaningful name from the start. Without one, fall back to the
    // timestamp stem to preserve the legacy behavior other callers rely on.
    let stem = match title {
        Some(title) => project::sanitize_folder_name(&title),
        None => notes::timestamp_stem(chrono::Local::now().naive_local()),
    };
    let filename = notes::unique_filename(&dir_path, &stem);
    let path = dir_path.join(&filename);
    let path_str = path.to_string_lossy().to_string();
    crate::watcher::mark_self_write(&state.write_suppress, &path_str);
    notes::write_atomic(&path, "").map_err(|error| error.to_string())?;
    Ok(notes::NoteEntry {
        name: filename.trim_end_matches(".md").to_string(),
        path: path_str,
    })
}

#[tauri::command]
pub fn rename_note(
    state: State<AppState>,
    dir: String,
    old_name: String,
    new_stem: String,
) -> Result<String, String> {
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
    notes::write_atomic(std::path::Path::new(&path), &restored)
        .map_err(|error| error.to_string())?;
    Ok(restored)
}

fn chat_store() -> Result<ChatHistoryStore, String> {
    ChatHistoryStore::default_for_user().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_get_for_scope(
    scope_type: ChatScopeType,
    scope_path: String,
) -> Result<Option<ChatConversationIndexEntry>, String> {
    chat_store()?
        .get_for_scope(scope_type, &scope_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_create(
    app: tauri::AppHandle,
    scope_type: ChatScopeType,
    scope_path: String,
    scope_label: String,
) -> Result<ChatConversationIndexEntry, String> {
    let entry = chat_store()?
        .create(scope_type, &scope_path, &scope_label)
        .map_err(|error| error.to_string())?;
    let _ = crate::tray::refresh_menu(&app);
    Ok(entry)
}

#[tauri::command]
pub fn chat_list_for_scope(
    scope_type: ChatScopeType,
    scope_path: String,
) -> Result<Vec<ChatConversationIndexEntry>, String> {
    chat_store()?
        .list_for_scope(scope_type, &scope_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_list_recent(limit: usize) -> Result<Vec<ChatConversationIndexEntry>, String> {
    chat_store()?
        .list_recent(limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_list_all(
    cursor: usize,
    limit: usize,
) -> Result<Vec<ChatConversationIndexEntry>, String> {
    chat_store()?
        .list_all(cursor, limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_open(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Option<ChatConversationIndexEntry>, String> {
    let entry = chat_store()?
        .open(&conversation_id)
        .map_err(|error| error.to_string())?;
    let _ = crate::tray::refresh_menu(&app);
    Ok(entry)
}

#[tauri::command]
pub fn chat_update_title(
    app: tauri::AppHandle,
    conversation_id: String,
    title: String,
    title_state: ChatTitleState,
) -> Result<Option<ChatConversationIndexEntry>, String> {
    let entry = chat_store()?
        .update_title(&conversation_id, &title, title_state)
        .map_err(|error| error.to_string())?;
    let _ = crate::tray::refresh_menu(&app);
    Ok(entry)
}

#[tauri::command]
pub fn chat_delete(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Option<ChatConversationIndexEntry>, String> {
    let entry = chat_store()?
        .delete(&conversation_id)
        .map_err(|error| error.to_string())?;
    let _ = crate::tray::refresh_menu(&app);
    Ok(entry)
}

#[tauri::command]
pub fn chat_clear_before(app: tauri::AppHandle, timestamp: u64) -> Result<usize, String> {
    let removed = chat_store()?
        .clear_before(timestamp)
        .map_err(|error| error.to_string())?;
    let _ = crate::tray::refresh_menu(&app);
    Ok(removed)
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
    conversation_id: String,
    user_text: String,
) -> Result<String, String> {
    let seq = state.agent_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let request_id = format!("r{seq}");

    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::Prompt {
            request_id: request_id.clone(),
            conversation_id,
            user_text,
        })
        .map_err(|error| error.to_string())?;
    Ok(request_id)
}

#[tauri::command]
pub fn agent_new_session(
    state: State<AppState>,
    conversation_id: String,
    cwd: String,
    session_dir: String,
) -> Result<(), String> {
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::NewSession {
            conversation_id,
            cwd,
            session_dir,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_open_session(
    state: State<AppState>,
    conversation_id: String,
    session_file: String,
) -> Result<(), String> {
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::OpenSession {
            conversation_id,
            session_file,
        })
        .map_err(|error| error.to_string())
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

/// 读取笔记窗内快捷键绑定（笔记窗初始化与热重载时调用）。
#[tauri::command]
pub fn get_window_shortcuts(state: State<AppState>) -> WindowShortcuts {
    state.config.lock().unwrap().window_shortcuts.clone()
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

/// 笔记窗发布当前活动笔记，供 apply_write 定位文件。`kind` 与 `NoteTarget.kind`
/// 同语义（inbox/tasks/piece/doc），用于缺省 target 时判定 `can_snapshot`。
#[tauri::command]
pub fn set_active_note(
    state: State<AppState>,
    dir: String,
    note_id: String,
    path: String,
    kind: String,
) {
    *state.active_note.lock().unwrap() = Some(ActiveNote {
        dir,
        note_id,
        path,
        kind,
    });
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

/// 拉取 sidecar 的已加载 skill 列表（同步一次性请求-响应）。
///
/// 生成 call_id → 在 `pending_skill_lists` 装 oneshot sender → 发 `ListSkills`
/// → 等待 reader 线程收到 `SkillsList` 时解除。5s 超时避免悬挂。
#[tauri::command]
pub async fn agent_list_skills(app: tauri::AppHandle) -> Result<Vec<SkillSummary>, String> {
    let state = app.state::<AppState>();
    let seq = state.agent_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let call_id = format!("sl{seq}");

    let (tx, rx) = tokio::sync::oneshot::channel::<Vec<SkillSummary>>();
    state
        .pending_skill_lists
        .lock()
        .unwrap()
        .insert(call_id.clone(), tx);

    {
        let mut guard = state.agent.lock().unwrap();
        let agent = guard.as_mut().ok_or("助手未连接")?;
        agent
            .send(&HostToSidecar::ListSkills {
                call_id: call_id.clone(),
            })
            .map_err(|error| error.to_string())?;
    }

    match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
        Ok(Ok(skills)) => Ok(skills),
        Ok(Err(_)) => Err("skill 列表响应已丢弃".into()),
        Err(_) => {
            state
                .pending_skill_lists
                .lock()
                .unwrap()
                .remove(&call_id);
            Err("skill 列表超时".into())
        }
    }
}

/// 用户在 `permission://request` 气泡上裁决后调用：取出 `PendingEdit`，
/// 按决策完成落盘/拒绝，并回 sidecar `ApplyEditResult`。
///
/// - `decision != "allow"` → 回 denied，不动文件。
/// - allow → `handle_apply_edit_at` 落盘；仅当 `outcome.ok` 时才
///   `mark_self_write` 抑制 watcher、emit `note://updated`。
/// - 无论成功失败都回一条 `ApplyEditResult`（ok→version，error→error）；
///   `note://updated` 仅在成功时 emit（失败时前端不应重载）。
/// pending 缺失时静默返回，避免重复裁决。
#[tauri::command]
pub fn resolve_permission(
    app: tauri::AppHandle,
    state: State<AppState>,
    request_id: String,
    decision: String,
    write_mode: String,
) -> Result<(), String> {
    let pending = state.pending_edits.lock().unwrap().remove(&request_id);
    let Some(p) = pending else {
        return Ok(());
    };
    if decision != "allow" {
        let _ = state.agent.lock().unwrap().as_mut().map(|a| {
            a.send(&HostToSidecar::ApplyEditResult {
                call_id: p.call_id,
                ok: false,
                denied: Some(true),
                version: None,
                error: None,
            })
        });
        return Ok(());
    }
    // 先标记自身写入，再落盘（含并发校验与可选拍快照）；can_snapshot 由 handle_apply_edit 据
    // 解析后的 kind 预先算好存于 PendingEdit，resolve_permission 不再重算。
    crate::watcher::mark_self_write(&state.write_suppress, &p.path);
    let outcome = crate::agent::handle_apply_edit_at(
        &p.dir,
        &p.note_id,
        std::path::Path::new(&p.path),
        &p.old_content,
        &p.new_content,
        &write_mode,
        p.can_snapshot,
    );
    // 仅在成功时广播 note://updated。失败时不动前端。
    if outcome.ok {
        let _ = app.emit(
            "note://updated",
            &NoteUpdated {
                note_id: p.note_id.clone(),
                path: p.path.clone(),
                version: outcome.version.unwrap_or(0),
            },
        );
    }
    let _ = state.agent.lock().unwrap().as_mut().map(|a| {
        a.send(&HostToSidecar::ApplyEditResult {
            call_id: p.call_id,
            ok: outcome.ok,
            denied: Some(false),
            version: outcome.version,
            error: outcome.error,
        })
    });
    Ok(())
}

#[tauri::command]
pub fn apply_shortcuts(
    app: tauri::AppHandle,
    state: State<AppState>,
    capture: String,
    toggle: String,
    popup: String,
    window_shortcuts: WindowShortcuts,
) -> Result<(), String> {
    crate::shortcuts::apply(&app, &capture, &toggle, &popup)?;
    {
        let mut config = state.config.lock().unwrap();
        config.shortcut_capture = capture;
        config.shortcut_toggle = toggle;
        config.shortcut_popup = popup;
        config.window_shortcuts = window_shortcuts;
        crate::config::save(&state.config_path, &config).map_err(|error| error.to_string())?;
    }
    let _ = app.emit("window-shortcuts-changed", ());
    Ok(())
}

#[tauri::command]
pub fn set_auto_popup_mode(
    mode: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if mode != "off" && mode != "every" && mode != "modifier" {
        return Err(format!("无效的 auto_popup_mode: {mode}"));
    }
    {
        let mut config = state.config.lock().unwrap();
        config.auto_popup_mode = mode.clone();
        crate::config::save(&state.config_path, &config).map_err(|error| error.to_string())?;
    }
    if mode == "off" {
        crate::selection_monitor::uninstall();
    } else {
        crate::selection_monitor::install(app);
    }
    Ok(())
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
pub fn create_project(
    state: State<AppState>,
    root: String,
    name: String,
) -> Result<project::ProjectEntry, String> {
    let entry = project::create_project(std::path::Path::new(&root), &name)
        .map_err(|error| error.to_string())?;
    // 隐式自动记录：项目新建时，将其所在目录记为工作目录。这是工作目录的唯一来源
    // ——没有设置入口，用户也不感知。失败不阻塞项目创建本身。
    {
        let mut config = state.config.lock().unwrap();
        config.working_dir = Some(root.clone());
        if let Err(error) = crate::config::save(&state.config_path, &config) {
            eprintln!("warn: failed to persist working_dir: {error}");
        }
    }
    Ok(entry)
}

/// Open an existing folder as a project space: ensure `_inbox.md` exists (the
/// backend scaffolds an empty one if missing; the folder itself is never
/// created). The frontend picks the folder via the OS dialog. Mirrors
/// `create_project` by persisting `working_dir` to the folder's parent so "在
/// 当前目录新建" and `list_projects` stay consistent — a failed working_dir
/// write does not block opening (Inbox is already good), only logs a warning.
#[tauri::command]
pub fn open_existing_project(
    state: State<AppState>,
    dir: String,
) -> Result<project::ProjectEntry, String> {
    let dir_path = std::path::Path::new(&dir);
    let entry = project::open_existing_project(dir_path).map_err(|error| error.to_string())?;
    if let Some(parent) = dir_path.parent() {
        let parent_str = parent.to_string_lossy().to_string();
        if !parent_str.is_empty() {
            let mut config = state.config.lock().unwrap();
            config.working_dir = Some(parent_str);
            if let Err(error) = crate::config::save(&state.config_path, &config) {
                eprintln!("warn: failed to persist working_dir: {error}");
            }
        }
    }
    Ok(entry)
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

/// Open `url` in the user's default browser / handler. Used by quote-card link
/// clicks (the Tauri webview blocks external navigation by default). Platform:
/// `open` on macOS, `cmd /C start` on Windows, `xdg-open` elsewhere.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", "", &url]);
        c
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    cmd.status().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImageResult {
    pub filename: String,
    pub rel_path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportImageResult {
    pub source: String,
    pub rel_path: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn save_pasted_image(
    project_dir: String,
    suggested_stem: String,
    data_base64: String,
    mime: String,
) -> Result<SaveImageResult, String> {
    let dir = std::path::Path::new(&project_dir);
    let (filename, rel_path) = notes::save_pasted_image(dir, &suggested_stem, &data_base64, &mime)
        .map_err(|e| e.to_string())?;
    Ok(SaveImageResult { filename, rel_path })
}

#[tauri::command]
pub fn import_image_files(
    source_paths: Vec<String>,
    project_dir: String,
) -> Vec<ImportImageResult> {
    let dir = std::path::Path::new(&project_dir);
    notes::import_image_files(&source_paths, dir)
        .into_iter()
        .map(|(source, rel_path, error)| ImportImageResult {
            source,
            rel_path,
            error,
        })
        .collect()
}

pub fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("FloatNote"))
        .join("config.json")
}
