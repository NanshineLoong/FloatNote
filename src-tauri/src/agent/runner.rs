//! sidecar 进程生命周期：spawn、stdout 读循环、消息分派、退出处理。
//!
//! 拉起 Node sidecar 子进程，单独线程按行读 stdout，把流式事件经 Tauri
//! `agent://event` 广播给所有助手视图；收到 `apply_edit`/`get_note_text` 时
//! 分派到 `handlers` 模块的处理函数。

use crate::state::AppState;
#[cfg(debug_assertions)]
use std::io::{BufRead, BufReader, Write};
#[cfg(debug_assertions)]
use std::path::{Path, PathBuf};
#[cfg(debug_assertions)]
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

use super::handlers::{
    handle_apply_edit, handle_create_note, handle_get_note_text, handle_list_notes,
};
use super::protocol::{HostToSidecar, SidecarToHost};

/// 活的 sidecar 子进程句柄：持有子进程与其 stdin。
pub struct AgentHandle {
    #[cfg(debug_assertions)]
    #[allow(dead_code)]
    child: Child,
    #[cfg(debug_assertions)]
    stdin: ChildStdin,
    #[cfg(not(debug_assertions))]
    child: tauri_plugin_shell::process::CommandChild,
}

impl AgentHandle {
    /// 经 stdin 发一条协议命令（行分隔 JSON）。
    pub fn send(&mut self, msg: &HostToSidecar) -> std::io::Result<()> {
        let mut line = serde_json::to_string(msg)?;
        line.push('\n');
        #[cfg(debug_assertions)]
        {
            self.stdin.write_all(line.as_bytes())?;
            return self.stdin.flush();
        }
        #[cfg(not(debug_assertions))]
        self.child
            .write(line.as_bytes())
            .map_err(std::io::Error::other)
    }
}

/// 开发期 sidecar 启动命令。
/// 优先使用 sidecar 本地安装的 tsx（`node_modules/.bin/tsx`），
/// 避免依赖全局 `npx`，提升从 Finder/Dock 启动时的可靠性。
#[cfg(debug_assertions)]
fn sidecar_command() -> Command {
    // CARGO_MANIFEST_DIR = <repo>/src-tauri，其父目录即仓库根。
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let sidecar_dir = repo_root.join("sidecar");
    let main_ts = sidecar_dir.join("src").join("main.ts");

    // 优先使用 sidecar 本地安装的 tsx，避免依赖全局 npx。
    let local_tsx = sidecar_dir.join("node_modules").join(".bin").join("tsx");
    let (program, leading_args): (PathBuf, &[&str]) = if local_tsx.exists() {
        (local_tsx, &[])
    } else {
        (PathBuf::from("npx"), &["tsx"])
    };

    let mut cmd = Command::new(&program);
    cmd.args(leading_args)
        .arg(&main_ts)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .current_dir(&sidecar_dir);

    // macOS: Tauri 从 Finder 启动时 PATH 不含用户 shell 配置中的 node 路径，
    // 补充常见 Node.js 安装位置以确保 tsx 脚本内的 node 能被找到。
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let existing = std::env::var("PATH").unwrap_or_default();
        let mut extras: Vec<String> = vec![
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ];
        // 扫描 nvm 安装目录，将所有已安装版本的 bin 加入 PATH。
        let nvm_dir = PathBuf::from(&home).join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin");
                if bin.is_dir() {
                    extras.push(bin.to_string_lossy().into_owned());
                }
            }
        }
        extras.push(existing);
        cmd.env("PATH", extras.join(":"));
    }

    cmd
}

/// 拉起 sidecar 子进程并起读线程；失败返回 io::Error（启动期仅打印不阻断）。
#[cfg(debug_assertions)]
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
#[cfg(debug_assertions)]
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
        handle_sidecar_line(&app, &line);
    }
    on_sidecar_exit(&app);
}

