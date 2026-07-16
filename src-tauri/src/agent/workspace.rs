use super::protocol::{HostToSidecar, WorkspaceEntry};
use crate::project::{INBOX_FILE, TASKS_FILE};
use crate::state::AppState;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Rewrite/create are consumed by the mutation transaction added in Task 6.
pub enum ResolveMode {
    ReadExisting,
    RewriteExisting,
    CreatePiece,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedWorkspaceFile {
    pub path: PathBuf,
    pub note_id: String,
    pub kind: String,
}

fn single_file_name(value: &str) -> Result<&str, String> {
    let path = Path::new(value);
    let mut components = path.components();
    let name = match (components.next(), components.next()) {
        (Some(Component::Normal(name)), None) => name.to_str().ok_or("路径必须是 UTF-8")?,
        _ => return Err("路径必须是当前项目根目录中的文件名".into()),
    };
    if name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || name == "."
        || name == ".."
    {
        return Err("路径不能包含目录或遍历片段".into());
    }
    Ok(name)
}

fn classify_file_name(name: &str) -> Result<(&str, &str), String> {
    match name {
        INBOX_FILE => Ok(("_inbox", "inbox")),
        TASKS_FILE => Ok(("_tasks", "tasks")),
        _ if name.starts_with('_') => Err("不支持访问该系统文件".into()),
        _ if name.ends_with(".md") && name.len() > 3 => Ok((name.trim_end_matches(".md"), "piece")),
        _ => Err("只支持当前项目中的 Markdown 笔记".into()),
    }
}

fn canonical_project_root(dir: &Path) -> Result<PathBuf, String> {
    if !dir.is_dir() {
        return Err("当前项目目录不存在".into());
    }
    dir.canonicalize()
        .map_err(|error| format!("无法解析当前项目路径：{error}"))
}

pub fn resolve_project_file(
    dir: &Path,
    virtual_path: &str,
    mode: ResolveMode,
) -> Result<ResolvedWorkspaceFile, String> {
    let name = single_file_name(virtual_path)?;
    let (note_id, kind) = classify_file_name(name)?;
    let root = canonical_project_root(dir)?;
    let joined = root.join(name);

    match mode {
        ResolveMode::CreatePiece => {
            if kind != "piece" {
                return Err("Agent 只能创建新的 piece，不能创建系统文件".into());
            }
            if joined.exists() {
                return Err("同名文档已存在".into());
            }
            let parent = joined
                .parent()
                .ok_or("无法解析目标目录")?
                .canonicalize()
                .map_err(|error| format!("无法解析目标目录：{error}"))?;
            if parent != root {
                return Err("目标路径不在当前项目中".into());
            }
        }
        ResolveMode::ReadExisting | ResolveMode::RewriteExisting => {
            if !joined.is_file() {
                return Err("笔记不存在".into());
            }
            let real = joined
                .canonicalize()
                .map_err(|error| format!("无法解析笔记路径：{error}"))?;
            if !real.starts_with(&root) || real.parent() != Some(root.as_path()) {
                return Err("笔记路径不在当前项目中".into());
            }
            return Ok(ResolvedWorkspaceFile {
                path: real,
                note_id: note_id.into(),
                kind: kind.into(),
            });
        }
    }

    Ok(ResolvedWorkspaceFile {
        path: joined,
        note_id: note_id.into(),
        kind: kind.into(),
    })
}

pub fn list_project_space(dir: &Path) -> Result<Vec<WorkspaceEntry>, String> {
    let root = canonical_project_root(dir)?;
    let mut entries = Vec::new();
    for (name, kind) in [(INBOX_FILE, "inbox"), (TASKS_FILE, "tasks")] {
        if resolve_project_file(&root, name, ResolveMode::ReadExisting).is_ok() {
            entries.push(WorkspaceEntry {
                path: name.into(),
                kind: kind.into(),
            });
        }
    }

    let mut pieces = std::fs::read_dir(&root)
        .map_err(|error| format!("无法列出当前项目：{error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.starts_with('_') && name.ends_with(".md") && name.len() > 3)
        .filter(|name| resolve_project_file(&root, name, ResolveMode::ReadExisting).is_ok())
        .collect::<Vec<_>>();
    pieces.sort();
    entries.extend(pieces.into_iter().map(|path| WorkspaceEntry {
        path,
        kind: "piece".into(),
    }));
    Ok(entries)
}

fn active_project_dir(state: &AppState) -> Result<PathBuf, String> {
    let active = state
        .active_note
        .lock()
        .unwrap()
        .clone()
        .ok_or("当前没有活动项目")?;
    let dir = PathBuf::from(active.dir);
    if !crate::project::is_project_dir(&dir) {
        return Err("当前没有活动的 FloatNote project space".into());
    }
    Ok(dir)
}

pub(super) fn handle_workspace_list(app: &AppHandle, call_id: String) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let result = active_project_dir(&state).and_then(|dir| list_project_space(&dir));
    let (entries, error) = match result {
        Ok(entries) => (entries, None),
        Err(error) => (Vec::new(), Some(error)),
    };
    let _ = state.agent.lock().unwrap().as_mut().map(|agent| {
        agent.send(&HostToSidecar::WorkspaceListResult {
            call_id,
            entries,
            error,
        })
    });
}

pub(super) fn handle_workspace_read(app: &AppHandle, call_id: String, path: String) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let result = active_project_dir(&state)
        .and_then(|dir| resolve_project_file(&dir, &path, ResolveMode::ReadExisting))
        .and_then(|resolved| {
            std::fs::read_to_string(resolved.path).map_err(|error| format!("无法读取笔记：{error}"))
        });
    let (found, content, error) = match result {
        Ok(content) => (true, Some(content), None),
        Err(error) => (false, None, Some(error)),
    };
    let _ = state.agent.lock().unwrap().as_mut().map(|agent| {
        agent.send(&HostToSidecar::WorkspaceReadResult {
            call_id,
            found,
            content,
            error,
        })
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::tempdir;

    #[test]
    fn lists_only_project_space_markdown() {
        let dir = tempdir();
        std::fs::write(dir.path().join("_inbox.md"), "inbox").unwrap();
        std::fs::write(dir.path().join("_tasks.md"), "tasks").unwrap();
        std::fs::write(dir.path().join("piece.md"), "piece").unwrap();
        std::fs::write(dir.path().join("_private.md"), "private").unwrap();
        std::fs::write(dir.path().join("image.png"), "png").unwrap();

        let entries = list_project_space(dir.path()).unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            vec!["_inbox.md", "_tasks.md", "piece.md"]
        );
    }

    #[test]
    fn rejects_traversal_subdirectories_and_unknown_system_files() {
        let dir = tempdir();
        for path in [
            "../escape.md",
            "nested/a.md",
            "nested\\a.md",
            "_private.md",
            "/tmp/a.md",
            r"C:\temp\a.md",
        ] {
            assert!(
                resolve_project_file(dir.path(), path, ResolveMode::ReadExisting).is_err(),
                "{path}"
            );
        }
    }

    #[test]
    fn create_mode_accepts_only_a_missing_piece() {
        let dir = tempdir();
        assert!(resolve_project_file(dir.path(), "Ideas.md", ResolveMode::CreatePiece).is_ok());
        assert!(resolve_project_file(dir.path(), "_tasks.md", ResolveMode::CreatePiece).is_err());
        assert!(resolve_project_file(dir.path(), "Ideas.MD", ResolveMode::CreatePiece).is_err());
        std::fs::write(dir.path().join("Ideas.md"), "exists").unwrap();
        assert!(resolve_project_file(dir.path(), "Ideas.md", ResolveMode::CreatePiece).is_err());
        assert!(resolve_project_file(dir.path(), "Ideas.md", ResolveMode::RewriteExisting).is_ok());
    }
}
