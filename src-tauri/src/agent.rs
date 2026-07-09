//! agent-sidecar 生命周期 + 行分隔 JSON 协议 + 事件转发 + apply_edit 处理。
//!
//! Rust 是唯一状态源：拉起 Node sidecar 子进程，单独线程按行读 stdout，
//! 把流式事件经 Tauri `agent://event` 广播给所有助手视图；收到 `apply_edit`/
//! `get_note_text` 时分派到对应处理函数（Task 5 实装真实逻辑），再把
//! `apply_edit_result`/`note_text` 回传 sidecar。

use crate::{commands::AppState, versions};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};
/// Host → sidecar 消息。JSON 字段为 camelCase，与 Sprint 2 的 protocol.ts 对齐。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum HostToSidecar {
    Configure {
        provider: String,
        model: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        base_url: Option<String>,
    },
    OpenSession {
        conversation_id: String,
        session_file: String,
    },
    NewSession {
        conversation_id: String,
        cwd: String,
        session_dir: String,
    },
    Prompt {
        request_id: String,
        conversation_id: String,
        user_text: String,
    },
    ApplyEditResult {
        call_id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        denied: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    NoteText {
        call_id: String,
        content: String,
        found: bool,
    },
    Cancel {
        request_id: String,
    },
    /// 下发 skill 目录给 sidecar（启动时解析 bundled + 用户全局路径）。
    /// sidecar 收到后调 `skills.reload()`，把描述与全文读入内存。
    SetSkillPaths {
        skill_paths: Vec<String>,
    },
    /// 请求 sidecar 的已加载 skill 列表（同步一次性请求-响应）。
    /// sidecar 回 `SkillsList` 解除 host 侧 oneshot 等待。
    ListSkills {
        call_id: String,
    },
}

/// Sidecar → host 消息。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SidecarToHost {
    Ready,
    SessionOpened {
        conversation_id: String,
        session_file: String,
        messages: Vec<ChatDisplayMessage>,
    },
    Delta {
        request_id: String,
        conversation_id: String,
        text: String,
    },
    Tool {
        request_id: String,
        conversation_id: String,
        name: String,
        phase: String,
    },
    ApplyEdit {
        call_id: String,
        conversation_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        target: Option<NoteTarget>,
        tool_name: String,
        old_content: String,
        new_content: String,
        preview: EditPreview,
    },
    GetNoteText {
        call_id: String,
        conversation_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        target: Option<NoteTarget>,
    },
    Done {
        request_id: String,
        conversation_id: String,
    },
    Title {
        conversation_id: String,
        title: String,
    },
    Error {
        request_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        conversation_id: Option<String>,
        message: String,
    },
    /// 回复 `ListSkills`：已加载 skill 的 name + description。
    SkillsList {
        call_id: String,
        skills: Vec<SkillSummary>,
    },
}

/// skill 摘要：name + description。与 sidecar `skills_list` 的元素同形。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub name: String,
    pub description: String,
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "role",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ChatDisplayMessage {
    User { text: String, timestamp: u64 },
    Assistant { text: String, timestamp: u64 },
    Tool { label: String, timestamp: u64 },
    Error { text: String, timestamp: u64 },
}

/// 当前活动笔记：由笔记窗 `set_active_note` 发布、`agent_send` 也会更新，
/// 供 apply_edit / get_note_text 定位 dir / path，并供独立助手窗 `get_active_note` 查询。
/// `kind` 与 `NoteTarget.kind` 同语义（inbox/tasks/piece/doc），用于缺省 target 时
/// 决定 `can_snapshot`（仅 piece 可快照）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveNote {
    pub dir: String,
    pub note_id: String,
    pub path: String,
    pub kind: String,
}

/// 活的 sidecar 子进程句柄：持有子进程与其 stdin。
pub struct AgentHandle {
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
}

/// apply_edit / get_note_text 的目标笔记定位。
///
/// `kind` 取值与 sidecar `protocol.ts` 的 `NoteTarget` 一致：
/// `inbox`/`tasks`/`piece`/`doc`；`name` 仅在 `piece`/`doc` 时给出文件名。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteTarget {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// apply_edit 的预览细节（判别联合，`kind` 区分）。
///
/// 变体名用 `rename_all = "snake_case"` 序列化为 `diff`/`tag_assign`/
/// `tag_create`/`tag_delete`（与 TS 线格式一致）；字段名用
/// `rename_all_fields = "camelCase"` 序列化为 `hunks`/`blockPreview`/
/// `tagName`/`tagColor`/`markerCount`。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum EditPreviewDetail {
    Diff {
        hunks: String,
    },
    TagAssign {
        block_preview: String,
        tag_name: String,
        tag_color: String,
    },
    TagCreate {
        tag_name: String,
        tag_color: String,
    },
    TagDelete {
        tag_name: String,
        marker_count: u32,
    },
}

