use crate::state::AppState;
use crate::{config::Config, notes, project, versions};
use std::path::PathBuf;
use tauri::{Emitter, Manager, State};

#[path = "commands/agent.rs"]
mod agent;
#[path = "commands/chat.rs"]
mod chat;
#[path = "commands/settings.rs"]
mod settings;
pub use agent::*;
pub use chat::*;
pub use settings::*;

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_config(app: tauri::AppHandle, state: State<AppState>, new_config: Config) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    *config = new_config;
    crate::config::save(&state.config_path, &config).map_err(|error| error.to_string())?;
    let _ = app.emit("appearance-changed", serde_json::json!({
        "theme": config.theme.clone(),
        "fontSize": config.font_size,
    }));
    Ok(())
}

#[tauri::command]
pub fn update_local_selection(state: State<AppState>, text: Option<String>) {
    state.local_selection.update(text);
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
    // Mark self-write on BOTH paths BEFORE the rename — the watcher sees a
    // Remove on the old path and a Create on the new one, so both must be in
    // the suppress window ahead of time (matches write_note/create_note order;
    // marking after, like the old code did, loses the race).
    let old_path = dir_path.join(format!("{old_name}.md"));
    let new_path = dir_path.join(format!("{new_stem}.md"));
    crate::watcher::mark_self_write(&state.write_suppress, &old_path.to_string_lossy());
    crate::watcher::mark_self_write(&state.write_suppress, &new_path.to_string_lossy());
    notes::rename_note(dir_path, &old_name, &new_stem).map_err(|error| error.to_string())?;
    versions::rename(dir_path, &old_name, &new_stem).map_err(|error| error.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
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
    state
        .authorized_roots
        .authorize(std::path::Path::new(&entry.path));
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
    state.authorized_roots.authorize(dir_path);
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
    state.authorized_roots.authorize(std::path::Path::new(&dir));
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
    if !is_safe_external_url(&url) {
        return Err("仅支持打开 http、https 或 mailto 链接".into());
    }
    crate::platform::UrlOpener::open(&crate::platform::SystemUrlOpener, &url)
}

/// Backend defence in depth for links. The renderer has the same allowlist,
/// but Tauri commands are callable from every WebView and must validate again.
fn is_safe_external_url(url: &str) -> bool {
    !url.is_empty()
        && url.trim() == url
        && !url.chars().any(char::is_control)
        && (url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:"))
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
    state: State<AppState>,
    project_dir: String,
    suggested_stem: String,
    data_base64: String,
    mime: String,
) -> Result<SaveImageResult, String> {
    let dir = std::path::Path::new(&project_dir);
    state.authorized_roots.authorize(dir);
    let (filename, rel_path) = notes::save_pasted_image(dir, &suggested_stem, &data_base64, &mime)
        .map_err(|e| e.to_string())?;
    Ok(SaveImageResult { filename, rel_path })
}

#[tauri::command]
pub fn import_image_files(
    state: State<AppState>,
    source_paths: Vec<String>,
    project_dir: String,
) -> Vec<ImportImageResult> {
    let dir = std::path::Path::new(&project_dir);
    state.authorized_roots.authorize(dir);
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

#[cfg(test)]
mod tests {
    use super::is_safe_external_url;

    #[test]
    fn external_url_allowlist_accepts_web_and_mailto_only() {
        assert!(is_safe_external_url("https://floatnote.app"));
        assert!(is_safe_external_url("http://localhost:3000"));
        assert!(is_safe_external_url("mailto:hello@example.com"));
        assert!(!is_safe_external_url("javascript:alert(1)"));
        assert!(!is_safe_external_url("data:text/html,boom"));
        assert!(!is_safe_external_url("file:///etc/passwd"));
        assert!(!is_safe_external_url("open -a Finder"));
    }
}
