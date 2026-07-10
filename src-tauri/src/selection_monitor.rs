//! 自动划词悬浮窗触发器：用一个全局 CGEventTap 监听 `leftMouseUp`，按
//! `auto_popup_mode` 决定是否调用既有的 `popup::run_popup_capture`。
//!
//! 设计要点：
//! - **C 回调而非 ObjC block**：`CGEventTapCreate` 接受一个 `extern "C" fn` 指针，
//!   不需要在 objc2 0.2 里构造 block，复用 `capture.rs` 里声明 extern C 的既有风格。
//! - **只听不改**：`kCGEventTapOptionListen`，回调原样返回事件，绝不拦截/吞掉输入。
//! - **不在 run loop 线程上做长任务**：回调里只做廉价的模式/修饰键判断，命中后
//!   `thread::spawn` 跑 `run_popup_capture`（其内部含 150ms 剪贴板等待），避免阻塞
//!   主 run loop（鼠标抬起频率远高于快捷键）。
//! - **复用既有管线**：`CaptureGuard` 重入保护、`check_accessibility`、
//!   `read_selection`/`simulate_copy`、`cursor::get_cursor_pos`、`PopupCache`、
//!   `submit_popup_capture`/`dismiss_popup` 全部原样复用，本模块只改「谁来调用」。
//!
//! 权限：全局鼠标事件 tap 在 macOS 上需要辅助功能（已由 `check_accessibility` 处理），
//! 部分版本另需「输入监控」。tap 创建失败（返回 NULL）时静默退化为不触发，并复用
//! 既有 `accessibility-needed` 横幅提示用户去系统设置授权。

use std::ffi::c_void;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
mod cg {
    use std::ffi::c_void;

    // CGEventTapLocation
    pub const KCG_SESSION_EVENT_TAP: i32 = 1; // kCGSessionEventTap
                                              // CGEventTapPlacement
    pub const KCG_HEAD_INSERT_EVENT_TAP: i32 = 0;
    // CGEventTapOptions
    pub const KCG_EVENT_TAP_OPTION_LISTEN: u32 = 1; // 只听不改
                                                    // CGEventType
    pub const KCG_LEFT_MOUSE_DOWN: u32 = 1;
    pub const KCG_LEFT_MOUSE_UP: u32 = 2;
    // CGEventMask = 1 << eventType。同时听 down+up：down 记起点，up 算位移判断真选区。
    pub const EVENT_MASK: u64 = (1u64 << KCG_LEFT_MOUSE_DOWN) | (1u64 << KCG_LEFT_MOUSE_UP);
    // CGEventFlags — NSEventModifierFlagOption（与 capture.rs::cg::MASK_OPTION 一致）
    pub const MASK_OPTION: u64 = 0x0008_0000;
    // 拖动距离阈值（屏幕点）：小于此值且非多次点击视为纯点击，不触发。
    pub const DRAG_THRESHOLD: f64 = 5.0;
    // 多击判定窗口：500ms 内、位移 < DRAG_THRESHOLD 的连续按下算双击/三击。
    pub const MULTI_CLICK_WINDOW_MS: u128 = 500;

    pub type CGEventRef = *mut c_void;
    pub type CGEventTapProxy = *mut c_void;
    pub type CGEventTapCallBack = extern "C" fn(
        proxy: CGEventTapProxy,
        type_: u32,
        event: CGEventRef,
        user_info: *mut c_void,
    ) -> CGEventRef;

    #[repr(C)]
    pub struct CGPoint {
        pub x: f64,
        pub y: f64,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGEventTapCreate(
            tap: i32,
            place: i32,
            options: u32,
            event_mask: u64,
            callback: CGEventTapCallBack,
            user_info: *mut c_void,
        ) -> *mut c_void; // CFMachPortRef
        pub fn CGEventGetFlags(event: CGEventRef) -> u64;
        pub fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFMachPortCreateRunLoopSource(
            alloc: *mut c_void,
            port: *mut c_void,
            order: i32,
        ) -> *mut c_void; // CFRunLoopSourceRef
        pub fn CFRunLoopGetMain() -> *mut c_void;
        pub fn CFRunLoopAddSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
        pub fn CFRunLoopRemoveSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
        pub fn CFMachPortInvalidate(port: *mut c_void);
        pub fn CFRelease(cf: *const c_void);
        pub static kCFRunLoopDefaultMode: *const c_void;
    }
}

