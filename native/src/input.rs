//! Clicks, drags, scrolling and key presses posted into this computer, for a viewer looking at one of its displays:
//! CGEvent on macOS, SendInput on Windows and XTest on Linux (X11).
//!
//! The viewer sends positions as fractions of the picture (0.0 at the left/top edge, 1.0 at the right/bottom),
//! so it never needs to know the display's size. On macOS `to_global` turns them into global display points here; on
//! Windows and Linux the main process knows the displays (Electron's screen) and passes the screen pixel to post at.

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
/// Windows uses the same values (its wheel counts the same way).
#[cfg_attr(target_os = "linux", allow(dead_code))]
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

/// How many wheel clicks X gets for `pixels` of browser scrolling: one click scrolls about this many pixels in most
/// Linux apps, at least one for any movement, and at most `MAX_WHEEL_CLICKS` per event.
pub const WHEEL_CLICK_PX: i32 = 50;
const MAX_WHEEL_CLICKS: u32 = 20;

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn wheel_clicks(pixels: i32) -> u32 {
    if pixels == 0 {
        return 0;
    }
    pixels.unsigned_abs().div_ceil(WHEEL_CLICK_PX as u32).min(MAX_WHEEL_CLICKS)
}

impl Input {
    /// Whether this input goes to a spot on screen (and so needs one), unlike keys and text.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    fn is_pointer(&self) -> bool {
        !matches!(self, Input::Key { .. } | Input::Text { .. })
    }
}

