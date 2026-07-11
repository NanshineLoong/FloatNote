#[cfg(test)]
use crate::selection_intent::AxTargetKind;

#[cfg(test)]
fn first_selection(values: impl IntoIterator<Item = Option<String>>) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .find(|text| !text.trim().is_empty())
        .map(|text| text.trim().to_string())
}

#[cfg(test)]
pub fn classify_role(role: &str) -> AxTargetKind {
    match role {
        "AXTextField" => AxTargetKind::Text,
        "AXTextArea" => AxTargetKind::TextArea,
        "AXStaticText" | "AXLink" => AxTargetKind::StaticText,
        "AXWebArea" => AxTargetKind::WebArea,
        "AXTitleBar" => AxTargetKind::TitleBar,
        "AXScrollBar" => AxTargetKind::ScrollBar,
        "AXButton" => AxTargetKind::Button,
        "AXCell" | "AXRow" | "AXImage" => AxTargetKind::FileItem,
        _ => AxTargetKind::Unknown,
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, c_void, CString};

    const AX_SUCCESS: i32 = 0;
    const UTF8: u32 = 0x0800_0100;
    const MAX_ANCESTORS: usize = 8;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: *const c_void,
            value: *mut *mut c_void,
        ) -> i32;
        fn AXUIElementSetMessagingTimeout(element: *mut c_void, timeout: f32) -> i32;
        fn AXUIElementSetAttributeValue(
            element: *mut c_void,
            attribute: *const c_void,
            value: *const c_void,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(value: *const c_void);
        fn CFGetTypeID(value: *const c_void) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            value: *const u8,
            encoding: u32,
        ) -> *const c_void;
        fn CFStringGetLength(value: *const c_void) -> isize;
        fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
        fn CFStringGetCString(
            value: *const c_void,
            buffer: *mut c_char,
            buffer_size: isize,
            encoding: u32,
        ) -> u8;
        fn CFArrayGetCount(value: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(value: *const c_void, index: isize) -> *const c_void;
        static kCFBooleanTrue: *const c_void;
    }

    struct OwnedCf(*mut c_void);

    impl OwnedCf {
        fn new(value: *mut c_void) -> Option<Self> {
            (!value.is_null()).then_some(Self(value))
        }

        fn ptr(&self) -> *mut c_void {
            self.0
        }
    }

    impl Drop for OwnedCf {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) };
            }
        }
    }

    struct CfString(*const c_void);

    impl CfString {
        fn new(value: &str) -> Option<Self> {
            let value = CString::new(value).ok()?;
            let ptr =
                unsafe { CFStringCreateWithCString(std::ptr::null(), value.as_ptr().cast(), UTF8) };
            (!ptr.is_null()).then_some(Self(ptr))
        }
    }

    impl Drop for CfString {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) };
            }
        }
    }

    fn copy_attribute(element: *mut c_void, attribute: &str) -> Option<OwnedCf> {
        let attribute = CfString::new(attribute)?;
        let mut value = std::ptr::null_mut();
        let result = unsafe { AXUIElementCopyAttributeValue(element, attribute.0, &mut value) };
        if result == AX_SUCCESS {
            OwnedCf::new(value)
        } else {
            None
        }
    }

    fn string_value(value: *const c_void) -> Option<String> {
        if value.is_null() || unsafe { CFGetTypeID(value) } != unsafe { CFStringGetTypeID() } {
            return None;
        }
        let length = unsafe { CFStringGetLength(value) };
        let capacity = unsafe { CFStringGetMaximumSizeForEncoding(length, UTF8) } + 1;
        if capacity <= 0 {
            return Some(String::new());
        }
        let mut buffer = vec![0u8; capacity as usize];
        let ok = unsafe { CFStringGetCString(value, buffer.as_mut_ptr().cast(), capacity, UTF8) };
        if ok == 0 {
            return None;
        }
        let end = buffer
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(buffer.len());
        String::from_utf8(buffer[..end].to_vec()).ok()
    }

    fn parent_of(element: *mut c_void) -> Option<OwnedCf> {
        copy_attribute(element, "AXParent")
    }

    fn selected_text_from(element: OwnedCf) -> Option<String> {
        let mut current = Some(element);
        for _ in 0..MAX_ANCESTORS {
            let Some(node) = current.take() else {
                break;
            };
            if let Some(value) = copy_attribute(node.ptr(), "AXSelectedText") {
                if let Some(text) = string_value(value.ptr()).filter(|text| !text.trim().is_empty())
                {
                    return Some(text);
                }
            }
            current = parent_of(node.ptr());
        }
        None
    }

    fn selected_text_direct(element: *mut c_void) -> Option<String> {
        let value = copy_attribute(element, "AXSelectedText")?;
        string_value(value.ptr()).filter(|text| !text.trim().is_empty())
    }

    fn selected_text_once(pid: i32) -> Option<String> {
        let app = OwnedCf::new(unsafe { AXUIElementCreateApplication(pid) })?;
        unsafe { AXUIElementSetMessagingTimeout(app.ptr(), 0.25) };
        let focused = copy_attribute(app.ptr(), "AXFocusedUIElement")?;

        if let Some(text) = selected_text_direct(focused.ptr()) {
            return Some(text.trim().to_string());
        }

        if let Some(children) = copy_attribute(focused.ptr(), "AXChildren") {
            let count = unsafe { CFArrayGetCount(children.ptr()) };
            for index in 0..count {
                let child = unsafe { CFArrayGetValueAtIndex(children.ptr(), index) } as *mut c_void;
                if let Some(text) = selected_text_direct(child) {
                    return Some(text.trim().to_string());
                }
            }
        }

        selected_text_from(focused).map(|text| text.trim().to_string())
    }

    pub fn current_selected_text(pid: i32) -> Option<String> {
        if crate::source::frontmost_pid() != Some(pid) {
            return None;
        }
        if let Some(text) = selected_text_once(pid) {
            return Some(text);
        }

        let app = OwnedCf::new(unsafe { AXUIElementCreateApplication(pid) })?;
        for attribute in ["AXEnhancedUserInterface", "AXManualAccessibility"] {
            if let Some(attribute) = CfString::new(attribute) {
                unsafe {
                    AXUIElementSetAttributeValue(app.ptr(), attribute.0, kCFBooleanTrue);
                }
            }
        }
        selected_text_once(pid)
    }
}

