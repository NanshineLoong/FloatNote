//! 通过辅助功能 API 触发前台应用的「编辑 → 拷贝」菜单项来复制选区。
//!
//! 不走键盘 → 不受物理按住的 ⌥ 污染（Cmd+C 在 ⌥ 按住时会被系统合并成 ⌥⌘C，
//! 不是「复制」）。用于 modifier 自动弹窗模式：用户可一直按住 ⌥ 连续划线捕获，
//! 弹窗与按钮都立即可用，无需松开 ⌥。
//!
//! 定位菜单项用 `kAXMenuItemCmdChar='c'` + 最小 `kAXMenuItemCmdModifiers`，
//! 即「⌘C 且额外修饰键最少」的那一项——不依赖菜单本地化标题（中文「拷贝」/
//! 英文「Copy」都能命中），也避开 ⌘⇧C 这类「Copy as …」变体。
//!
//! 失败（无菜单栏 / 无 ⌘C 项 / AX 未授权）时返回 Err，调用方回退到 Cmd+C 键盘路径。

use std::ffi::c_void;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
    fn AXUIElementCopyAttributeValue(
        el: *mut c_void,
        attr: *const c_void,
        value: *mut *mut c_void,
    ) -> i32;
    fn AXUIElementCopyAttributeValues(
        el: *mut c_void,
        attr: *const c_void,
        index: isize,
        max: isize,
        values: *mut *mut c_void,
    ) -> i32;
    fn AXUIElementPerformAction(el: *mut c_void, action: *const c_void) -> i32;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
    fn CFStringCreateWithCString(
        alloc: *const c_void,
        cstr: *const u8,
        encoding: u32,
    ) -> *const c_void;
    fn CFEqual(a: *const c_void, b: *const c_void) -> u8;
    fn CFArrayGetCount(arr: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(arr: *const c_void, idx: isize) -> *const c_void;
    fn CFNumberGetValue(num: *const c_void, the_type: u32, value_ptr: *mut c_void) -> u8;
    fn CFGetTypeID(cf: *const c_void) -> usize;
    fn CFNumberGetTypeID() -> usize;
}

#[cfg(target_os = "macos")]
const KCF_STRING_ENCODING_UTF8: u32 = 0x08001000;
#[cfg(target_os = "macos")]
const KCF_NUMBER_SINT64_TYPE: u32 = 4; // kCFNumberSInt64Type
#[cfg(target_os = "macos")]
const AX_SUCCESS: i32 = 0;

/// RAII CFString：构造时创建、drop 时释放。AX 属性名/动作名都是头文件里的
/// `CFSTR` 宏（非导出符号），必须在运行时自行创建。
#[cfg(target_os = "macos")]
struct CfStr(*const c_void);
#[cfg(target_os = "macos")]
impl CfStr {
    fn new(s: &str) -> Option<Self> {
        let cs = std::ffi::CString::new(s).ok()?;
        let p = unsafe {
            CFStringCreateWithCString(
                std::ptr::null(),
                cs.as_ptr() as *const u8,
                KCF_STRING_ENCODING_UTF8,
            )
        };
        if p.is_null() {
            None
        } else {
            Some(Self(p))
        }
    }
    fn ptr(&self) -> *const c_void {
        self.0
    }
}
#[cfg(target_os = "macos")]
impl Drop for CfStr {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}

/// RAII 释放 CoreFoundation 对象（AX 调用返回的 CFType）。
#[cfg(target_os = "macos")]
struct CfDrop(*mut c_void);
#[cfg(target_os = "macos")]
impl Drop for CfDrop {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0 as *const c_void) };
        }
    }
}

