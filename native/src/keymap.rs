//! Viewers send keys as macOS virtual key codes (src/keys.ts), whatever computer they look at. On Windows and Linux
//! those codes become a Windows virtual key or an X keysym here, so one viewer works with every system.
//!
//! The Mac's Command key does what Control does on Windows and Linux (copy, paste, select all), so both become
//! Control there; Option becomes Alt.

#![cfg_attr(target_os = "macos", allow(dead_code))]

use crate::input::Modifier;

/// One key on Windows and on X.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Key {
    /// Windows virtual key (`VK_*`).
    pub vk: u16,
    /// Windows needs the "extended key" flag for the arrows and the block above them, or they act as the number pad.
    pub extended: bool,
    /// X keysym (`XK_*`).
    pub keysym: u32,
}

/// The modifier keys as Windows and X know them, after Command and Control are merged.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Held {
    Shift,
    Control,
    Alt,
}

impl Held {
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub fn vk(self) -> u16 {
        match self {
            Held::Shift => 0x10,
            Held::Control => 0x11,
            Held::Alt => 0x12,
        }
    }

    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn keysym(self) -> u32 {
        match self {
            Held::Shift => 0xffe1,   // Shift_L
            Held::Control => 0xffe3, // Control_L
            Held::Alt => 0xffe9,     // Alt_L
        }
    }
}

/// The keys to hold for a viewer's modifiers, each once, Control first.
pub fn held(modifiers: &[Modifier]) -> Vec<Held> {
    let mut keys = Vec::new();
    for want in [Held::Control, Held::Alt, Held::Shift] {
        let asked = modifiers.iter().any(|m| {
            matches!(
                (want, m),
                (Held::Control, Modifier::Control | Modifier::Command)
                    | (Held::Alt, Modifier::Option)
                    | (Held::Shift, Modifier::Shift)
            )
        });
        if asked {
            keys.push(want);
        }
    }
    keys
}

/// (macOS key code, Windows VK, extended, X keysym) for every key src/keys.ts can send.
const KEYS: &[(u16, u16, bool, u32)] = &[
    // Letters: VK is the capital letter, the keysym the small one.
    (0, 0x41, false, 0x61),  // A
    (11, 0x42, false, 0x62), // B
    (8, 0x43, false, 0x63),  // C
    (2, 0x44, false, 0x64),  // D
    (14, 0x45, false, 0x65), // E
    (3, 0x46, false, 0x66),  // F
    (5, 0x47, false, 0x67),  // G
    (4, 0x48, false, 0x68),  // H
    (34, 0x49, false, 0x69), // I
    (38, 0x4a, false, 0x6a), // J
    (40, 0x4b, false, 0x6b), // K
    (37, 0x4c, false, 0x6c), // L
    (46, 0x4d, false, 0x6d), // M
    (45, 0x4e, false, 0x6e), // N
    (31, 0x4f, false, 0x6f), // O
    (35, 0x50, false, 0x70), // P
    (12, 0x51, false, 0x71), // Q
    (15, 0x52, false, 0x72), // R
    (1, 0x53, false, 0x73),  // S
    (17, 0x54, false, 0x74), // T
    (32, 0x55, false, 0x75), // U
    (9, 0x56, false, 0x76),  // V
    (13, 0x57, false, 0x77), // W
    (7, 0x58, false, 0x78),  // X
    (16, 0x59, false, 0x79), // Y
    (6, 0x5a, false, 0x7a),  // Z
    (29, 0x30, false, 0x30), // 0
    (18, 0x31, false, 0x31), // 1
    (19, 0x32, false, 0x32), // 2
    (20, 0x33, false, 0x33), // 3
    (21, 0x34, false, 0x34), // 4
    (23, 0x35, false, 0x35), // 5
    (22, 0x36, false, 0x36), // 6
    (26, 0x37, false, 0x37), // 7
    (28, 0x38, false, 0x38), // 8
    (25, 0x39, false, 0x39), // 9
    (24, 0xbb, false, 0x3d), // Equal
    (27, 0xbd, false, 0x2d), // Minus
    (33, 0xdb, false, 0x5b), // BracketLeft
    (30, 0xdd, false, 0x5d), // BracketRight
    (39, 0xde, false, 0x27), // Quote
    (41, 0xba, false, 0x3b), // Semicolon
    (42, 0xdc, false, 0x5c), // Backslash
    (43, 0xbc, false, 0x2c), // Comma
    (44, 0xbf, false, 0x2f), // Slash
    (47, 0xbe, false, 0x2e), // Period
    (50, 0xc0, false, 0x60), // Backquote
    (10, 0xe2, false, 0x3c), // IntlBackslash
    (36, 0x0d, false, 0xff0d), // Enter
    (76, 0x0d, true, 0xff8d),  // NumpadEnter
    (48, 0x09, false, 0xff09), // Tab
    (49, 0x20, false, 0x20),   // Space
    (51, 0x08, false, 0xff08), // Backspace
    (53, 0x1b, false, 0xff1b), // Escape
    (117, 0x2e, true, 0xffff), // Delete
    (115, 0x24, true, 0xff50), // Home
    (119, 0x23, true, 0xff57), // End
    (116, 0x21, true, 0xff55), // PageUp
    (121, 0x22, true, 0xff56), // PageDown
    (123, 0x25, true, 0xff51), // ArrowLeft
    (126, 0x26, true, 0xff52), // ArrowUp
    (124, 0x27, true, 0xff53), // ArrowRight
    (125, 0x28, true, 0xff54), // ArrowDown
    (122, 0x70, false, 0xffbe), // F1
    (120, 0x71, false, 0xffbf), // F2
    (99, 0x72, false, 0xffc0),  // F3
    (118, 0x73, false, 0xffc1), // F4
    (96, 0x74, false, 0xffc2),  // F5
    (97, 0x75, false, 0xffc3),  // F6
    (98, 0x76, false, 0xffc4),  // F7
    (100, 0x77, false, 0xffc5), // F8
    (101, 0x78, false, 0xffc6), // F9
    (109, 0x79, false, 0xffc7), // F10
    (103, 0x7a, false, 0xffc8), // F11
    (111, 0x7b, false, 0xffc9), // F12
    (105, 0x7c, false, 0xffca), // F13
    (107, 0x7d, false, 0xffcb), // F14
    (113, 0x7e, false, 0xffcc), // F15
    (106, 0x7f, false, 0xffcd), // F16
    (64, 0x80, false, 0xffce),  // F17
    (79, 0x81, false, 0xffcf),  // F18
    (80, 0x82, false, 0xffd0),  // F19
    (90, 0x83, false, 0xffd1),  // F20
    (71, 0x90, false, 0xff7f),  // NumLock
    (65, 0x6e, false, 0xffae),  // NumpadDecimal
    (67, 0x6a, false, 0xffaa),  // NumpadMultiply
    (69, 0x6b, false, 0xffab),  // NumpadAdd
    (75, 0x6f, true, 0xffaf),   // NumpadDivide
    (78, 0x6d, false, 0xffad),  // NumpadSubtract
    // Why the main Equal key on Windows: its number pad has no Equal key.
    (81, 0xbb, false, 0xffbd), // NumpadEqual
    (82, 0x60, false, 0xffb0), // Numpad0
    (83, 0x61, false, 0xffb1), // Numpad1
    (84, 0x62, false, 0xffb2), // Numpad2
    (85, 0x63, false, 0xffb3), // Numpad3
    (86, 0x64, false, 0xffb4), // Numpad4
    (87, 0x65, false, 0xffb5), // Numpad5
    (88, 0x66, false, 0xffb6), // Numpad6
    (89, 0x67, false, 0xffb7), // Numpad7
    (91, 0x68, false, 0xffb8), // Numpad8
    (92, 0x69, false, 0xffb9), // Numpad9
];

