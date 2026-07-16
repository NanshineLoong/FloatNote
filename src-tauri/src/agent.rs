//! agent-sidecar 生命周期、行分隔 JSON 协议与受控工作区事务。
//!
//! Rust 是唯一状态源：拉起 Node sidecar 子进程，单独线程按行读 stdout，
//! 把流式事件经 Tauri `agent://event` 广播给所有助手视图，并把虚拟工作区
//! 读取、审核租约和原子提交交给 Rust host 处理。
//!
//! 模块拆分：
//! - [`protocol`] — Host ↔ sidecar 的 serde 协议类型。
//! - [`workspace`] — 虚拟工作区读取与 mutation transaction。
//! - [`runner`] — sidecar spawn、stdout 读循环、消息分派、退出处理。

mod protocol;
mod runner;
pub(crate) mod workspace;

pub use protocol::*;
pub use runner::*;
pub(crate) use workspace::*;