#[cfg(target_os = "macos")]
pub use macos::current_selected_text;

#[cfg(not(target_os = "macos"))]
pub fn current_selected_text(_pid: i32) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::selection_intent::AxTargetKind;

    #[test]
    fn text_roles_are_allowed() {
        for (role, expected) in [
            ("AXTextField", AxTargetKind::Text),
            ("AXTextArea", AxTargetKind::TextArea),
            ("AXStaticText", AxTargetKind::StaticText),
            ("AXWebArea", AxTargetKind::WebArea),
            ("AXLink", AxTargetKind::StaticText),
        ] {
            assert_eq!(classify_role(role), expected);
        }
    }

    #[test]
    fn drag_and_control_roles_are_rejected() {
        for (role, expected) in [
            ("AXTitleBar", AxTargetKind::TitleBar),
            ("AXScrollBar", AxTargetKind::ScrollBar),
            ("AXButton", AxTargetKind::Button),
            ("AXCell", AxTargetKind::FileItem),
            ("AXRow", AxTargetKind::FileItem),
            ("AXImage", AxTargetKind::FileItem),
            ("AXGroup", AxTargetKind::Unknown),
        ] {
            assert_eq!(classify_role(role), expected);
            assert!(!expected.is_textual());
        }
    }

    #[test]
    fn selection_candidates_prefer_the_first_non_empty_value() {
        assert_eq!(
            first_selection([
                None,
                Some("  ".into()),
                Some("child".into()),
                Some("ancestor".into())
            ]),
            Some("child".to_string())
        );
    }
}
