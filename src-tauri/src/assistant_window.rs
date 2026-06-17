//! 独立助手窗编排：把它作为笔记窗的**原生子窗口**吸附在右缘。
//!
//! 嵌入/分离的「决策」在前端（按内容宽度分级），Rust 只负责落地独立窗：
//! - 设为 main 的原生子窗（macOS addChildWindow / Windows owner），随父窗移动，零延迟跟随；
//! - 显隐 + 定位/等高到笔记窗右缘。
//!
//! 不再加宽笔记窗、不再有「全屏强制嵌入」——这些都由前端宽度布局自然得出。

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

/// 独立助手窗宽度（逻辑像素）。
const PANE_WIDTH: f64 = 340.0;

/// 笔记窗隐藏前，独立助手窗是否可见——用于笔记窗再次显示时按原状态恢复。
/// 笔记窗只是被隐藏（非关闭），其 webview 仍在运行、不会触发前端重算布局，
/// 故助手窗的显隐必须由 Rust 在笔记窗显隐时一并处理，否则会留在屏幕上。
static SHOWN_WITH_NOTE: AtomicBool = AtomicBool::new(false);

/// 笔记窗隐藏时调用：记住助手窗当前是否可见，并一并隐藏它。
pub fn hide_with_note(app: &AppHandle) {
    let Some(assistant) = app.get_webview_window("assistant") else {
        return;
    };
    SHOWN_WITH_NOTE.store(assistant.is_visible().unwrap_or(false), Ordering::SeqCst);
    let _ = assistant.hide();
}

/// 笔记窗重新显示时调用：若助手窗在隐藏前可见，则恢复显示（重新吸附 + 挂回子窗）。
pub fn restore_with_note(app: &AppHandle) {
    if SHOWN_WITH_NOTE.load(Ordering::SeqCst) {
        set_window(app, true);
    }
}

/// 在启动时以 main 为父窗创建独立助手窗（透明、无边框、默认隐藏）。
///
/// 父子关系必须在创建时确定（Tauri 2 无运行时 set_parent），故不放进 tauri.conf.json，
/// 而在 main 就绪后用 builder 创建——这样它会作为 main 的原生子窗随父窗移动，零延迟跟随。
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let Some(main) = app.get_webview_window("main") else {
        return Ok(());
    };
    WebviewWindowBuilder::new(app, "assistant", WebviewUrl::App("assistant.html".into()))
        .title("")
        .inner_size(PANE_WIDTH, 520.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible(false)
        .parent(&main)?
        .build()?;
    Ok(())
}

/// 显示或隐藏独立助手窗（前端在 placement 切到/离开 detached 时调用）。
pub fn set_window(app: &AppHandle, show: bool) {
    let (Some(main), Some(assistant)) =
        (app.get_webview_window("main"), app.get_webview_window("assistant"))
    else {
        return;
    };

    if show {
        dock(&main, &assistant);
        let _ = assistant.show();
        // macOS：hide() 走 orderOut:，会把子窗从父窗 childWindows 中摘除；
        // 再 show() 走 orderFront: 并不会恢复父子关系，跟随会退化为事件重定位（迟一拍）。
        // 故每次显示后重新挂回，保证原生子窗零延迟跟随。Tauri 2.11 无运行时 set_parent，
        // 只能直接对 NSWindow 调 addChildWindow:。非 macOS 为 no-op，靠事件 dock() 兜底。
        reattach_child(&main, &assistant);
    } else {
        let _ = assistant.hide();
    }
}

/// macOS：把独立助手窗重新挂为笔记窗的原生子窗（`addChildWindow:ordered:`）。
/// 对已是子窗的窗口安全（仅重排序）。需在主线程调用——本函数由同步命令触发，已在主线程。
#[cfg(target_os = "macos")]
fn reattach_child(main: &WebviewWindow, assistant: &WebviewWindow) {
    use objc::runtime::Object;
    use objc::{msg_send, sel, sel_impl};

    let (Ok(parent), Ok(child)) = (main.ns_window(), assistant.ns_window()) else {
        return;
    };
    // NSWindowOrderingMode::NSWindowAbove == 1
    unsafe {
        let parent = parent as *mut Object;
        let child = child as *mut Object;
        let _: () = msg_send![parent, addChildWindow: child ordered: 1isize];
    }
}

#[cfg(not(target_os = "macos"))]
fn reattach_child(_main: &WebviewWindow, _assistant: &WebviewWindow) {}

/// 笔记窗移动/缩放时，若独立窗可见则重新吸附（等高、贴右缘）。
/// 子窗已随父窗移动，这里主要负责高度跟随与初次定位。
pub fn handle_main_geometry_change(app: &AppHandle) {
    let (Some(main), Some(assistant)) =
        (app.get_webview_window("main"), app.get_webview_window("assistant"))
    else {
        return;
    };
    if assistant.is_visible().unwrap_or(false) {
        dock(&main, &assistant);
    }
}

/// 把独立助手窗贴到笔记窗右缘，并与其等高。
fn dock(main: &WebviewWindow, assistant: &WebviewWindow) {
    let (Ok(pos), Ok(size)) = (main.outer_position(), main.outer_size()) else {
        return;
    };
    let scale = main.scale_factor().unwrap_or(1.0);
    let _ = assistant.set_position(PhysicalPosition::new(pos.x + size.width as i32, pos.y));
    let _ = assistant.set_size(PhysicalSize::new((PANE_WIDTH * scale) as u32, size.height));
}