/// 持有已安装 tap 的 CoreFoundation 句柄以便卸载。裸指针本身非 Send/Sync，
/// 但本模块只在 mutex 保护下、且 install/uninstall 与回调之间不并发触碰句柄本体，
/// 故手动声明 Send。
#[cfg(target_os = "macos")]
struct MonitorHandles {
    port: *mut c_void,
    source: *mut c_void,
}

#[cfg(target_os = "macos")]
unsafe impl Send for MonitorHandles {}

#[cfg(target_os = "macos")]
static MONITOR: Mutex<Option<MonitorHandles>> = Mutex::new(None);

/// 回调读取用的 AppHandle（只装一次）。Mutex 而非 OnceLock，仅需 AppHandle: Send。
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);

#[cfg(target_os = "macos")]
type LastDown = ((f64, f64), u32, std::time::Instant);

/// 上次左键按下的（位置、累计多击数、时刻）。抬起时算位移判断「真选区 vs 纯点击」，
/// 多击数用于放行双击选词/三击选行。macOS 26 未导出 CGEventGetIntegerEventField，
/// 故多击数靠手动计数（500ms 内、位移小的连续按下累加）。
#[cfg(target_os = "macos")]
static LAST_DOWN: Mutex<Option<LastDown>> = Mutex::new(None);

#[cfg(target_os = "macos")]
extern "C" fn on_mouse_event(
    _proxy: *mut c_void,
    type_: u32,
    event: *mut c_void,
    _user_info: *mut c_void,
) -> *mut c_void {
    // 回调绝不能 panic 穿越 FFI 边界。
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        handle_mouse_event(type_, event);
    }));
    event
}

#[cfg(target_os = "macos")]
fn handle_mouse_event(type_: u32, event: *mut c_void) {
    // 左键按下：记录起点 + 累计多击数后即返回（不做任何抓取）。
    if type_ == cg::KCG_LEFT_MOUSE_DOWN {
        let loc = unsafe { cg::CGEventGetLocation(event) };
        let now = std::time::Instant::now();
        if let Ok(mut g) = LAST_DOWN.lock() {
            let count = match *g {
                Some(((px, py), n, t))
                    if now.duration_since(t).as_millis() <= cg::MULTI_CLICK_WINDOW_MS
                        && ((loc.x - px).powi(2) + (loc.y - py).powi(2)).sqrt()
                            < cg::DRAG_THRESHOLD =>
                {
                    n.saturating_add(1)
                }
                _ => 1,
            };
            *g = Some(((loc.x, loc.y), count, now));
        }
        return;
    }

    // 只处理左键抬起；tap 被禁用等杂项 type 忽略。
    if type_ != cg::KCG_LEFT_MOUSE_UP {
        return;
    }

    let app = match APP.lock().ok().and_then(|g| g.clone()) {
        Some(a) => a,
        None => return, // 未 install
    };

    // 廉价地在 run loop 线程上读模式 + 修饰键。
    let mode = app
        .try_state::<crate::state::AppState>()
        .and_then(|s| s.config.lock().ok().map(|c| c.auto_popup_mode.clone()))
        .unwrap_or_default();
    if mode != "every" && mode != "modifier" {
        return; // off
    }
    if mode == "modifier" {
        let flags = unsafe { cg::CGEventGetFlags(event) };
        if flags & cg::MASK_OPTION == 0 {
            return; // 未按住 ⌥
        }
    }

    // 区分真选区与纯点击：拖动 ≥ 阈值，或双击/三击（累计多击数 ≥ 2）。
    // 纯单击（位移小、多击数=1）直接跳过，根本不进入剪贴板流程，
    // 避免无选区时误弹窗、也省掉无谓的剪贴板破坏。
    let up = unsafe { cg::CGEventGetLocation(event) };
    let down_state = LAST_DOWN.lock().ok().and_then(|mut g| g.take());
    let is_selection = match down_state {
        Some(((dx, dy), count, _t)) => {
            let dist = ((up.x - dx).powi(2) + (up.y - dy).powi(2)).sqrt();
            dist >= cg::DRAG_THRESHOLD || count >= 2
        }
        None => false, // tap 装在按下之后：无起点信息则不触发（保守）
    };
    if !is_selection {
        return;
    }

    // 弹窗已显示 → 短路，让用户先处理当前这次（与原 spec 决策一致）。
    if let Some(w) = app.get_webview_window("selection-popup") {
        if w.is_visible().unwrap_or(false) {
            return;
        }
    }

    // modifier 模式走 AX 菜单复制（⌥ 可保持按住）；every 模式走键盘 Cmd+C。
    let via_menu = mode == "modifier";

    // 跑 capture 管线（含 150ms 剪贴板等待 + AX IPC）放后台线程，避免阻塞 run loop。
    std::thread::spawn(move || {
        crate::popup::run_popup_capture_with(&app, via_menu);
    });
}

