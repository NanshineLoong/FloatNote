//! Global mouse cursor position.

/// Convert physical pixels to logical points given a scale factor.
/// Pure helper, unit-tested.
pub fn to_logical(x: f64, y: f64, scale: f64) -> (f64, f64) {
    if scale <= 0.0 {
        (x, y)
    } else {
        (x / scale, y / scale)
    }
}

#[cfg(target_os = "macos")]
pub fn get_cursor_pos() -> Option<(f64, f64)> {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
    // A freshly-created event's location is the current cursor position.
    let event = CGEvent::new(source).ok()?;
    let loc = event.location();
    Some((loc.x, loc.y))
}

#[cfg(not(target_os = "macos"))]
pub fn get_cursor_pos() -> Option<(f64, f64)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_logical_divides_by_scale() {
        assert_eq!(to_logical(200.0, 100.0, 2.0), (100.0, 50.0));
    }

    #[test]
    fn to_logical_identity_at_scale_one() {
        assert_eq!(to_logical(123.0, 456.0, 1.0), (123.0, 456.0));
    }

    #[test]
    fn to_logical_passthrough_on_zero_scale() {
        assert_eq!(to_logical(200.0, 100.0, 0.0), (200.0, 100.0));
    }
}