/// Posts `input` and returns the global point a move or click went to (none for keys and text). `at` is the screen
/// pixel to post at on Windows and Linux, worked out by the main process; macOS finds the point itself and ignores it.
#[cfg(target_os = "macos")]
pub fn send(input: &Input, _at: Option<(f64, f64)>) -> Result<Option<(f64, f64)>, String> {
    mac::send(input)
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
pub fn send(input: &Input, at: Option<(f64, f64)>) -> Result<Option<(f64, f64)>, String> {
    let at = match (input.is_pointer(), at) {
        (true, None) => return Err("position".into()),
        (true, Some((x, y))) if !x.is_finite() || !y.is_finite() => return Err("position".into()),
        (true, Some((x, y))) => Some((x.round(), y.round())),
        (false, _) => None,
    };
    #[cfg(target_os = "windows")]
    windows::send(input, at)?;
    #[cfg(target_os = "linux")]
    linux::send(input, at)?;
    Ok(at)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub fn send(_input: &Input, _at: Option<(f64, f64)>) -> Result<Option<(f64, f64)>, String> {
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

#[cfg(target_os = "windows")]
mod windows {
    use std::mem::size_of;

    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN,
        MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos;

    use super::{wheel, Button, Input};
    use crate::keymap;

    pub fn send(input: &Input, at: Option<(f64, f64)>) -> Result<(), String> {
        // Why SetCursorPos rather than absolute SendInput: Electron runs DPI aware, so it takes the same screen pixels
        // the main process works out, across displays with different scaling, with no 0–65535 conversion.
        if let Some((x, y)) = at
            && unsafe { SetCursorPos(x as i32, y as i32) } == 0
        {
            return Err("cursor".into());
        }
        match input {
            Input::Move { .. } | Input::Drag { .. } => Ok(()),
            Input::Click { button, count, .. } => {
                let (down, up) = flags(*button);
                let mut events = Vec::new();
                // Why: Windows makes a double click out of two quick presses at one spot.
                for _ in 0..(*count).clamp(1, 3) {
                    events.push(mouse(down, 0));
                    events.push(mouse(up, 0));
                }
                post(&events)
            }
            Input::Press { button, down, .. } => {
                let (press, release) = flags(*button);
                post(&[mouse(if *down { press } else { release }, 0)])
            }
            Input::Scroll { dx, dy, .. } => {
                let (vertical, horizontal) = wheel(*dx, *dy);
                let mut events = Vec::new();
                // Wheel forward (positive) shows what is further up, like CGEvent; the horizontal wheel is positive to
                // the right, so it takes the browser's sign as it is.
                if vertical != 0 {
                    events.push(mouse(MOUSEEVENTF_WHEEL, vertical));
                }
                if horizontal != 0 {
                    events.push(mouse(MOUSEEVENTF_HWHEEL, -horizontal));
                }
                post(&events)
            }
            Input::Key { code, modifiers } => {
                let key = keymap::from_mac(*code).ok_or("key")?;
                let held = keymap::held(modifiers);
                let mut events: Vec<INPUT> = held.iter().map(|m| keyboard(m.vk(), 0, 0)).collect();
                let extended = if key.extended { KEYEVENTF_EXTENDEDKEY } else { 0 };
                events.push(keyboard(key.vk, 0, extended));
                events.push(keyboard(key.vk, 0, extended | KEYEVENTF_KEYUP));
                events.extend(held.iter().rev().map(|m| keyboard(m.vk(), 0, KEYEVENTF_KEYUP)));
                post(&events)
            }
            Input::Text { text } => {
                // Why UTF-16 units as "unicode" keys: they type as given whatever keyboard layout this computer has.
                let events: Vec<INPUT> = text
                    .encode_utf16()
                    .flat_map(|unit| {
                        [keyboard(0, unit, KEYEVENTF_UNICODE), keyboard(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)]
                    })
                    .collect();
                post(&events)
            }
        }
    }

    fn flags(button: Button) -> (u32, u32) {
        match button {
            Button::Left => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
            Button::Right => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        }
    }

    fn mouse(flags: u32, data: i32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data as _, dwFlags: flags, time: 0, dwExtraInfo: 0 },
            },
        }
    }

    fn keyboard(vk: u16, scan: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        }
    }

    fn post(events: &[INPUT]) -> Result<(), String> {
        if events.is_empty() {
            return Ok(());
        }
        let sent = unsafe { SendInput(events.len() as u32, events.as_ptr(), size_of::<INPUT>() as i32) };
        // Why: Windows refuses input into a window of a program run as administrator (and the UAC prompt); SendInput
        // then posts nothing and says so only by the count.
        if sent as usize != events.len() {
            return Err("blocked".into());
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::sync::Mutex;
    use std::thread::sleep;
    use std::time::Duration;

    use x11rb::connection::{Connection, RequestConnection};
    use x11rb::protocol::xproto::{
        ConnectionExt as _, Keycode, Keysym, Window, BUTTON_PRESS_EVENT, BUTTON_RELEASE_EVENT, KEY_PRESS_EVENT,
        KEY_RELEASE_EVENT, MOTION_NOTIFY_EVENT,
    };
    use x11rb::protocol::xtest::{self, ConnectionExt as _};
    use x11rb::rust_connection::RustConnection;

    use super::{wheel_clicks, Button, Input};
    use crate::keymap::{self, Held};

    /// Why a pause after changing the keyboard map: apps read the new map only after they get the change notice,
    /// and a key that is handled first types the old character or none (seen on Xvfb with Chromium: Korean went
    /// missing). Chrome Remote Desktop's X11 text input keeps its borrowed keys for 200 ms for the same reason.
    const REMAP_WAIT: Duration = Duration::from_millis(100);
    const CLEAR_WAIT: Duration = Duration::from_millis(200);

    /// One connection to the X server, kept between inputs and opened again after an error.
    struct X {
        conn: RustConnection,
        root: Window,
        min: Keycode,
        per: u8,
        /// Keysyms by keycode, from `min`, `per` to a keycode.
        map: Vec<Keysym>,
    }

    static X_SERVER: Mutex<Option<X>> = Mutex::new(None);

    pub fn send(input: &Input, at: Option<(f64, f64)>) -> Result<(), String> {
        let mut guard = X_SERVER.lock().map_err(|_| "x11")?;
        if guard.is_none() {
            *guard = Some(X::open()?);
        }
        let x = guard.as_mut().ok_or("x11")?;
        let result = x.send(input, at);
        // Why drop it on an error: the X server may have restarted (logging out and in), and the next input reconnects.
        if result.is_err() {
            *guard = None;
        }
        result
    }

    fn err<E: std::fmt::Display>(e: E) -> String {
        e.to_string()
    }

    impl X {
        /// Connects through `DISPLAY`. Without it (a Wayland-only desktop) or without XTest, input is unsupported here.
        fn open() -> Result<X, String> {
            let (conn, screen) = x11rb::connect(None).map_err(|_| "unsupported")?;
            if conn.extension_information(xtest::X11_EXTENSION_NAME).map_err(err)?.is_none() {
                return Err("unsupported".into());
            }
            let root = conn.setup().roots.get(screen).ok_or("unsupported")?.root;
            let mut x = X { conn, root, min: 0, per: 0, map: Vec::new() };
            x.read_map()?;
            Ok(x)
        }

        fn read_map(&mut self) -> Result<(), String> {
            let setup = self.conn.setup();
            let (min, max) = (setup.min_keycode, setup.max_keycode);
            let reply = self.conn.get_keyboard_mapping(min, max - min + 1).map_err(err)?.reply().map_err(err)?;
            self.min = min;
            self.per = reply.keysyms_per_keycode;
            self.map = reply.keysyms;
            Ok(())
        }

        /// The keycode for `keysym`, and whether Shift must be held for it (it is the second symbol on that key).
        fn keycode(&self, keysym: Keysym) -> Option<(Keycode, bool)> {
            let per = usize::from(self.per.max(1));
            for column in 0..per.min(2) {
                for (i, chunk) in self.map.chunks(per).enumerate() {
                    if chunk.get(column) == Some(&keysym) {
                        return Some((self.min + i as u8, column == 1));
                    }
                }
            }
            None
        }

        /// A keycode with no symbols, free to borrow for a character the keyboard map lacks.
        fn spare(&self) -> Option<Keycode> {
            let per = usize::from(self.per.max(1));
            // Why from the top: the low keycodes are the real keys, the high ones are usually empty.
            self.map.chunks(per).enumerate().rev().find(|(_, chunk)| chunk.iter().all(|&s| s == 0)).map(|(i, _)| self.min + i as u8)
        }

        fn fake(&self, kind: u8, detail: u8, x: i16, y: i16) -> Result<(), String> {
            self.conn.xtest_fake_input(kind, detail, 0, self.root, x, y, 0).map_err(err)?;
            Ok(())
        }

        /// Waits until the X server has handled everything sent, so a later remap cannot overtake a key.
        fn sync(&self) -> Result<(), String> {
            self.conn.get_input_focus().map_err(err)?.reply().map_err(err)?;
            Ok(())
        }

        fn tap(&self, code: Keycode, shift: bool) -> Result<(), String> {
            let shift_code = if shift { Some(self.held_code(Held::Shift)?) } else { None };
            if let Some(s) = shift_code {
                self.fake(KEY_PRESS_EVENT, s, 0, 0)?;
            }
            self.fake(KEY_PRESS_EVENT, code, 0, 0)?;
            self.fake(KEY_RELEASE_EVENT, code, 0, 0)?;
            if let Some(s) = shift_code {
                self.fake(KEY_RELEASE_EVENT, s, 0, 0)?;
            }
            Ok(())
        }

        fn held_code(&self, held: Held) -> Result<Keycode, String> {
            self.keycode(held.keysym()).map(|(code, _)| code).ok_or_else(|| "key".to_string())
        }

        fn send(&mut self, input: &Input, at: Option<(f64, f64)>) -> Result<(), String> {
            if let Some((x, y)) = at {
                let clamp = |v: f64| v.clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i16;
                self.fake(MOTION_NOTIFY_EVENT, 0, clamp(x), clamp(y))?;
            }
            match input {
                Input::Move { .. } | Input::Drag { .. } => {}
                Input::Click { button, count, .. } => {
                    for _ in 0..(*count).clamp(1, 3) {
                        self.fake(BUTTON_PRESS_EVENT, number(*button), 0, 0)?;
                        self.fake(BUTTON_RELEASE_EVENT, number(*button), 0, 0)?;
                    }
                }
                Input::Press { button, down, .. } => {
                    let kind = if *down { BUTTON_PRESS_EVENT } else { BUTTON_RELEASE_EVENT };
                    self.fake(kind, number(*button), 0, 0)?;
                }
                Input::Scroll { dx, dy, .. } => {
                    // X scrolls by wheel buttons: 4 up, 5 down, 6 left, 7 right.
                    for (pixels, less, more) in [(*dy, 4u8, 5u8), (*dx, 6, 7)] {
                        let button = if pixels < 0 { less } else { more };
                        for _ in 0..wheel_clicks(pixels) {
                            self.fake(BUTTON_PRESS_EVENT, button, 0, 0)?;
                            self.fake(BUTTON_RELEASE_EVENT, button, 0, 0)?;
                        }
                    }
                }
                Input::Key { code, modifiers } => {
                    let key = keymap::from_mac(*code).ok_or("key")?;
                    let (keycode, _) = self.keycode(key.keysym).ok_or("key")?;
                    let held: Vec<Keycode> =
                        keymap::held(modifiers).into_iter().map(|m| self.held_code(m)).collect::<Result<_, _>>()?;
                    for &m in &held {
                        self.fake(KEY_PRESS_EVENT, m, 0, 0)?;
                    }
                    self.fake(KEY_PRESS_EVENT, keycode, 0, 0)?;
                    self.fake(KEY_RELEASE_EVENT, keycode, 0, 0)?;
                    for &m in held.iter().rev() {
                        self.fake(KEY_RELEASE_EVENT, m, 0, 0)?;
                    }
                }
                Input::Text { text } => self.type_text(text)?,
            }
            // Why a round trip, not a flush: the pointer is read back right after (screens.ts, the selftest) and the
            // server must have moved it by then.
            self.sync()
        }

        /// Types text: characters on the keyboard map as their keys, the rest (Korean, emoji…) by putting each such
        /// character on a spare keycode of its own and pressing that, then taking them all off again once typed.
        fn type_text(&mut self, text: &str) -> Result<(), String> {
            // Why one keycode per character and the late clear: apps look a key up when they handle it, which can be
            // after the next change to the map, so a key is not given another character while it may still be read.
            let mut borrowed: Vec<(Keysym, Keycode)> = Vec::new();
            let mut result = Ok(());
            for ch in text.chars() {
                let keysym = keymap::char_keysym(ch);
                if let Some((code, shift)) = self.keycode(keysym) {
                    result = self.tap(code, shift);
                } else {
                    // Why: long text in many scripts can use up the spare keycodes, so give them back and go on.
                    if self.spare().is_none() && !borrowed.is_empty() {
                        result = self.give_back(&mut borrowed);
                    }
                    result = result.and_then(|_| {
                        let spare = self.spare().ok_or("key")?;
                        borrowed.push((keysym, spare));
                        self.remap(spare, keysym)?;
                        self.tap(spare, false)
                    });
                }
                if result.is_err() {
                    break;
                }
            }
            let cleared = self.give_back(&mut borrowed);
            result.and(cleared)
        }

        /// Takes the borrowed characters off their keycodes, once the keys pressed so far have had time to be read.
        fn give_back(&mut self, borrowed: &mut Vec<(Keysym, Keycode)>) -> Result<(), String> {
            if borrowed.is_empty() {
                return Ok(());
            }
            self.sync()?;
            sleep(CLEAR_WAIT);
            let mut result = Ok(());
            for (_, spare) in borrowed.drain(..) {
                let cleared = self.remap(spare, 0);
                result = result.and(cleared);
            }
            result
        }

        fn remap(&mut self, code: Keycode, keysym: Keysym) -> Result<(), String> {
            // Why two symbols (lower and upper case), as Chrome Remote Desktop's X11 input does: with the server's
            // full width per key, Chromium on Xvfb read a borrowed Korean key as no character.
            self.conn.change_keyboard_mapping(1, code, 2, &[keysym, keysym]).map_err(err)?;
            self.sync()?;
            // Why read the map back: the server widens the two symbols to its own width per key.
            self.read_map()?;
            if keysym != 0 {
                sleep(REMAP_WAIT);
            }
            Ok(())
        }
    }

    fn number(button: Button) -> u8 {
        match button {
            Button::Left => 1,
            Button::Right => 3,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{to_global, wheel, wheel_clicks, Bounds, Button, Input};

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

    #[test]
    fn wheel_clicks_for_x() {
        assert_eq!(wheel_clicks(0), 0);
        assert_eq!(wheel_clicks(1), 1);
        assert_eq!(wheel_clicks(-50), 1);
        assert_eq!(wheel_clicks(120), 3);
        assert_eq!(wheel_clicks(i32::MIN), 20);
    }
}
