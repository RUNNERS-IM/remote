//! Clicks, drags, scrolling and key presses posted into this Mac with CGEvent, for a viewer looking at one of its displays.
//!
//! The viewer sends positions as fractions of the picture (0.0 at the left/top edge, 1.0 at the right/bottom),
//! so it never needs to know the display's size. `to_global` turns them into global display points.

use serde::Deserialize;

/// A display's place in the global space, in points (origin at the top-left of the main display).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Button {
    Left,
    Right,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Modifier {
    Shift,
    Control,
    Option,
    Command,
}

/// One thing a viewer asks this Mac to do. `x` and `y` are fractions of the display (see the module note).
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Input {
    Move { display: u32, x: f64, y: f64 },
    Click { display: u32, x: f64, y: f64, button: Button, count: u8 },
    /// One half of a click, for dragging: the button goes down (`down: true`) or comes back up at the spot. `count` is
    /// 2 for the second press of a double click (apps read that number), 1 when left out.
    Press {
        display: u32,
        x: f64,
        y: f64,
        button: Button,
        down: bool,
        #[serde(default = "one")]
        count: u8,
    },
    /// The pointer moved while a button is held down.
    Drag { display: u32, x: f64, y: f64, button: Button },
    /// Scrolling at the spot by `dx` / `dy` pixels, as the browser counts them: positive `dy` shows what is further
    /// down the page, positive `dx` what is further right.
    Scroll { display: u32, x: f64, y: f64, dx: i32, dy: i32 },
    /// A key by its macOS virtual key code (e.g. 36 is Return), pressed and released with the modifiers held.
    Key { code: u16, modifiers: Vec<Modifier> },
    /// Text typed as Unicode, independent of the keyboard layout.
    Text { text: String },
}

fn one() -> u8 {
    1
}

/// The scroll wheel values CGEvent takes for a browser's `dx` / `dy`: CGEvent counts a wheel turned away from the
/// person as positive, which moves the page the other way, so both signs flip. Each is kept to ±10000 per event.
pub fn wheel(dx: i32, dy: i32) -> (i32, i32) {
    let limit = |v: i32| v.saturating_neg().clamp(-10_000, 10_000);
    (limit(dy), limit(dx))
}

/// Maps a fraction of a display to a global point. Fractions outside 0..1 are pulled to the nearest edge,
/// and the far edge stays one point inside, so a click never lands on the display next to it.
pub fn to_global(bounds: Bounds, x: f64, y: f64) -> (f64, f64) {
    let fx = if x.is_finite() { x.clamp(0.0, 1.0) } else { 0.0 };
    let fy = if y.is_finite() { y.clamp(0.0, 1.0) } else { 0.0 };
    let gx = (bounds.x + fx * bounds.width).min(bounds.x + bounds.width - 1.0).max(bounds.x);
    let gy = (bounds.y + fy * bounds.height).min(bounds.y + bounds.height - 1.0).max(bounds.y);
    (gx, gy)
}

#[cfg(target_os = "macos")]
pub use mac::send;

#[cfg(not(target_os = "macos"))]
pub fn send(_input: &Input) -> Result<Option<(f64, f64)>, String> {
    Err("unsupported".into())
}

#[cfg(target_os = "macos")]
mod mac {
    use core_graphics::display::CGDisplay;
    use core_graphics::event::{
        CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton, EventField, ScrollEventUnit,
    };
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::geometry::CGPoint;

    use super::{to_global, wheel, Bounds, Button, Input, Modifier};

    /// Why: CGEvent drops a string longer than this per event, so long text goes out in pieces.
    const TEXT_CHUNK: usize = 20;