/// apply_edit 携带的编辑预览：工具名 + 摘要 + 详情。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditPreview {
    pub tool: String,
    pub summary: String,
    pub detail: EditPreviewDetail,
}

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
    /// 暂存以备日志/调试，当前 resolve_permission 不读取。
    #[allow(dead_code)]
    pub conversation_id: String,
    pub old_content: String,
    pub new_content: String,
    /// 默认写入模式（暂存时的初值 "direct"）；实际生效的 write_mode 由
    /// `resolve_permission` 的前端入参决定，此字段仅作记录，暂不读取。
    #[allow(dead_code)]
    pub write_mode: String,
    pub dir: PathBuf,
    pub note_id: String,
    pub path: String,
    pub can_snapshot: bool,
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

/// 开发期 sidecar 启动命令。
/// 优先使用 sidecar 本地安装的 tsx（`node_modules/.bin/tsx`），
/// 避免依赖全局 `npx`，提升从 Finder/Dock 启动时的可靠性。
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
                // 无条件下发 skill 目录（与 AI 凭据正交：picker 可在配置 AI 前拉取列表）。
                let skill_paths = resolve_skill_paths(app);
                {
                    let mut guard = state.agent.lock().unwrap();
                    if let Some(agent) = guard.as_mut() {
                        if !skill_paths.is_empty() {
                            let _ = agent.send(&HostToSidecar::SetSkillPaths { skill_paths });
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
        SidecarToHost::ApplyEdit {
            call_id,
            conversation_id,
            target,
            tool_name,
            old_content,
            new_content,
            preview,
        } => handle_apply_edit(
            app,
            call_id,
            conversation_id,
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
                let _ = store.update_title(
                    &conversation_id,
                    &title,
                    crate::chat_history::ChatTitleState::Final,
                );
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

/// 收到 apply_edit：解析 target、emit `permission://request` 给前端、暂存
/// `PendingEdit`。**不落盘、不回结果**——落盘与回 `ApplyEditResult` 发生在
/// 用户裁决后调用的 `resolve_permission` 命令里。
///
/// target 无法解析（无活动笔记）时**不**弹气泡、**不**暂存 pending，直接回
/// deny，避免 sidecar 在 call_id 上悬挂。
fn handle_apply_edit(
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
                    conversation_id,
                    old_content,
                    new_content,
                    write_mode: "direct".into(),
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
fn handle_get_note_text(
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
fn resolve_skill_paths(app: &AppHandle) -> Vec<String> {
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

    if let Some(home) = crate::chat_history::user_home_dir() {
        let user_skills = home.join(".floatnote").join("skills");
        if user_skills.is_dir() {
            paths.push(user_skills.to_string_lossy().into_owned());
        }
    }

    paths
}

/// note://updated 事件载荷。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteUpdated {
    pub note_id: String,
    pub path: String,
    pub version: u32,
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
                "inbox" => ("_inbox".to_string(), dir.join("_inbox.md")),
                "tasks" => ("_tasks".to_string(), dir.join("_tasks.md")),
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
        match versions::snapshot(dir, note_id, old_content, "ai") {
            Ok(v) => Some(v),
            Err(_) => None,
        }
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
    fn prompt_serializes_to_camel_case_json() {
        let msg = HostToSidecar::Prompt {
            request_id: "r1".into(),
            conversation_id: "c1".into(),
            user_text: "你好".into(),
        };
        let value: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&msg).unwrap()).unwrap();
        assert_eq!(value["type"], "prompt");
        assert_eq!(value["requestId"], "r1");
        assert_eq!(value["conversationId"], "c1");
        assert_eq!(value["userText"], "你好");
    }

    #[test]
    fn session_commands_serialize_to_camel_case_json() {
        let open = HostToSidecar::OpenSession {
            conversation_id: "c1".into(),
            session_file: "/tmp/c1.jsonl".into(),
        };
        let value: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&open).unwrap()).unwrap();
        assert_eq!(value["type"], "open_session");
        assert_eq!(value["conversationId"], "c1");
        assert_eq!(value["sessionFile"], "/tmp/c1.jsonl");

        let new_session = HostToSidecar::NewSession {
            conversation_id: "c2".into(),
            cwd: "/tmp/project".into(),
            session_dir: "/tmp/sessions".into(),
        };
        let value: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&new_session).unwrap()).unwrap();
        assert_eq!(value["type"], "new_session");
        assert_eq!(value["conversationId"], "c2");
        assert_eq!(value["sessionDir"], "/tmp/sessions");
    }

    #[test]
    fn configure_omits_absent_api_key() {
        let msg = HostToSidecar::Configure {
            provider: "anthropic".into(),
            model: "claude".into(),
            api_key: None,
            base_url: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(
            !json.contains("apiKey"),
            "absent api key should be skipped: {json}"
        );
        assert!(
            !json.contains("baseUrl"),
            "absent base url should be skipped: {json}"
        );
    }

    #[test]
    fn parses_delta_line() {
        let line = r#"{"type":"delta","requestId":"r1","conversationId":"c1","text":"hi"}"#;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        assert_eq!(
            msg,
            SidecarToHost::Delta {
                request_id: "r1".into(),
                conversation_id: "c1".into(),
                text: "hi".into(),
            }
        );
    }

    #[test]
    fn parses_error_with_null_request_id() {
        let line = r#"{"type":"error","requestId":null,"conversationId":"c1","message":"boom"}"#;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        assert_eq!(
            msg,
            SidecarToHost::Error {
                request_id: None,
                conversation_id: Some("c1".into()),
                message: "boom".into(),
            }
        );
    }

    #[test]
    fn parses_apply_edit_line() {
        let line = r##"{"type":"apply_edit","callId":"w1","conversationId":"c1","target":{"kind":"inbox"},"toolName":"set_tag","oldContent":"a","newContent":"b","preview":{"tool":"set_tag","summary":"s","detail":{"kind":"tag_assign","blockPreview":"块","tagName":"review","tagColor":"#e5484d"}}}"##;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        match msg {
            SidecarToHost::ApplyEdit {
                ref tool_name,
                ref target,
                ..
            } => {
                assert_eq!(tool_name, "set_tag");
                let t = target.as_ref().expect("target present");
                assert_eq!(t.kind, "inbox");
                assert!(t.name.is_none());
            }
            _ => panic!("not ApplyEdit"),
        }

        // Round-trip back to JSON and verify camelCase field names + snake_case type.
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"apply_edit\""), "{json}");
        assert!(json.contains("\"callId\":\"w1\""), "{json}");
        assert!(json.contains("\"conversationId\":\"c1\""), "{json}");
        assert!(json.contains("\"toolName\":\"set_tag\""), "{json}");
        assert!(json.contains("\"oldContent\":\"a\""), "{json}");
        assert!(json.contains("\"newContent\":\"b\""), "{json}");
        assert!(json.contains("\"blockPreview\":\"块\""), "{json}");
        assert!(json.contains("\"tagName\":\"review\""), "{json}");
        assert!(json.contains("\"tagColor\":\"#e5484d\""), "{json}");
    }

    #[test]
    fn apply_edit_omits_absent_target() {
        // target 缺省时序列化结果不应包含 target 字段。
        let msg = SidecarToHost::ApplyEdit {
            call_id: "w1".into(),
            conversation_id: "c1".into(),
            target: None,
            tool_name: "write_note".into(),
            old_content: "a".into(),
            new_content: "b".into(),
            preview: EditPreview {
                tool: "write_note".into(),
                summary: "s".into(),
                detail: EditPreviewDetail::Diff { hunks: "@@".into() },
            },
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(
            !json.contains("\"target\""),
            "absent target should be skipped: {json}"
        );
        // 反序列化回来仍是 None。
        let back: SidecarToHost = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn serializes_apply_edit_result_denied() {
        let msg = HostToSidecar::ApplyEditResult {
            call_id: "w1".into(),
            ok: false,
            denied: Some(true),
            version: None,
            error: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"apply_edit_result\""), "{json}");
        assert!(json.contains("\"callId\":\"w1\""), "{json}");
        assert!(json.contains("\"denied\":true"), "{json}");
    }

    #[test]
    fn parses_note_text_line() {
        let line = r#"{"type":"note_text","callId":"g1","content":"doc","found":true}"#;
        let msg: HostToSidecar = serde_json::from_str(line).unwrap();
        match msg {
            HostToSidecar::NoteText {
                call_id,
                found,
                content,
                ..
            } => {
                assert_eq!(call_id, "g1");
                assert!(found);
                assert_eq!(content, "doc");
            }
            _ => panic!("not NoteText"),
        }
    }

    #[test]
    fn set_skill_paths_serializes_camel_case() {
        let msg = HostToSidecar::SetSkillPaths {
            skill_paths: vec!["/a/skills".into(), "/b/skills".into()],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"set_skill_paths\""), "{json}");
        assert!(json.contains("\"skillPaths\""), "{json}");
        let back: HostToSidecar = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn list_skills_serializes_camel_case() {
        let msg = HostToSidecar::ListSkills {
            call_id: "sl1".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"list_skills\""), "{json}");
        assert!(json.contains("\"callId\":\"sl1\""), "{json}");
    }

    #[test]
    fn parses_skills_list_line() {
        let line = r#"{"type":"skills_list","callId":"sl1","skills":[{"name":"socratic-review","description":"追问"}]}"#;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        match msg {
            SidecarToHost::SkillsList { call_id, skills } => {
                assert_eq!(call_id, "sl1");
                assert_eq!(skills.len(), 1);
                assert_eq!(skills[0].name, "socratic-review");
                assert_eq!(skills[0].description, "追问");
            }
            _ => panic!("not SkillsList"),
        }
    }

    #[test]
    fn skills_list_round_trips() {
        let msg = SidecarToHost::SkillsList {
            call_id: "sl2".into(),
            skills: vec![
                SkillSummary {
                    name: "a".into(),
                    description: "desc a".into(),
                },
                SkillSummary {
                    name: "b".into(),
                    description: "desc b".into(),
                },
            ],
        };
        let json = serde_json::to_string(&msg).unwrap();
        let back: SidecarToHost = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn round_trips_edit_preview_detail_variants() {
        // diff
        let diff = EditPreviewDetail::Diff { hunks: "@@".into() };
        let v: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&diff).unwrap()).unwrap();
        assert_eq!(v["kind"], "diff");
        assert_eq!(v["hunks"], "@@");
        let back: EditPreviewDetail =
            serde_json::from_str(&serde_json::to_string(&diff).unwrap()).unwrap();
        assert_eq!(back, diff);

        // tag_create
        let tc = EditPreviewDetail::TagCreate {
            tag_name: "review".into(),
            tag_color: "#e5484d".into(),
        };
        let v: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&tc).unwrap()).unwrap();
        assert_eq!(v["kind"], "tag_create");
        assert_eq!(v["tagName"], "review");
        assert_eq!(v["tagColor"], "#e5484d");

        // tag_delete
        let td = EditPreviewDetail::TagDelete {
            tag_name: "review".into(),
            marker_count: 3,
        };
        let v: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&td).unwrap()).unwrap();
        assert_eq!(v["kind"], "tag_delete");
        assert_eq!(v["tagName"], "review");
        assert_eq!(v["markerCount"], 3);
    }

    #[test]
    fn round_trips_get_note_text_line() {
        let req = SidecarToHost::GetNoteText {
            call_id: "g1".into(),
            conversation_id: "c1".into(),
            target: Some(NoteTarget {
                kind: "piece".into(),
                name: Some("piece.md".into()),
            }),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"type\":\"get_note_text\""), "{json}");
        assert!(json.contains("\"callId\":\"g1\""), "{json}");
        assert!(json.contains("\"conversationId\":\"c1\""), "{json}");
        assert!(
            json.contains("\"target\":{\"kind\":\"piece\",\"name\":\"piece.md\"}"),
            "{json}"
        );
        let back: SidecarToHost = serde_json::from_str(&json).unwrap();
        assert_eq!(back, req);

        // target 缺省时序列化应省略 target 字段，反序列化回 None。
        let req_no_target = SidecarToHost::GetNoteText {
            call_id: "g2".into(),
            conversation_id: "c1".into(),
            target: None,
        };
        let json2 = serde_json::to_string(&req_no_target).unwrap();
        assert!(
            !json2.contains("\"target\""),
            "absent target should be skipped: {json2}"
        );
        let back2: SidecarToHost = serde_json::from_str(&json2).unwrap();
        assert_eq!(back2, req_no_target);
    }

    #[test]
    fn resolve_target_none_falls_back_to_active_note_kind() {
        // 直接构造 AppState 验证 resolve_target 的 None 分支与 kind 回传。
        use crate::commands::AppState;
        use std::sync::Mutex;

        fn make_state(active: Option<ActiveNote>) -> AppState {
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
        let state = make_state(Some(ActiveNote {
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
        let state = make_state(Some(ActiveNote {
            dir: "/tmp/proj".into(),
            note_id: "_inbox".into(),
            path: "/tmp/proj/_inbox.md".into(),
            kind: "inbox".into(),
        }));
        let (_, _, _, kind) = resolve_target(&state, None).unwrap();
        assert_eq!(kind, "inbox");
        assert!(kind != "piece"); // can_snapshot would be false

        // 显式 target=inbox 即使活动笔记是 piece，kind 也取 t.kind
        let state = make_state(Some(ActiveNote {
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
