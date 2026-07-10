//! Global mouse cursor position.

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
