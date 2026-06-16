//! 助手窗口编排：分离/嵌入模式落地、独立窗吸附在笔记窗右缘。
//!
//! Rust 是模式与开关的状态源（存 `config`）。`apply` 据此：
//! - 调整笔记窗宽度（嵌入时加宽容纳右侧栏）；
//! - 显隐独立助手窗并吸附到笔记窗右缘；
//! - 广播 `assistant://embedded` 事件让笔记窗前端切换嵌入栏。

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

/// 笔记窗基础宽度（逻辑像素），与 tauri.conf.json 的 main.width 对齐。
const NOTE_WIDTH: f64 = 380.0;
/// 嵌入栏 / 独立助手窗宽度（逻辑像素），与 assistant.width 对齐。
const PANE_WIDTH: f64 = 340.0;

/// 广播给前端的嵌入状态。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EmbeddedEvent {
    embedded: bool,
    open: bool,
}

/// 根据 mode/open 落地助手的显隐与布局。
pub fn apply(app: &AppHandle, mode: &str, open: bool) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let assistant = app.get_webview_window("assistant");

    let embedded = open && mode == "embedded";
    let detached = open && mode == "detached";

    // 嵌入时加宽笔记窗以容纳右侧栏，否则恢复基础宽度。
    set_main_width(&main, if embedded { NOTE_WIDTH + PANE_WIDTH } else { NOTE_WIDTH });

    if let Some(assistant) = &assistant {
        if detached {
            dock(&main, assistant);
            let _ = assistant.show();
        } else {
            let _ = assistant.hide();
        }
    }

    let _ = app.emit("assistant://embedded", EmbeddedEvent { embedded, open });
}

/// 把独立助手窗贴到笔记窗右缘，并与其等高。
pub fn dock(main: &WebviewWindow, assistant: &WebviewWindow) {
    let (Ok(pos), Ok(size)) = (main.outer_position(), main.outer_size()) else {
        return;
    };
    let scale = main.scale_factor().unwrap_or(1.0);
    let _ = assistant.set_position(PhysicalPosition::new(pos.x + size.width as i32, pos.y));
    let _ = assistant.set_size(PhysicalSize::new((PANE_WIDTH * scale) as u32, size.height));
}

/// 笔记窗移动/缩放时，若处于分离且展开态，让独立窗跟随吸附。
pub fn redock_if_detached(app: &AppHandle, mode: &str, open: bool) {
    if !(open && mode == "detached") {
        return;
    }
    if let (Some(main), Some(assistant)) = (
        app.get_webview_window("main"),
        app.get_webview_window("assistant"),
    ) {
        dock(&main, &assistant);
    }
}

/// 只改宽度、保持当前高度（逻辑像素）。
fn set_main_width(main: &WebviewWindow, width: f64) {
    let scale = main.scale_factor().unwrap_or(1.0);
    let height = main
        .inner_size()
        .map(|s| s.height as f64 / scale)
        .unwrap_or(520.0);
    let _ = main.set_size(LogicalSize::new(width, height));
}
