//! 自动划词悬浮窗触发器：用全局 CGEventTap 识别鼠标拖选、系统双击和
//! 系统三击，再经 Accessibility 选区证据确认后触发 popup capture。
//!
//! 设计要点：
//! - **C 回调而非 ObjC block**：`CGEventTapCreate` 接受一个 `extern "C" fn` 指针，
//!   不需要在 objc2 0.2 里构造 block，复用 `capture.rs` 里声明 extern C 的既有风格。
//! - **最小拦截**：普通鼠标/键盘事件原样返回；只有弹窗可见时的 Esc 被消费，
//!   使它只关闭最上层临时工具条而不同时影响来源应用。
//! - **单工作线程**：回调只完成手势归一化并把候选送入有界队列；AX 选区确认和
//!   剪贴板抓取在一个持久 worker 中串行执行，避免每次 mouse-up 创建线程。
//! - **复用既有管线**：`CaptureGuard` 重入保护、`check_accessibility`、
//!   `read_selection`/`simulate_copy`、`cursor::get_cursor_pos`、`PopupCache`、
//!   `submit_popup_capture`/`dismiss_popup` 全部原样复用，本模块只改「谁来调用」。
//!
//! 权限：全局鼠标事件 tap 在 macOS 上需要辅助功能（已由 `check_accessibility` 处理），
//! 部分版本另需「输入监控」。tap 创建失败（返回 NULL）时静默退化为不触发，并复用
//! 既有 `accessibility-needed` 横幅提示用户去系统设置授权。

use std::ffi::c_void;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, LazyLock, Mutex};
use tauri::{AppHandle, Manager};

use crate::selection_intent::{
    MouseDown, MouseUp, Point, SelectionCandidate, SelectionIntentTracker,
};

#[derive(Clone, Copy)]
struct LogicalRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn point_in_rect(point: Point, rect: LogicalRect) -> bool {
    point.x >= rect.x
        && point.x <= rect.x + rect.width
        && point.y >= rect.y
        && point.y <= rect.y + rect.height
}

fn should_consume_escape(popup_visible: bool, event_type: u32, key_code: i64) -> bool {
    popup_visible && event_type == 10 && key_code == 53
}

#[cfg(target_os = "macos")]
mod cg {
    use std::ffi::c_void;

    // CGEventTapLocation
    pub const KCG_SESSION_EVENT_TAP: i32 = 1; // kCGSessionEventTap
                                              // CGEventTapPlacement
    pub const KCG_HEAD_INSERT_EVENT_TAP: i32 = 0;
    // CGEventTapOptions
    pub const KCG_EVENT_TAP_OPTION_DEFAULT: u32 = 0;
    // CGEventType
    pub const KCG_LEFT_MOUSE_DOWN: u32 = 1;
    pub const KCG_LEFT_MOUSE_UP: u32 = 2;
    pub const KCG_KEY_DOWN: u32 = 10;
    pub const KCG_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    pub const KCG_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;
    // CGEventMask = 1 << eventType。
    pub const EVENT_MASK: u64 =
        (1u64 << KCG_LEFT_MOUSE_DOWN) | (1u64 << KCG_LEFT_MOUSE_UP) | (1u64 << KCG_KEY_DOWN);
    pub const KCG_MOUSE_EVENT_NUMBER: u32 = 0;
    pub const KCG_MOUSE_EVENT_CLICK_STATE: u32 = 1;
    pub const KCG_KEYBOARD_EVENT_KEYCODE: u32 = 9;

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
        pub fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
        pub fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
        pub fn CGEventTapEnable(tap: *mut c_void, enable: bool);
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
static TRACKER: LazyLock<Mutex<SelectionIntentTracker>> =
    LazyLock::new(|| Mutex::new(SelectionIntentTracker::default()));

#[cfg(target_os = "macos")]
static WORKER: Mutex<Option<mpsc::SyncSender<SelectionCandidate>>> = Mutex::new(None);

#[cfg(target_os = "macos")]
static LATEST_SELECTION_EVENT: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "macos")]
extern "C" fn on_mouse_event(
    _proxy: *mut c_void,
    type_: u32,
    event: *mut c_void,
    _user_info: *mut c_void,
) -> *mut c_void {
    let consume = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        handle_global_event(type_, event)
    }))
    .unwrap_or(false);
    if consume {
        std::ptr::null_mut()
    } else {
        event
    }
}

