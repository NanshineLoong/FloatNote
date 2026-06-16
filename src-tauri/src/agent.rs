//! agent-sidecar 生命周期 + 行分隔 JSON 协议 + 事件转发 + apply_write 处理。
//!
//! Rust 是唯一状态源：拉起 Node sidecar 子进程，单独线程按行读 stdout，
//! 把流式事件经 Tauri `agent://event` 广播给所有助手视图；收到 `apply_write`
//! 时执行"快照旧版 → 写新内容 → 广播 `note://updated`"，再把结果回传 sidecar。

use crate::{commands::AppState, versions};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

/// Host → sidecar 消息。JSON 字段为 camelCase，与 Sprint 2 的 protocol.ts 对齐。
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum HostToSidecar {
    Configure {
        provider: String,
        model: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
    },
    Prompt {
        request_id: String,
        note_id: String,
        note_text: String,
        user_text: String,
    },
    ApplyWriteResult {
        call_id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Cancel {
        request_id: String,
    },
}

/// Sidecar → host 消息。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SidecarToHost {
    Ready,
    Delta {
        request_id: String,
        text: String,
    },
    Tool {
        request_id: String,
        name: String,
        phase: String,
    },
    ApplyWrite {
        call_id: String,
        note_id: String,
        content: String,
    },
    Done {
        request_id: String,
    },
    Error {
        request_id: Option<String>,
        message: String,
    },
}

/// 当前活动笔记：由笔记窗 `set_active_note` 发布、`agent_send` 也会更新，
/// 供 apply_write 定位 dir / path，并供独立助手窗 `get_active_note` 查询。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveNote {
    pub dir: String,
    pub note_id: String,
    pub path: String,
}

/// 活的 sidecar 子进程句柄：持有子进程与其 stdin。
pub struct AgentHandle {
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
}

impl AgentHandle {
    /// 经 stdin 发一条协议命令（行分隔 JSON）。
    pub fn send(&mut self, msg: &HostToSidecar) -> std::io::Result<()> {
        let mut line = serde_json::to_string(msg)?;
        line.push('\n');
        self.stdin.write_all(line.as_bytes())?;
        self.stdin.flush()
    }
}

/// 开发期 sidecar 启动命令：`npx tsx <repo>/sidecar/src/main.ts`。
/// 打包二进制留到 Sprint 6 处理。
fn sidecar_command() -> Command {
    // CARGO_MANIFEST_DIR = <repo>/src-tauri，其父目录即仓库根。
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let sidecar_dir = repo_root.join("sidecar");
    let main_ts = sidecar_dir.join("src").join("main.ts");

    let mut cmd = Command::new("npx");
    cmd.arg("tsx")
        .arg(main_ts)
        .current_dir(sidecar_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    cmd
}

/// 拉起 sidecar 子进程并起读线程；失败返回 io::Error（启动期仅打印不阻断）。
pub fn spawn(app: &AppHandle) -> std::io::Result<AgentHandle> {
    let mut child = sidecar_command().spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("sidecar stdout unavailable"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| std::io::Error::other("sidecar stdin unavailable"))?;

    let app = app.clone();
    std::thread::spawn(move || read_loop(app, stdout));

    Ok(AgentHandle { child, stdin })
}

/// 读 sidecar stdout：按行解析协议并分派；EOF（崩溃/退出）后标记不可用。
fn read_loop(app: AppHandle, stdout: ChildStdout) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("agent: stdout read error: {error}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<SidecarToHost>(&line) {
            Ok(msg) => handle_sidecar_msg(&app, msg),
            Err(error) => eprintln!("agent: bad protocol line ({error}): {line}"),
        }
    }
    on_sidecar_exit(&app);
}

/// 分派单条 sidecar 消息。
fn handle_sidecar_msg(app: &AppHandle, msg: SidecarToHost) {
    match msg {
        SidecarToHost::Ready => {
            if let Some(state) = app.try_state::<AppState>() {
                *state.agent_ready.lock().unwrap() = true;
            }
            let _ = app.emit("agent://event", &SidecarToHost::Ready);
        }
        SidecarToHost::ApplyWrite {
            call_id,
            note_id,
            content,
        } => handle_apply_write(app, call_id, note_id, content),
        other => {
            // Delta / Tool / Done / Error 直接转发给前端。
            let _ = app.emit("agent://event", &other);
        }
    }
}

/// 收到 apply_write：快照旧版 → 写新内容 → 广播 note://updated → 回 sidecar 结果。
fn handle_apply_write(app: &AppHandle, call_id: String, _note_id: String, content: String) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let active = state.active_note.lock().unwrap().clone();

    let reply = match active {
        Some(note) => {
            match apply_write(
                Path::new(&note.dir),
                &note.note_id,
                Path::new(&note.path),
                &content,
            ) {
                Ok(version) => {
                    let _ = app.emit(
                        "note://updated",
                        NoteUpdated {
                            note_id: note.note_id.clone(),
                            path: note.path.clone(),
                            version,
                        },
                    );
                    HostToSidecar::ApplyWriteResult {
                        call_id,
                        ok: true,
                        version: Some(version),
                        error: None,
                    }
                }
                Err(error) => HostToSidecar::ApplyWriteResult {
                    call_id,
                    ok: false,
                    version: None,
                    error: Some(error.to_string()),
                },
            }
        }
        None => HostToSidecar::ApplyWriteResult {
            call_id,
            ok: false,
            version: None,
            error: Some("no active note".to_string()),
        },
    };

    let mut guard = state.agent.lock().unwrap();
    if let Some(agent) = guard.as_mut() {
        let _ = agent.send(&reply);
    }
}