/// 安装全局鼠标抬起监听。重复调用安全（已装则跳过）。
/// 模式为 off 时调用方应改用 `uninstall`；本函数仍可被调用，但会建立 tap。
pub fn install(app: AppHandle) {
    {
        let mut slot = APP.lock().expect("APP mutex poisoned");
        if slot.is_none() {
            *slot = Some(app.clone());
        }
    }
    #[cfg(target_os = "macos")]
    install_macos(app);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

#[cfg(target_os = "macos")]
fn install_macos(app: AppHandle) {
    use tauri::Emitter;

    let mut slot = MONITOR.lock().expect("MONITOR mutex poisoned");
    if slot.is_some() {
        return; // 已安装
    }

    if !crate::capture::check_accessibility(&app) {
        return; // 未授辅助功能；横幅已由 check_accessibility 发出
    }

    let port = unsafe {
        cg::CGEventTapCreate(
            cg::KCG_SESSION_EVENT_TAP,
            cg::KCG_HEAD_INSERT_EVENT_TAP,
            cg::KCG_EVENT_TAP_OPTION_LISTEN,
            cg::EVENT_MASK,
            on_mouse_event,
            std::ptr::null_mut(),
        )
    };
    if port.is_null() {
        // 多半是缺少「输入监控」权限；复用既有横幅提示用户去系统设置授权。
        eprintln!("[selection_monitor] CGEventTapCreate 返回 NULL —— 可能未授予「输入监控」权限");
        let _ = app.emit_to("main", "accessibility-needed", ());
        return;
    }

    let source = unsafe { cg::CFMachPortCreateRunLoopSource(std::ptr::null_mut(), port, 0) };
    if source.is_null() {
        unsafe { cg::CFRelease(port) };
        eprintln!("[selection_monitor] CFMachPortCreateRunLoopSource 失败");
        return;
    }

    let rl = unsafe { cg::CFRunLoopGetMain() };
    unsafe { cg::CFRunLoopAddSource(rl, source, cg::kCFRunLoopDefaultMode) };

    *slot = Some(MonitorHandles { port, source });
}

/// 卸载监听（切换到 off 或退出时调用）。未安装时为空操作。
pub fn uninstall() {
    #[cfg(target_os = "macos")]
    {
        let mut slot = MONITOR.lock().expect("MONITOR mutex poisoned");
        if let Some(h) = slot.take() {
            unsafe {
                let rl = cg::CFRunLoopGetMain();
                cg::CFRunLoopRemoveSource(rl, h.source, cg::kCFRunLoopDefaultMode);
                cg::CFMachPortInvalidate(h.port);
                cg::CFRelease(h.source);
                cg::CFRelease(h.port);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {}
}