#[cfg(target_os = "macos")]
fn handle_global_event(type_: u32, event: *mut c_void) -> bool {
    if matches!(
        type_,
        cg::KCG_TAP_DISABLED_BY_TIMEOUT | cg::KCG_TAP_DISABLED_BY_USER_INPUT
    ) {
        if let Ok(slot) = MONITOR.lock() {
            if let Some(handles) = slot.as_ref() {
                unsafe { cg::CGEventTapEnable(handles.port, true) };
            }
        }
        return false;
    }

    let app = match APP.lock().ok().and_then(|g| g.clone()) {
        Some(app) => app,
        None => return false,
    };

    if type_ == cg::KCG_KEY_DOWN {
        let key_code =
            unsafe { cg::CGEventGetIntegerValueField(event, cg::KCG_KEYBOARD_EVENT_KEYCODE) };
        let visible = crate::popup::is_visible(&app);
        if should_consume_escape(visible, type_, key_code) {
            crate::popup::dismiss_active(&app);
            return true;
        }
        if visible {
            crate::popup::dismiss_active(&app);
        }
        return false;
    }

    let location = unsafe { cg::CGEventGetLocation(event) };
    let point = Point {
        x: location.x,
        y: location.y,
    };
    if type_ == cg::KCG_LEFT_MOUSE_DOWN {
        if let Some(rect) = popup_rect(&app) {
            if point_in_rect(point, rect) {
                return false;
            }
            crate::popup::dismiss_active(&app);
        }
    }

    if !auto_mode_enabled(&app) {
        return false;
    }

    let Some(pid) = crate::source::frontmost_pid() else {
        return false;
    };
    let event_number =
        unsafe { cg::CGEventGetIntegerValueField(event, cg::KCG_MOUSE_EVENT_NUMBER) } as u64;

    if type_ == cg::KCG_LEFT_MOUSE_DOWN {
        LATEST_SELECTION_EVENT.store(event_number, Ordering::SeqCst);
        let target = crate::selection_probe::target_kind_at(point, pid);
        if let Ok(mut tracker) = TRACKER.lock() {
            tracker.on_mouse_down(MouseDown {
                event_number,
                pid,
                point,
                target,
            });
        }
        return false;
    }

    if type_ != cg::KCG_LEFT_MOUSE_UP {
        return false;
    }
    let click_count =
        unsafe { cg::CGEventGetIntegerValueField(event, cg::KCG_MOUSE_EVENT_CLICK_STATE) }
            .clamp(1, u8::MAX as i64) as u8;
    let candidate = TRACKER.lock().ok().and_then(|mut tracker| {
        tracker.on_mouse_up(MouseUp {
            event_number,
            pid,
            point,
            click_count,
        })
    });
    if let Some(candidate) = candidate {
        if let Some(sender) = WORKER.lock().ok().and_then(|slot| slot.clone()) {
            let _ = sender.try_send(candidate);
        }
    }
    false
}

#[cfg(target_os = "macos")]
fn popup_rect(app: &AppHandle) -> Option<LogicalRect> {
    let popup = app.get_webview_window("selection-popup")?;
    if !popup.is_visible().ok()? {
        return None;
    }
    let scale = popup.scale_factor().ok()?;
    let position = popup.outer_position().ok()?;
    let size = popup.outer_size().ok()?;
    Some(LogicalRect {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    })
}

fn auto_mode_enabled(app: &AppHandle) -> bool {
    app.try_state::<crate::state::AppState>()
        .and_then(|state| {
            state
                .config
                .lock()
                .ok()
                .map(|config| config.auto_popup_mode == "auto")
        })
        .unwrap_or(false)
}

pub fn is_current_selection_event(event_number: u64) -> bool {
    #[cfg(target_os = "macos")]
    {
        return LATEST_SELECTION_EVENT.load(Ordering::SeqCst) == event_number;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = event_number;
        false
    }
}

#[cfg(target_os = "macos")]
fn install_worker(app: AppHandle) {
    let mut slot = WORKER.lock().expect("WORKER mutex poisoned");
    if slot.is_some() {
        return;
    }
    let (sender, receiver) = mpsc::sync_channel::<SelectionCandidate>(8);
    *slot = Some(sender);
    std::thread::spawn(move || {
        while let Ok(candidate) = receiver.recv() {
            std::thread::sleep(std::time::Duration::from_millis(35));
            if !is_current_selection_event(candidate.event_number)
                || !auto_mode_enabled(&app)
                || !crate::selection_probe::completed_selection(candidate)
            {
                continue;
            }
            crate::popup::run_auto_popup_capture(&app, candidate.event_number);
        }
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
    {
        install_worker(app.clone());
        install_macos(app);
    }
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
            cg::KCG_EVENT_TAP_OPTION_DEFAULT,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_is_consumed_only_while_popup_is_visible() {
        assert!(should_consume_escape(true, 10, 53));
        assert!(!should_consume_escape(false, 10, 53));
        assert!(!should_consume_escape(true, 10, 36));
        assert!(!should_consume_escape(true, 1, 53));
    }

    #[test]
    fn popup_hit_test_uses_visible_window_bounds() {
        let rect = LogicalRect {
            x: 100.0,
            y: 200.0,
            width: 80.0,
            height: 40.0,
        };
        assert!(point_in_rect(Point { x: 100.0, y: 200.0 }, rect));
        assert!(point_in_rect(Point { x: 180.0, y: 240.0 }, rect));
        assert!(!point_in_rect(Point { x: 99.0, y: 220.0 }, rect));
        assert!(!point_in_rect(Point { x: 140.0, y: 241.0 }, rect));
    }
}
