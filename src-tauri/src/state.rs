//! Managed app state: the single `AppState` struct constructed at startup
//! and shared across Tauri commands, the sidecar reader thread, the popup,
//! and the selection monitor. Pulled out of `commands.rs` so the command file
//! is a thin handler layer and the state root has its own home.

use crate::agent::{ActiveNote, AgentHandle, PendingEdit, SkillSummary};
use crate::config::Config;
use crate::popup::PopupCache;
use crate::watcher::{FileWatcher, SuppressList};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

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
    pub popup_cache: PopupCache,
    /// apply_edit 待裁决表：request_id → PendingEdit。
    /// `handle_apply_edit` 暂存，`resolve_permission` 取出落盘并回 sidecar。
    pub pending_edits: Mutex<HashMap<String, PendingEdit>>,
    /// `agent_list_skills` 的 host 侧一次性等待表：call_id → oneshot sender。
    /// reader 线程收到 `SkillsList` 时取出 sender 解除等待。
    pub pending_skill_lists:
        Mutex<HashMap<String, tokio::sync::oneshot::Sender<Vec<SkillSummary>>>>,
}