/// Release mode uses Tauri's external binary support. The bundled Node runtime
/// receives the bundled, self-contained ESM agent resource as its first arg;
/// neither the user's PATH nor the source checkout is involved.
#[cfg(not(debug_assertions))]
pub fn spawn(app: &AppHandle) -> std::io::Result<AgentHandle> {
    let resource = app
        .path()
        .resource_dir()
        .map_err(std::io::Error::other)?
        .join("sidecar")
        .join("floatnote-agent.mjs");
    if !resource.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("bundled sidecar resource missing: {}", resource.display()),
        ));
    }
    let command = app
        .shell()
        .sidecar("floatnote-node")
        .map_err(std::io::Error::other)?
        .arg(resource.to_string_lossy().into_owned());
    let (mut events, child) = command.spawn().map_err(std::io::Error::other)?;
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut buffer = String::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(newline) = buffer.find('\n') {
                        let line = buffer[..newline].to_string();
                        buffer.drain(..=newline);
                        handle_sidecar_line(&app_handle, &line);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("agent: {}", String::from_utf8_lossy(&bytes).trim());
                }
                _ => {}
            }
        }
        if !buffer.trim().is_empty() {
            handle_sidecar_line(&app_handle, &buffer);
        }
        on_sidecar_exit(&app_handle);
    });
    Ok(AgentHandle { child })
}

fn handle_sidecar_line(app: &AppHandle, line: &str) {
    if line.trim().is_empty() {
        return;
    }
    match serde_json::from_str::<SidecarToHost>(line) {
        Ok(msg) => handle_sidecar_msg(app, msg),
        Err(error) => eprintln!("agent: bad protocol line ({error}): {line}"),
    }
}

