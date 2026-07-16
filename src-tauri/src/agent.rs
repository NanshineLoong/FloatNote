//! agent-sidecar 生命周期 + 行分隔 JSON 协议 + 事件转发 + apply_edit 处理。
//!
//! Rust 是唯一状态源：拉起 Node sidecar 子进程，单独线程按行读 stdout，
//! 把流式事件经 Tauri `agent://event` 广播给所有助手视图；收到 `apply_edit`/
//! `get_note_text` 时分派到对应处理函数（Task 5 实装真实逻辑），再把
//! `apply_edit_result`/`note_text` 回传 sidecar。
//!
//! 模块拆分：
//! - [`protocol`] — Host ↔ sidecar 的 serde 协议类型。
//! - [`handlers`] — `apply_edit`/`get_note_text`/`handle_apply_edit_at` 处理。
//! - [`runner`] — sidecar spawn、stdout 读循环、消息分派、退出处理。

mod handlers;
mod protocol;
mod runner;
pub(crate) mod workspace;

pub use handlers::*;
pub use protocol::*;
pub use runner::*;
