//! apply_edit / get_note_text 命令处理：目标解析、权限暂存、落盘写入。
//!
//! `handle_apply_edit` / `handle_get_note_text` 由 runner 的读循环分派调用；
//! `handle_apply_edit_at` 是纯函数落盘逻辑，`commands::resolve_permission`
//! 在用户裁决后也直接调用它。

use crate::state::AppState;
use crate::versions;
use crate::project::{INBOX_FILE, TASKS_FILE};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

use super::protocol::{EditPreview, HostToSidecar, NoteTarget};

/// `handle_apply_edit_at` 的结果：是否成功、是否被拒、版本号、错误信息。
///
/// 抽离为结构体便于纯函数测试与 `resolve_permission` 组装回 `ApplyEditResult`。
#[derive(Debug, Clone, PartialEq)]
pub struct EditOutcome {
    pub ok: bool,
    pub denied: bool,
    pub version: Option<u32>,
    pub error: Option<String>,
}

/// `handle_apply_edit` 暂存的待裁决编辑：用户在 `permission://request` 气泡上
/// 点击 allow/deny 后，`resolve_permission` 取出此项完成落盘并回 sidecar。
///
/// `dir`/`note_id`/`path`/`can_snapshot` 是 `handle_apply_edit` 已解析好的目标
/// （来自 `resolve_target`），`resolve_permission` 直接复用、不再重算。
/// `can_snapshot` = 解析后的 kind == "piece"，决定是否允许 snapshot 写入模式。
#[derive(Debug, Clone)]
pub struct PendingEdit {
    pub call_id: String,
    pub old_content: String,
    pub new_content: String,
    pub dir: PathBuf,
    pub note_id: String,
    pub path: String,
    pub can_snapshot: bool,
}

/// 收到 apply_edit：解析 target、emit `permission://request` 给前端、暂存
/// `PendingEdit`。**不落盘、不回结果**——落盘与回 `ApplyEditResult` 发生在
/// 用户裁决后调用的 `resolve_permission` 命令里。
///
/// target 无法解析（无活动笔记）时**不**弹气泡、**不**暂存 pending，直接回
/// deny，避免 sidecar 在 call_id 上悬挂。
pub(super) fn handle_apply_edit(
    app: &AppHandle,
    call_id: String,
    conversation_id: String,
    target: Option<NoteTarget>,
    tool_name: String,
    old_content: String,
    new_content: String,
    preview: EditPreview,
) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let resolved = resolve_target(&state, target.as_ref());
    match resolved {
        Some((dir, note_id, path, kind)) => {
            let can_snapshot = kind == "piece";
            let request_id = call_id.clone();
            let mut payload = serde_json::json!({
                "request_id": request_id,
                "conversation_id": conversation_id,
                "tool_name": tool_name,
                "old_content": old_content,
                "new_content": new_content,
                "preview": preview,
                "can_snapshot": can_snapshot,
                "resolved_dir": dir.to_string_lossy(),
                "resolved_note_id": note_id,
                "resolved_path": path.to_string_lossy(),
            });
            if let Some(t) = &target {
                payload["target"] = serde_json::to_value(t).unwrap_or(serde_json::Value::Null);
            }
            let _ = app.emit("permission://request", &payload);
            state.pending_edits.lock().unwrap().insert(
                request_id,
                PendingEdit {
                    call_id,
                    old_content,
                    new_content,
                    dir,
                    note_id,
                    path: path.to_string_lossy().to_string(),
                    can_snapshot,
                },
            );
        }
        None => {
            // 无法定位目标笔记：无 pending 可待裁决，直接回 deny 解除 sidecar 等待。
            // 不 emit permission://request，前端不弹气泡。
            let _ = state.agent.lock().unwrap().as_mut().map(|a| {
                a.send(&HostToSidecar::ApplyEditResult {
                    call_id,
                    ok: false,
                    denied: Some(true),
                    version: None,
                    error: Some("无法定位目标笔记".into()),
                })
            });
        }
    }
}

/// 收到 get_note_text：按 `NoteTarget` 定位文件、读取内容、回 `NoteText`。
///
/// **总是回一条**（found=false 当文件缺失或 target 无法解析），避免 sidecar
/// 在 call_id 上悬挂。
pub(super) fn handle_get_note_text(
    app: &AppHandle,
    call_id: String,
    _conversation_id: String,
    target: Option<NoteTarget>,
) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let (content, found) = match resolve_target(&state, target.as_ref()) {
        Some((_, _, path, _)) => match std::fs::read_to_string(&path) {
            Ok(c) => (c, true),
            Err(_) => (String::new(), false),
        },
        None => (String::new(), false),
    };
    let _ = state.agent.lock().unwrap().as_mut().map(|a| {
        a.send(&HostToSidecar::NoteText {
            call_id,
            content,
            found,
        })
    });
}