/// 分派单条 sidecar 消息。
fn handle_sidecar_msg(app: &AppHandle, msg: SidecarToHost) {
    match msg {
        SidecarToHost::Ready => {
            if let Some(state) = app.try_state::<AppState>() {
                *state.agent_ready.lock().unwrap() = true;
                // 无条件下发 skill 目录（与 AI 凭据正交：picker 可在配置 AI 前拉取列表）。
                let skill_paths = skill_paths_for_app(app);
                {
                    let mut guard = state.agent.lock().unwrap();
                    if let Some(agent) = guard.as_mut() {
                        if !skill_paths.is_empty() {
                            let disabled_skill_names = state.config.lock().unwrap().disabled_skills.clone();
                            let _ = agent.send(&HostToSidecar::SetSkillPaths { skill_paths, disabled_skill_names });
                        }
                    }
                }
                // 从持久化配置自动恢复 AI 助手。
                let config = state.config.lock().unwrap().clone();
                if !config.ai_provider.is_empty() && !config.ai_model.is_empty() {
                    let mut guard = state.agent.lock().unwrap();
                    if let Some(agent) = guard.as_mut() {
                        let _ = agent.send(&HostToSidecar::Configure {
                            provider: config.ai_provider,
                            model: config.ai_model,
                            api_key: if config.ai_api_key.is_empty() {
                                None
                            } else {
                                Some(config.ai_api_key)
                            },
                            base_url: if config.ai_base_url.is_empty() {
                                None
                            } else {
                                Some(config.ai_base_url)
                            },
                        });
                    }
                }
            }
            let _ = app.emit("agent://event", &SidecarToHost::Ready);
        }
        SidecarToHost::SessionOpened {
            conversation_id,
            session_file,
            messages,
        } => {
            if let Ok(store) = crate::chat_history::ChatHistoryStore::default_for_user() {
                let model = app
                    .try_state::<AppState>()
                    .map(|state| state.config.lock().unwrap().ai_model.clone())
                    .unwrap_or_default();
                let saved_messages = messages
                    .iter()
                    .filter_map(|message| match message {
                        super::protocol::ChatDisplayMessage::User { text, timestamp } => {
                            Some(crate::chat_history::ChatHistoryMessage {
                                role: "user".into(),
                                text: text.clone(),
                                timestamp: *timestamp,
                            })
                        }
                        super::protocol::ChatDisplayMessage::Assistant { text, timestamp } => {
                            Some(crate::chat_history::ChatHistoryMessage {
                                role: "assistant".into(),
                                text: text.clone(),
                                timestamp: *timestamp,
                            })
                        }
                        _ => None,
                    })
                    .collect();
                let tools = messages
                    .iter()
                    .filter_map(|message| match message {
                        super::protocol::ChatDisplayMessage::Tool { label, timestamp } => {
                            Some(crate::chat_history::ChatToolSummary {
                                name: label.clone(),
                                status: "completed".into(),
                                timestamp: *timestamp,
                            })
                        }
                        _ => None,
                    })
                    .collect();
                let _ =
                    store.update_session_history(&conversation_id, model, saved_messages, tools);
            }
            let _ = app.emit(
                "agent://event",
                &SidecarToHost::SessionOpened {
                    conversation_id,
                    session_file,
                    messages,
                },
            );
        }
        SidecarToHost::ApplyEdit {
            call_id,
            conversation_id,
            tool_call_id,
            target,
            tool_name,
            old_content,
            new_content,
            preview,
        } => handle_apply_edit(
            app,
            call_id,
            conversation_id,
            tool_call_id,
            target,
            tool_name,
            old_content,
            new_content,
            preview,
        ),
        SidecarToHost::GetNoteText {
            call_id,
            conversation_id,
            target,
        } => handle_get_note_text(app, call_id, conversation_id, target),
        SidecarToHost::ListNotes { call_id, .. } => handle_list_notes(app, call_id),
        SidecarToHost::CreateNote {
            call_id,
            conversation_id,
            tool_call_id,
            title,
            content,
            preview,
        } => handle_create_note(
            app,
            call_id,
            conversation_id,
            tool_call_id,
            title,
            content,
            preview,
        ),
        SidecarToHost::SkillsList { call_id, skills } => {
            // 同步一次性请求-响应：取出 host 侧 oneshot sender 解除等待。
            if let Some(state) = app.try_state::<AppState>() {
                if let Some(sender) = state.pending_skill_lists.lock().unwrap().remove(&call_id) {
                    let _ = sender.send(skills);
                }
            }
        }
        SidecarToHost::Title {
            conversation_id,
            title,
        } => {
            if let Ok(store) = crate::chat_history::ChatHistoryStore::default_for_user() {
                let _ = store.update_generated_title(&conversation_id, &title);
            }
            let _ = crate::tray::refresh_menu(app);
            let _ = app.emit(
                "agent://event",
                &SidecarToHost::Title {
                    conversation_id,
                    title,
                },
            );
        }
        other => {
            // Delta / Tool / Done / Error 直接转发给前端。
            let _ = app.emit("agent://event", &other);
        }
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
            conversation_id: None,
            message: "助手已断开，请点击重连".to_string(),
        },
    );
}

/// 解析 skill 目录列表，下发给 sidecar。
///
/// - bundled：打包后走 Tauri 资源目录 `resource_dir()/skills`。
/// - dev 回退：`tauri dev` 下资源目录不含源码 `resources/skills`，回退到
///   `CARGO_MANIFEST_DIR/resources/skills`（编译期固化，仅 debug 构建有效）。
/// - 用户全局：`~/.floatnote/skills`（用户自建，复用 chat_history 的 home 解析）。
///
/// 仅返回已存在的目录；全无则空 vec（降级，不崩）。
pub fn skill_paths_for_app(app: &AppHandle) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();

    let bundled = app.path().resource_dir().ok().map(|d| d.join("skills"));
    let bundled_exists = bundled.as_ref().is_some_and(|d| d.is_dir());
    if bundled_exists {
        paths.push(bundled.unwrap().to_string_lossy().into_owned());
    }

    #[cfg(debug_assertions)]
    if !bundled_exists {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("skills");
        if dev.is_dir() {
            paths.push(dev.to_string_lossy().into_owned());
        }
    }

    if let Some(floatnote) = crate::paths::floatnote_home() {
        let user_skills = floatnote.join("skills");
        if user_skills.is_dir() {
            paths.push(user_skills.to_string_lossy().into_owned());
        }
    }

    paths
}