    /// Posts `input` and returns the global point a move or click went to (none for keys and text).
    pub fn send(input: &Input) -> Result<Option<(f64, f64)>, String> {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| "event source")?;
        match input {
            Input::Move { display, x, y } => {
                let at = point(*display, *x, *y)?;
                mouse(&source, CGEventType::MouseMoved, at, CGMouseButton::Left, 0)?;
                Ok(Some((at.x, at.y)))
            }
            Input::Click { display, x, y, button, count } => {
                let at = point(*display, *x, *y)?;
                let (down, up, _, which) = kinds(*button);
                mouse(&source, CGEventType::MouseMoved, at, which, 0)?;
                // Why: a double click is two down/up pairs where the second pair says "click 2"; apps read that number.
                for n in 1..=i64::from((*count).clamp(1, 3)) {
                    mouse(&source, down, at, which, n)?;
                    mouse(&source, up, at, which, n)?;
                }
                Ok(Some((at.x, at.y)))
            }
            Input::Press { display, x, y, button, down, count } => {
                let at = point(*display, *x, *y)?;
                let (press, release, _, which) = kinds(*button);
                mouse(&source, if *down { press } else { release }, at, which, i64::from((*count).clamp(1, 3)))?;
                Ok(Some((at.x, at.y)))
            }
            Input::Drag { display, x, y, button } => {
                let at = point(*display, *x, *y)?;
                let (_, _, dragged, which) = kinds(*button);
                mouse(&source, dragged, at, which, 0)?;
                Ok(Some((at.x, at.y)))
            }
            Input::Scroll { display, x, y, dx, dy } => {
                let at = point(*display, *x, *y)?;
                // Why move first: the window under the pointer is the one that scrolls.
                mouse(&source, CGEventType::MouseMoved, at, CGMouseButton::Left, 0)?;
                let (vertical, horizontal) = wheel(*dx, *dy);
                let event = CGEvent::new_scroll_event(source.clone(), ScrollEventUnit::PIXEL, 2, vertical, horizontal, 0)
                    .map_err(|_| "scroll event")?;
                event.post(CGEventTapLocation::HID);
                Ok(Some((at.x, at.y)))
            }
            Input::Key { code, modifiers } => {
                let flags = modifiers.iter().fold(CGEventFlags::empty(), |all, m| all | flag(*m));
                for down in [true, false] {
                    let event = CGEvent::new_keyboard_event(source.clone(), *code, down).map_err(|_| "key event")?;
                    event.set_flags(flags);
                    event.post(CGEventTapLocation::HID);
                }
                Ok(None)
            }
            Input::Text { text } => {
                let units: Vec<u16> = text.encode_utf16().collect();
                for piece in units.chunks(TEXT_CHUNK) {
                    for down in [true, false] {
                        let event = CGEvent::new_keyboard_event(source.clone(), 0, down).map_err(|_| "key event")?;
                        event.set_string_from_utf16_unchecked(piece);
                        event.post(CGEventTapLocation::HID);
                    }
                }
                Ok(None)
            }
        }
    }

    /// Down, up and dragged event types for a button, and the button itself.
    fn kinds(button: Button) -> (CGEventType, CGEventType, CGEventType, CGMouseButton) {
        match button {
            Button::Left => (
                CGEventType::LeftMouseDown,
                CGEventType::LeftMouseUp,
                CGEventType::LeftMouseDragged,
                CGMouseButton::Left,
            ),
            Button::Right => (
                CGEventType::RightMouseDown,
                CGEventType::RightMouseUp,
                CGEventType::RightMouseDragged,
                CGMouseButton::Right,
            ),
        }
    }

    fn point(display: u32, x: f64, y: f64) -> Result<CGPoint, String> {
        if !CGDisplay::active_displays().unwrap_or_default().contains(&display) {
            return Err("display".into());
        }
        let rect = CGDisplay::new(display).bounds();
        let bounds = Bounds { x: rect.origin.x, y: rect.origin.y, width: rect.size.width, height: rect.size.height };
        let (gx, gy) = to_global(bounds, x, y);
        Ok(CGPoint::new(gx, gy))
    }

    fn mouse(source: &CGEventSource, kind: CGEventType, at: CGPoint, button: CGMouseButton, click: i64) -> Result<(), String> {
        let event = CGEvent::new_mouse_event(source.clone(), kind, at, button).map_err(|_| "mouse event")?;
        if click > 0 {
            event.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, click);
        }
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn flag(modifier: Modifier) -> CGEventFlags {
        match modifier {
            Modifier::Shift => CGEventFlags::CGEventFlagShift,
            Modifier::Control => CGEventFlags::CGEventFlagControl,
            Modifier::Option => CGEventFlags::CGEventFlagAlternate,
            Modifier::Command => CGEventFlags::CGEventFlagCommand,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{to_global, wheel, Bounds, Button, Input};

    const MAIN: Bounds = Bounds { x: 0.0, y: 0.0, width: 1512.0, height: 982.0 };
    // A second display to the left of the main one and a bit higher, as macOS reports it: negative x and y.
    const LEFT: Bounds = Bounds { x: -2560.0, y: -300.0, width: 2560.0, height: 1440.0 };

    #[test]
    fn maps_fractions_to_points() {
        assert_eq!(to_global(MAIN, 0.0, 0.0), (0.0, 0.0));
        assert_eq!(to_global(MAIN, 0.5, 0.5), (756.0, 491.0));
        assert_eq!(to_global(LEFT, 0.0, 0.0), (-2560.0, -300.0));
        assert_eq!(to_global(LEFT, 0.5, 0.25), (-1280.0, 60.0));
    }

    #[test]
    fn stays_on_the_chosen_display() {
        assert_eq!(to_global(MAIN, 1.0, 1.0), (1511.0, 981.0));
        assert_eq!(to_global(LEFT, 1.0, 1.0), (-1.0, 1139.0));
        assert_eq!(to_global(MAIN, -0.2, 1.7), (0.0, 981.0));
        assert_eq!(to_global(MAIN, f64::NAN, f64::INFINITY), (0.0, 0.0));
    }

    #[test]
    fn reads_input_from_the_window() {
        let click: Input =
            serde_json::from_str(r#"{"kind":"click","display":1,"x":0.25,"y":0.5,"button":"left","count":2}"#).unwrap();
        assert_eq!(
            click,
            Input::Click { display: 1, x: 0.25, y: 0.5, button: Button::Left, count: 2 }
        );
        let text: Input = serde_json::from_str(r#"{"kind":"text","text":"안녕"}"#).unwrap();
        assert_eq!(text, Input::Text { text: "안녕".into() });
    }

    #[test]
    fn reads_drags_and_scrolling() {
        let press: Input =
            serde_json::from_str(r#"{"kind":"press","display":1,"x":0.1,"y":0.2,"button":"left","down":true}"#).unwrap();
        assert_eq!(press, Input::Press { display: 1, x: 0.1, y: 0.2, button: Button::Left, down: true, count: 1 });
        let second: Input =
            serde_json::from_str(r#"{"kind":"press","display":1,"x":0.1,"y":0.2,"button":"left","down":false,"count":2}"#)
                .unwrap();
        assert_eq!(second, Input::Press { display: 1, x: 0.1, y: 0.2, button: Button::Left, down: false, count: 2 });
        let drag: Input =
            serde_json::from_str(r#"{"kind":"drag","display":1,"x":0.3,"y":0.4,"button":"right"}"#).unwrap();
        assert_eq!(drag, Input::Drag { display: 1, x: 0.3, y: 0.4, button: Button::Right });
        let scroll: Input =
            serde_json::from_str(r#"{"kind":"scroll","display":1,"x":0.5,"y":0.5,"dx":0,"dy":-120}"#).unwrap();
        assert_eq!(scroll, Input::Scroll { display: 1, x: 0.5, y: 0.5, dx: 0, dy: -120 });
    }

    #[test]
    fn flips_scrolling_for_cgevent() {
        // Down the page in the browser is a wheel turned toward the person, negative for CGEvent.
        assert_eq!(wheel(0, 120), (-120, 0));
        assert_eq!(wheel(-40, 0), (0, 40));
        assert_eq!(wheel(0, i32::MIN), (10_000, 0));
        assert_eq!(wheel(99_999, 0), (0, -10_000));
    }
}