/// 解析 `NoteTarget` → `(dir, note_id, path, kind)`。
///
/// 依据 `AppState.active_note`（当前活动笔记，携带其所在项目空间 dir、
/// note_id、文件 path 与 kind）：
/// - `None`（target 缺省）→ 当前活动笔记，沿用 active.kind。
/// - `Some(t)` 且 `inbox`/`tasks` → 项目空间根下固定文件名 `_inbox.md`/`_tasks.md`，
///   kind 取 t.kind。
/// - `Some(t)` 且 `piece`/`doc`/其它 → `t.name` 缺省回退到活动笔记；显式给出且与
///   活动 note_id 不同时，按 `<dir>/<name>.md` 解析（v1 简化：pieces 即以
///   文件名直存在项目空间根下）。kind 取 t.kind。
///
/// 返回的 `kind` 用于 `can_snapshot` 判定（仅 piece 可快照）。无活动笔记时返回 None。
fn resolve_target(
    state: &AppState,
    target: Option<&NoteTarget>,
) -> Option<(PathBuf, String, PathBuf, String)> {
    let active = state.active_note.lock().unwrap().clone()?;
    let dir = PathBuf::from(&active.dir);
    let (note_id, path, kind) = match target {
        None => (
            active.note_id.clone(),
            PathBuf::from(&active.path),
            active.kind.clone(),
        ),
        Some(t) => {
            let kind = t.kind.clone();
            let (note_id, path) = match t.kind.as_str() {
                "inbox" => ("_inbox".to_string(), dir.join(INBOX_FILE)),
                "tasks" => ("_tasks".to_string(), dir.join(TASKS_FILE)),
                // piece / doc / 未知 kind 一律按 piece 语义处理（v1 简化）。
                _ => match &t.name {
                    Some(name) if name == &active.note_id => {
                        (active.note_id.clone(), PathBuf::from(&active.path))
                    }
                    Some(name) => {
                        // 兼容传入带 `.md` 后缀的 name：取 stem 作为 note_id。
                        let stem = name.trim_end_matches(".md");
                        (stem.to_string(), dir.join(format!("{stem}.md")))
                    }
                    None => (active.note_id.clone(), PathBuf::from(&active.path)),
                },
            };
            (note_id, path, kind)
        }
    };
    Some((dir, note_id, path, kind))
}

