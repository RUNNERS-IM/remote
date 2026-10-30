//! This Mac's displays and one JPEG picture of a display, taken with ScreenCaptureKit.
//!
//! Positions and sizes are in display points in the global space CGEvent uses (origin at the top-left
//! of the main display), so the same numbers serve the picture and `input.rs`.

use serde::Serialize;

/// One display, as the window's tabs list it.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: u32,
    /// The name macOS shows in System Settings, e.g. "Built-in Retina Display"; empty when unknown.
    pub name: String,
    pub main: bool,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub pixel_width: u64,
    pub pixel_height: u64,
}

/// Why the longest side of a picture is capped: a 5K display sent five times a second is far more
/// than a viewer needs to find a button, and JPEG time grows with the pixel count.
pub const MAX_SIDE: usize = 1920;
const JPEG_QUALITY: f64 = 0.6;

#[cfg(target_os = "macos")]
pub use mac::{capture_jpeg, displays};

#[cfg(not(target_os = "macos"))]
pub fn displays() -> Vec<Display> {
    Vec::new()
}

#[cfg(not(target_os = "macos"))]
pub fn capture_jpeg(_id: u32) -> Result<Vec<u8>, String> {
    Err("unsupported".into())
}

/// Picture size for a display: its point size, scaled down so neither side passes `MAX_SIDE`.
pub fn picture_size(width: f64, height: f64) -> (usize, usize) {
    let scale = (MAX_SIDE as f64 / width.max(height)).min(1.0);
    ((width * scale).round().max(1.0) as usize, (height * scale).round().max(1.0) as usize)
}

#[cfg(target_os = "macos")]
mod mac {
    use std::collections::HashMap;
    use std::ptr::NonNull;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use core_graphics::display::CGDisplay;
    use objc2::rc::Retained;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::NSScreen;
    use objc2_core_foundation::{CFDictionary, CFMutableData, CFNumber, CFRetained, CFString};
    use objc2_core_graphics::{CGImage, CGPreflightScreenCaptureAccess};
    use objc2_foundation::{NSArray, NSError, NSNumber, NSString};
    use objc2_image_io::{kCGImageDestinationLossyCompressionQuality, CGImageDestination};
    use objc2_screen_capture_kit::{
        SCContentFilter, SCDisplay, SCScreenshotManager, SCShareableContent, SCStreamConfiguration,
    };

    use super::{picture_size, Display, JPEG_QUALITY};

    const WAIT: Duration = Duration::from_secs(5);

    /// Carries an Objective-C object out of a completion handler, which runs on a ScreenCaptureKit queue.
    /// Why: ScreenCaptureKit hands these objects across threads itself; the Rust types just do not say so.
    struct Sent<T>(T);
    unsafe impl<T> Send for Sent<T> {}

    /// Every active display, main display first, then left to right.
    pub fn displays() -> Vec<Display> {
        let names = screen_names();
        let mut list: Vec<Display> = CGDisplay::active_displays()
            .unwrap_or_default()
            .into_iter()
            .map(|id| {
                let display = CGDisplay::new(id);
                let bounds = display.bounds();
                Display {
                    id,
                    name: names.get(&id).cloned().unwrap_or_default(),
                    main: display.is_main(),
                    x: bounds.origin.x,
                    y: bounds.origin.y,
                    width: bounds.size.width,
                    height: bounds.size.height,
                    pixel_width: display.pixels_wide(),
                    pixel_height: display.pixels_high(),
                }
            })
            .collect();
        list.sort_by(|a, b| b.main.cmp(&a.main).then(a.x.total_cmp(&b.x)).then(a.y.total_cmp(&b.y)));
        list
    }

    /// Display names by display id. Only AppKit knows the names and it must be asked on the main thread,
    /// so off the main thread this is empty and the window falls back to "Display 1, 2…".
    fn screen_names() -> HashMap<u32, String> {
        let Some(mtm) = MainThreadMarker::new() else {
            return HashMap::new();
        };
        let key = NSString::from_str("NSScreenNumber");
        NSScreen::screens(mtm)
            .iter()
            .filter_map(|screen| {
                let number = screen.deviceDescription().objectForKey(&key)?;
                let id = number.downcast::<NSNumber>().ok()?.unsignedIntValue();
                Some((id, screen.localizedName().to_string()))
            })
            .collect()
    }