/// 触发前台应用的 Copy 菜单项（⌘C）。成功 Ok；任一步骤失败 Err（调用方回退 Cmd+C）。
#[cfg(target_os = "macos")]
pub fn copy_via_menu() -> Result<(), Box<dyn std::error::Error>> {
    let pid = crate::source::frontmost_pid().ok_or("no frontmost pid")?;
    let app = unsafe { AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return Err("AXUIElementCreateApplication null".into());
    }
    let _drop_app = CfDrop(app);

    let c_str = CfStr::new("c").ok_or("CFString \"c\" null")?;
    let menubar_attr = CfStr::new("AXMenuBar").ok_or("CFString AXMenuBar null")?;
    let children_attr = CfStr::new("AXChildren").ok_or("CFString AXChildren null")?;
    let cmd_char_attr = CfStr::new("AXMenuItemCmdChar").ok_or("CFString AXMenuItemCmdChar null")?;
    let cmd_mod_attr =
        CfStr::new("AXMenuItemCmdModifiers").ok_or("CFString AXMenuItemCmdModifiers null")?;
    let press_action = CfStr::new("AXPress").ok_or("CFString AXPress null")?;

    let mut menubar: *mut c_void = std::ptr::null_mut();
    if unsafe { AXUIElementCopyAttributeValue(app, menubar_attr.ptr(), &mut menubar) } != AX_SUCCESS
        || menubar.is_null()
    {
        return Err("menubar copy failed".into());
    }
    let _drop_menubar = CfDrop(menubar);

    let menus = match cf_children(&menubar, children_attr.ptr()) {
        Some(m) => m,
        None => return Err("no menus".into()),
    };
    let _drop_menus = CfDrop(menus);

    let n_menus = unsafe { CFArrayGetCount(menus) };
    for i in 0..n_menus {
        let menu = unsafe { CFArrayGetValueAtIndex(menus, i) } as *mut c_void;
        if menu.is_null() {
            continue;
        }
        let items = match cf_children(&menu, children_attr.ptr()) {
            Some(it) => it,
            None => continue,
        };
        let _drop_items = CfDrop(items);
        let n_items = unsafe { CFArrayGetCount(items) };

        // 本菜单内找 cmdChar=='c' 且 modifiers 最小的项（纯 ⌘C 优先）。
        let mut best: Option<(*mut c_void, i64)> = None;
        for j in 0..n_items {
            let item = unsafe { CFArrayGetValueAtIndex(items, j) } as *mut c_void;
            if item.is_null() {
                continue;
            }
            let mut char_val: *mut c_void = std::ptr::null_mut();
            if unsafe { AXUIElementCopyAttributeValue(item, cmd_char_attr.ptr(), &mut char_val) }
                != AX_SUCCESS
                || char_val.is_null()
            {
                continue;
            }
            let _drop_char = CfDrop(char_val);
            if unsafe { CFEqual(char_val, c_str.ptr()) } == 0 {
                continue; // 不是 ⌘-c 快捷键
            }
            // 惰性读 modifiers：只有命中 ⌘c 才读，省一次 AX IPC。
            let mut mod_val: *mut c_void = std::ptr::null_mut();
            let mods: i64 =
                if unsafe { AXUIElementCopyAttributeValue(item, cmd_mod_attr.ptr(), &mut mod_val) }
                    != AX_SUCCESS
                    || mod_val.is_null()
                {
                    0 // 无 modifiers 属性 → 视为纯 ⌘C
                } else {
                    let _drop_mod = CfDrop(mod_val);
                    if unsafe { CFGetTypeID(mod_val) } == unsafe { CFNumberGetTypeID() } {
                        let mut v: i64 = 0;
                        unsafe {
                            CFNumberGetValue(
                                mod_val,
                                KCF_NUMBER_SINT64_TYPE,
                                &mut v as *mut i64 as *mut c_void,
                            );
                        }
                        v
                    } else {
                        0 // 非 CFNumber，按 0 处理
                    }
                };
            match best {
                None => best = Some((item, mods)),
                Some((_, m)) if mods < m => best = Some((item, mods)),
                _ => {}
            }
        }

        if let Some((item, _mods)) = best {
            // 命中即按 AXPress 触发 Copy（不弹菜单、不经键盘）。
            let _ = unsafe { AXUIElementPerformAction(item, press_action.ptr()) };
            return Ok(());
        }
    }
    Err("no ⌘C menu item found".into())
}

/// 取某元素的 `AXChildren` 数组（CFArray）。空或失败返回 None。
/// 用大 max 直接取（macOS 26 未导出 `AXUIElementGetAttributeCount`）；
/// 文档保证 max 大于实际数量时只返回实际数量的元素。
#[cfg(target_os = "macos")]
fn cf_children(el: &*mut c_void, children_attr: *const c_void) -> Option<*mut c_void> {
    let mut arr: *mut c_void = std::ptr::null_mut();
    if unsafe { AXUIElementCopyAttributeValues(*el, children_attr, 0, 1024, &mut arr) }
        != AX_SUCCESS
        || arr.is_null()
    {
        return None;
    }
    Some(arr)
}

#[cfg(not(target_os = "macos"))]
pub fn copy_via_menu() -> Result<(), Box<dyn std::error::Error>> {
    Err("menu-copy is only supported on macOS".into())
}