/// 纯函数：并发校验 → （可选拍快照）→ 落盘，返回 `EditOutcome`。
///
/// 抽离便于单测；真实 `handle_apply_edit` 解析好 target 后委托给它，
/// `resolve_permission` 在用户裁决后也调用它完成实际写入。
///
/// - 并发校验：磁盘内容须等于 `old_content`，否则拒绝（"笔记已变更"）。
/// - 快照守卫：仅当 `write_mode == "snapshot"` 且 `can_snapshot`（target 为
///   piece）且 note_id 非 `_` 前缀时，把旧内容留作一版 AI 快照。
/// - 落盘是最后一步，任一前置失败均不改动文件。
pub fn handle_apply_edit_at(
    dir: &Path,
    note_id: &str,
    path: &Path,
    old_content: &str,
    new_content: &str,
    write_mode: &str,
    can_snapshot: bool,
) -> EditOutcome {
    let on_disk = std::fs::read_to_string(path).unwrap_or_default();
    if on_disk != old_content {
        return EditOutcome {
            ok: false,
            denied: false,
            version: None,
            error: Some("笔记已变更，请重读".to_string()),
        };
    }
    let version = if write_mode == "snapshot" && can_snapshot && !note_id.starts_with('_') {
        versions::snapshot(dir, note_id, old_content, "ai").ok()
    } else {
        None
    };
    // 落盘走 write_atomic（main 的 autosize 健壮性改进：原子写 + mtime 一致）。
    if let Err(e) = crate::notes::write_atomic(path, new_content) {
        return EditOutcome {
            ok: false,
            denied: false,
            version: None,
            error: Some(e.to_string()),
        };
    }
    EditOutcome {
        ok: true,
        denied: false,
        version,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_target_none_falls_back_to_active_note_kind() {
        // 直接构造 AppState 验证 resolve_target 的 None 分支与 kind 回传。
        use crate::state::AppState;
        use std::sync::Mutex;

        fn make_state(active: Option<crate::agent::ActiveNote>) -> AppState {
            AppState {
                config: Mutex::new(Config::default()),
                config_path: PathBuf::new(),
                agent: Mutex::new(None),
                agent_ready: Mutex::new(false),
                agent_spawn_error: Mutex::new(None),
                active_note: Mutex::new(active),
                agent_seq: AtomicU64::new(0),
                watcher: Mutex::new(None),
                write_suppress: crate::watcher::new_suppress_list(),
                popup_cache: crate::popup::PopupCache::default(),
                pending_edits: Mutex::new(HashMap::new()),
                pending_skill_lists: Mutex::new(HashMap::new()),
            }
        }

        use crate::config::Config;
        use std::collections::HashMap;
        use std::sync::atomic::AtomicU64;

        // 无活动笔记 → None
        let state = make_state(None);
        assert!(resolve_target(&state, None).is_none());

        // 活动笔记为 piece → None target 回退到 active，kind="piece" → can_snapshot 语义
        let state = make_state(Some(crate::agent::ActiveNote {
            dir: "/tmp/proj".into(),
            note_id: "piece".into(),
            path: "/tmp/proj/piece.md".into(),
            kind: "piece".into(),
        }));
        let (dir, note_id, path, kind) = resolve_target(&state, None).unwrap();
        assert_eq!(dir, PathBuf::from("/tmp/proj"));
        assert_eq!(note_id, "piece");
        assert_eq!(path, PathBuf::from("/tmp/proj/piece.md"));
        assert_eq!(kind, "piece");
        assert!(kind == "piece"); // can_snapshot would be true

        // 活动笔记为 inbox → kind="inbox" → can_snapshot 语义为 false
        let state = make_state(Some(crate::agent::ActiveNote {
            dir: "/tmp/proj".into(),
            note_id: "_inbox".into(),
            path: "/tmp/proj/_inbox.md".into(),
            kind: "inbox".into(),
        }));
        let (_, _, _, kind) = resolve_target(&state, None).unwrap();
        assert_eq!(kind, "inbox");
        assert!(kind != "piece"); // can_snapshot would be false

        // 显式 target=inbox 即使活动笔记是 piece，kind 也取 t.kind
        let state = make_state(Some(crate::agent::ActiveNote {
            dir: "/tmp/proj".into(),
            note_id: "piece".into(),
            path: "/tmp/proj/piece.md".into(),
            kind: "piece".into(),
        }));
        let (_, note_id, _, kind) = resolve_target(
            &state,
            Some(&NoteTarget {
                kind: "inbox".into(),
                name: None,
            }),
        )
        .unwrap();
        assert_eq!(note_id, "_inbox");
        assert_eq!(kind, "inbox");
    }

    #[test]
    fn apply_edit_direct_writes_without_snapshot() {
        let dir = tempdir();
        let path = dir.path().join("piece.md");
        std::fs::write(&path, "old").unwrap();
        // direct 模式：不快照
        let res = handle_apply_edit_at(dir.path(), "piece", &path, "old", "new", "direct", true);
        assert!(res.ok);
        assert_eq!(res.version, None);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn apply_edit_snapshot_for_piece_creates_version() {
        let dir = tempdir();
        let path = dir.path().join("piece.md");
        std::fs::write(&path, "old").unwrap();
        let res = handle_apply_edit_at(dir.path(), "piece", &path, "old", "new", "snapshot", true);
        assert!(res.ok);
        assert_eq!(res.version, Some(1));
        assert_eq!(
            versions::read_version(dir.path(), "piece", 1).unwrap(),
            "old"
        );
    }

    #[test]
    fn apply_edit_snapshot_ignored_for_inbox() {
        let dir = tempdir();
        let path = dir.path().join("_inbox.md");
        std::fs::write(&path, "old").unwrap();
        let res =
            handle_apply_edit_at(dir.path(), "_inbox", &path, "old", "new", "snapshot", false);
        assert!(res.ok);
        assert_eq!(res.version, None); // _ 前缀不快照
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn apply_edit_rejects_concurrent_change() {
        let dir = tempdir();
        let path = dir.path().join("piece.md");
        std::fs::write(&path, "user changed").unwrap(); // 磁盘已变
        let res = handle_apply_edit_at(dir.path(), "piece", &path, "old", "new", "direct", true);
        assert!(!res.ok);
        assert!(res.error.unwrap().contains("已变更"));
    }

    use crate::testutil::tempdir;
}
