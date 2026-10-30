//! The two macOS permissions Remote needs on the receiving side, read and requested.
//! Screen Recording lets it take pictures of the screen; Accessibility lets it post clicks and keys.

use serde::Serialize;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub screen_recording: bool,
    pub accessibility: bool,
}

#[cfg(target_os = "macos")]
mod mac {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    pub fn accessibility() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    /// Shows the system's "Remote would like to control this computer" prompt when not yet allowed.
    pub fn request_accessibility() -> bool {
        let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
        let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
        unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) }
    }
}

#[cfg(target_os = "macos")]
pub fn current() -> Permissions {
    Permissions {
        screen_recording: objc2_core_graphics::CGPreflightScreenCaptureAccess(),
        accessibility: mac::accessibility(),
    }
}

/// Asks macOS for Screen Recording. The first time it shows the system prompt; after that it does nothing,
/// and the user has to turn it on in System Settings. macOS applies it only after Remote restarts.
#[cfg(target_os = "macos")]
pub fn request_screen_recording() -> bool {
    objc2_core_graphics::CGRequestScreenCaptureAccess()
}

#[cfg(target_os = "macos")]
pub use mac::request_accessibility;

#[cfg(not(target_os = "macos"))]
pub fn current() -> Permissions {
    Permissions { screen_recording: false, accessibility: false }
}

#[cfg(not(target_os = "macos"))]
pub fn request_screen_recording() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn request_accessibility() -> bool {
    false
}