/// sidecar 退出/崩溃：标记不可用、清空句柄、发错误事件，绝不 panic。
fn on_sidecar_exit(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        *state.agent_ready.lock().unwrap() = false;
        *state.agent.lock().unwrap() = None;
    }
    let _ = app.emit(
        "agent://event",
        &SidecarToHost::Error {
            request_id: None,
            message: "助手已断开，请点击重连".to_string(),
        },
    );
}

/// note://updated 事件载荷。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NoteUpdated {
    note_id: String,
    path: String,
    version: u32,
}

/// 纯函数：把"即将被覆盖的旧内容"留作一版 AI 快照，再写入新内容，返回新版本号。
///
/// 抽离便于单测；任一步失败返回 io::Error，不破坏既有笔记（写盘是最后一步）。
pub fn apply_write(
    dir: &Path,
    note_id: &str,
    path: &Path,
    new_content: &str,
) -> std::io::Result<u32> {
    let old = std::fs::read_to_string(path).unwrap_or_default();
    let version = versions::snapshot(dir, note_id, &old, "ai")?;
    std::fs::write(path, new_content)?;
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_serializes_to_camel_case_json() {
        let msg = HostToSidecar::Prompt {
            request_id: "r1".into(),
            note_id: "note".into(),
            note_text: "全文".into(),
            user_text: "你好".into(),
        };
        let value: serde_json::Value = serde_json::from_str(&serde_json::to_string(&msg).unwrap()).unwrap();
        assert_eq!(value["type"], "prompt");
        assert_eq!(value["requestId"], "r1");
        assert_eq!(value["noteId"], "note");
        assert_eq!(value["noteText"], "全文");
        assert_eq!(value["userText"], "你好");
    }

    #[test]
    fn configure_omits_absent_api_key() {
        let msg = HostToSidecar::Configure {
            provider: "anthropic".into(),
            model: "claude".into(),
            api_key: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(!json.contains("apiKey"), "absent api key should be skipped: {json}");
    }

    #[test]
    fn apply_write_result_uses_call_id() {
        let msg = HostToSidecar::ApplyWriteResult {
            call_id: "w1".into(),
            ok: true,
            version: Some(3),
            error: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"apply_write_result\""), "{json}");
        assert!(json.contains("\"callId\":\"w1\""), "{json}");
        assert!(json.contains("\"version\":3"), "{json}");
    }

    #[test]
    fn parses_delta_line() {
        let line = r#"{"type":"delta","requestId":"r1","text":"hi"}"#;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        assert_eq!(
            msg,
            SidecarToHost::Delta {
                request_id: "r1".into(),
                text: "hi".into(),
            }
        );
    }

    #[test]
    fn parses_apply_write_line() {
        let line = r#"{"type":"apply_write","callId":"w1","noteId":"note","content":"new"}"#;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        assert_eq!(
            msg,
            SidecarToHost::ApplyWrite {
                call_id: "w1".into(),
                note_id: "note".into(),
                content: "new".into(),
            }
        );
    }

    #[test]
    fn parses_error_with_null_request_id() {
        let line = r#"{"type":"error","requestId":null,"message":"boom"}"#;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        assert_eq!(
            msg,
            SidecarToHost::Error {
                request_id: None,
                message: "boom".into(),
            }
        );
    }

    #[test]
    fn apply_write_snapshots_old_then_overwrites() {
        let dir = tempdir();
        let path = dir.path().join("note.md");
        std::fs::write(&path, "old content").unwrap();

        let version = apply_write(dir.path(), "note", &path, "new content").unwrap();

        assert_eq!(version, 1);
        // 旧内容被留作 v1。
        assert_eq!(versions::read_version(dir.path(), "note", 1).unwrap(), "old content");
        // 文件已被新内容覆盖。
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new content");
        // manifest 记录一条 ai 版本。
        let entries = versions::list(dir.path(), "note");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, "ai");
    }

    #[test]
    fn apply_write_handles_missing_old_file() {
        let dir = tempdir();
        let path = dir.path().join("fresh.md");

        let version = apply_write(dir.path(), "fresh", &path, "first").unwrap();

        assert_eq!(version, 1);
        assert_eq!(versions::read_version(dir.path(), "fresh", 1).unwrap(), "");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");
    }

    fn tempdir() -> TempDir {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let mut path = std::env::temp_dir();
        path.push(format!(
            "floatnote-agent-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        TempDir(path)
    }

    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