    /// Takes one picture of display `id` and returns it as JPEG bytes.
    /// Errors are short codes the window turns into text: `permission`, `display`, `timeout`, or the system's message.
    pub fn capture_jpeg(id: u32) -> Result<Vec<u8>, String> {
        // Why: checking first gives the window one clear reason to show, instead of a system error every frame.
        if !CGPreflightScreenCaptureAccess() {
            return Err("permission".into());
        }
        let display = find_display(id)?;
        let image = screenshot(&display)?;
        encode_jpeg(&image)
    }

    fn find_display(id: u32) -> Result<Retained<SCDisplay>, String> {
        let (tx, rx) = mpsc::channel::<Result<Sent<Retained<SCShareableContent>>, String>>();
        let handler = RcBlock::new(move |content: *mut SCShareableContent, error: *mut NSError| {
            let _ = tx.send(match unsafe { Retained::retain(content) } {
                Some(content) => Ok(Sent(content)),
                None => Err(error_text(error)),
            });
        });
        unsafe { SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(false, true, &handler) };
        let content = rx.recv_timeout(WAIT).map_err(|_| "timeout".to_string())??.0;
        unsafe { content.displays() }
            .iter()
            .find(|display| unsafe { display.displayID() } == id)
            .ok_or_else(|| "display".to_string())
    }

    fn screenshot(display: &SCDisplay) -> Result<CFRetained<CGImage>, String> {
        let filter = unsafe {
            SCContentFilter::initWithDisplay_excludingWindows(SCContentFilter::alloc(), display, &NSArray::new())
        };
        let (width, height) = unsafe { picture_size(display.width() as f64, display.height() as f64) };
        let config = unsafe { SCStreamConfiguration::new() };
        unsafe {
            config.setWidth(width);
            config.setHeight(height);
            config.setShowsCursor(true);
        }
        let (tx, rx) = mpsc::channel::<Result<Sent<CFRetained<CGImage>>, String>>();
        let handler = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
            let _ = tx.send(match NonNull::new(image) {
                Some(image) => Ok(Sent(unsafe { CFRetained::retain(image) })),
                None => Err(error_text(error)),
            });
        });
        unsafe { SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(&filter, &config, Some(&handler)) };
        Ok(rx.recv_timeout(WAIT).map_err(|_| "timeout".to_string())??.0)
    }

    fn encode_jpeg(image: &CGImage) -> Result<Vec<u8>, String> {
        let data = CFMutableData::new(None, 0).ok_or("jpeg")?;
        let jpeg = CFString::from_static_str("public.jpeg");
        let destination = unsafe { CGImageDestination::with_data(&data, &jpeg, 1, None) }.ok_or("jpeg")?;
        let quality = CFNumber::new_f64(JPEG_QUALITY);
        let options = CFDictionary::<CFString, CFNumber>::from_slices(
            &[unsafe { kCGImageDestinationLossyCompressionQuality }],
            &[&quality],
        );
        unsafe { destination.add_image(image, Some(options.as_opaque())) };
        if !unsafe { destination.finalize() } {
            return Err("jpeg".into());
        }
        Ok(data.to_vec())
    }

    fn error_text(error: *mut NSError) -> String {
        unsafe { Retained::retain(error) }.map_or_else(|| "unknown".to_string(), |e| e.localizedDescription().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::picture_size;

    #[test]
    fn caps_the_longest_side() {
        assert_eq!(picture_size(1512.0, 982.0), (1512, 982));
        assert_eq!(picture_size(2560.0, 1440.0), (1920, 1080));
        assert_eq!(picture_size(1080.0, 1920.0), (1080, 1920));
        assert_eq!(picture_size(1440.0, 2560.0), (1080, 1920));
    }

    /// Takes one real picture of the main display and writes it to `$REMOTE_CAPTURE_OUT`.
    /// Ignored by default: it needs Screen Recording for the program running the test (e.g. Terminal).
    /// Run: REMOTE_CAPTURE_OUT=/tmp/main.jpg cargo test --lib -- --ignored capture_main_display
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn capture_main_display() {
        let out = std::env::var("REMOTE_CAPTURE_OUT").expect("set REMOTE_CAPTURE_OUT to a file path");
        if !objc2_core_graphics::CGPreflightScreenCaptureAccess() {
            panic!("no Screen Recording permission for this process; nothing captured");
        }
        let main = super::displays().into_iter().find(|d| d.main).expect("a main display");
        let jpeg = super::capture_jpeg(main.id).expect("capture");
        assert_eq!(&jpeg[..2], &[0xff, 0xd8], "JPEG files start with FF D8");
        std::fs::write(&out, &jpeg).unwrap();
        println!("display {} ({} x {} pt): {} bytes -> {out}", main.id, main.width, main.height, jpeg.len());
    }
}