/// The Windows and X key for a macOS key code, or none for a code no viewer sends.
pub fn from_mac(code: u16) -> Option<Key> {
    KEYS.iter()
        .find(|(mac, ..)| *mac == code)
        .map(|&(_, vk, extended, keysym)| Key { vk, extended, keysym })
}

/// The X keysym that types `ch`: Latin-1 characters are their own keysym, everything else is 0x01000000 plus the
/// code point (the X rule for Unicode keysyms).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn char_keysym(ch: char) -> u32 {
    match ch {
        '\n' | '\r' => 0xff0d, // Return
        '\t' => 0xff09,         // Tab
        ' '..='~' | '\u{a0}'..='\u{ff}' => ch as u32,
        _ => 0x0100_0000 + ch as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::{char_keysym, from_mac, held, Held, Key, KEYS};
    use crate::input::Modifier;

    #[test]
    fn maps_common_keys() {
        assert_eq!(from_mac(8), Some(Key { vk: 0x43, extended: false, keysym: 0x63 })); // C
        assert_eq!(from_mac(36), Some(Key { vk: 0x0d, extended: false, keysym: 0xff0d })); // Return
        assert_eq!(from_mac(123), Some(Key { vk: 0x25, extended: true, keysym: 0xff51 })); // Left
        assert_eq!(from_mac(52), None); // no key sends 52
    }

    #[test]
    fn every_mac_code_once() {
        let mut codes: Vec<u16> = KEYS.iter().map(|k| k.0).collect();
        codes.sort_unstable();
        let before = codes.len();
        codes.dedup();
        assert_eq!(codes.len(), before);
        // src/keys.ts CODES has 100 entries; this table covers all of them.
        assert_eq!(before, 100);
    }

    #[test]
    fn command_is_control() {
        assert_eq!(held(&[Modifier::Command]), vec![Held::Control]);
        assert_eq!(held(&[Modifier::Command, Modifier::Control]), vec![Held::Control]);
        assert_eq!(held(&[Modifier::Shift, Modifier::Option, Modifier::Command]), vec![Held::Control, Held::Alt, Held::Shift]);
        assert_eq!(held(&[]), vec![]);
    }

    #[test]
    fn keysyms_for_text() {
        assert_eq!(char_keysym('a'), 0x61);
        assert_eq!(char_keysym('é'), 0xe9);
        assert_eq!(char_keysym('한'), 0x0100_d55c);
        assert_eq!(char_keysym('\n'), 0xff0d);
    }
}
