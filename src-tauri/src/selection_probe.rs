use crate::selection_intent::AxTargetKind;
use crate::selection_intent::{Point, SelectionCandidate};

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
    use super::*;
    use std::ffi::{c_char, c_void, CString};

    const AX_SUCCESS: i32 = 0;
    const UTF8: u32 = 0x0800_0100;
    const MAX_ANCESTORS: usize = 8;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
        fn AXUIElementCopyElementAtPosition(
            application: *mut c_void,
            x: f32,
            y: f32,
            element: *mut *mut c_void,
        ) -> i32;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: *const c_void,
            value: *mut *mut c_void,
        ) -> i32;
        fn AXUIElementGetPid(element: *mut c_void, pid: *mut i32) -> i32;
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

    fn role_of(element: *mut c_void) -> Option<String> {
        let role = copy_attribute(element, "AXRole")?;
        string_value(role.ptr())
    }

    fn parent_of(element: *mut c_void) -> Option<OwnedCf> {
        copy_attribute(element, "AXParent")
    }

    fn element_at(point: Point, expected_pid: i32) -> Option<OwnedCf> {
        let system = OwnedCf::new(unsafe { AXUIElementCreateSystemWide() })?;
        let mut element = std::ptr::null_mut();
        let result = unsafe {
            AXUIElementCopyElementAtPosition(
                system.ptr(),
                point.x as f32,
                point.y as f32,
                &mut element,
            )
        };
        let element = (result == AX_SUCCESS)
            .then(|| OwnedCf::new(element))
            .flatten()?;
        let mut pid = 0;
        if unsafe { AXUIElementGetPid(element.ptr(), &mut pid) } != AX_SUCCESS
            || pid != expected_pid
        {
            return None;
        }
        Some(element)
    }

    fn classify_element(element: OwnedCf) -> AxTargetKind {
        let mut current = Some(element);
        for _ in 0..MAX_ANCESTORS {
            let Some(node) = current.take() else {
                break;
            };
            let kind = role_of(node.ptr())
                .as_deref()
                .map(classify_role)
                .unwrap_or(AxTargetKind::Unknown);
            if kind.is_textual()
                || matches!(
                    kind,
                    AxTargetKind::TitleBar
                        | AxTargetKind::ScrollBar
                        | AxTargetKind::Button
                        | AxTargetKind::FileItem
                )
            {
                return kind;
            }
            current = parent_of(node.ptr());
        }
        AxTargetKind::Unknown
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

    pub fn target_kind_at(point: Point, expected_pid: i32) -> AxTargetKind {
        if crate::source::frontmost_pid() != Some(expected_pid) {
            return AxTargetKind::Unknown;
        }
        element_at(point, expected_pid)
            .map(classify_element)
            .unwrap_or(AxTargetKind::Unknown)
    }

    pub fn completed_selection(candidate: SelectionCandidate) -> bool {
        if crate::source::frontmost_pid() != Some(candidate.pid) {
            return false;
        }

        let app = OwnedCf::new(unsafe { AXUIElementCreateApplication(candidate.pid) });
        let focused = app
            .as_ref()
            .and_then(|app| copy_attribute(app.ptr(), "AXFocusedUIElement"));
        if focused.and_then(selected_text_from).is_some() {
            return true;
        }

        element_at(candidate.up, candidate.pid)
            .and_then(selected_text_from)
            .is_some()
    }
}

#[cfg(target_os = "macos")]
pub use macos::{completed_selection, target_kind_at};

#[cfg(not(target_os = "macos"))]
pub fn target_kind_at(_point: Point, _expected_pid: i32) -> AxTargetKind {
    AxTargetKind::Unknown
}

#[cfg(not(target_os = "macos"))]
pub fn completed_selection(_candidate: SelectionCandidate) -> bool {
    false
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
}
