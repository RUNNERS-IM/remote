//! Remote's native module, loaded by the Electron main process (electron/main/native.ts).
//! Why one module: RUNNERS apps reach OS features through a single Node native module instead of helper programs.
//! Taking a picture runs off the main thread and returns a Promise; the rest is quick and answers at once.
//! Everything here works on macOS only for now; on Windows and Linux the same calls answer "unsupported" or empty,
//! and the app says so on screen.

mod capture;
mod input;
mod permissions;
mod tray;

use std::process::Command;

use napi::bindgen_prelude::*;
use napi::{Env, Task};
use napi_derive::napi;

/// Taking one picture, for the libuv thread pool; it resolves to the JPEG bytes.
pub struct Capture(u32);

impl Task for Capture {
    type Output = Vec<u8>;
    type JsValue = Buffer;

    fn compute(&mut self) -> Result<Vec<u8>> {
        capture::capture_jpeg(self.0).map_err(Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Vec<u8>) -> Result<Buffer> {
        Ok(output.into())
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|e| Error::from_reason(e.to_string()))
}

/// This computer's name as the user set it (System Settings on macOS), e.g. "RUNNERS Mac Studio".
#[napi]
pub fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    if let Some(name) = Command::new("scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        .filter(|name| !name.is_empty())
    {
        return name;
    }
    Command::new("hostname")
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().trim_end_matches(".local").to_owned())
        .unwrap_or_default()
}

/// The displays as JSON (shape in src/types.ts), main display first. Must run on the main thread, where AppKit
/// gives the display names; the Electron main process calls it there.
#[napi]
pub fn displays() -> Result<String> {
    to_json(&capture::displays())
}

/// One JPEG picture of a display. Rejects with a short code: `permission`, `display`, `timeout`, `unsupported`,
/// or the system's message.
#[napi(ts_return_type = "Promise<Buffer>")]
pub fn capture(display: u32) -> AsyncTask<Capture> {
    AsyncTask::new(Capture(display))
}

/// `{ screenRecording, accessibility }` as JSON; both false outside macOS.
#[napi]
pub fn permissions() -> Result<String> {
    to_json(&permissions::current())
}

/// Shows the system prompt for Screen Recording the first time; returns whether it is allowed.
#[napi]
pub fn request_screen_recording() -> bool {
    permissions::request_screen_recording()
}

/// Shows the system prompt for Accessibility when not yet allowed; returns whether it is allowed.
#[napi]
pub fn request_accessibility() -> bool {
    permissions::request_accessibility()
}

/// Posts one click, move, key or text (JSON, shape in `input.rs`) into this computer. Returns the global point a
/// move or click went to, as `[x, y]` in display points, or an empty list for keys and text.
#[napi]
pub fn send_input(json: String) -> Result<Vec<f64>> {
    let input: input::Input = serde_json::from_str(&json).map_err(|e| Error::from_reason(e.to_string()))?;
    let at = input::send(&input).map_err(Error::from_reason)?;
    Ok(at.map_or_else(Vec::new, |(x, y)| vec![x, y]))
}

/// The menu-bar picture for `status` (`off`, `waiting`, `viewing`) as a 36×36 PNG in the colour `r g b`.
/// `frame` picks the step of the moving arrow while viewing (0 – `trayFrames() - 1`).
#[napi]
pub fn tray_png(status: String, frame: u32, r: u8, g: u8, b: u8) -> Result<Buffer> {
    let status = tray::Status::parse(&status).ok_or_else(|| Error::from_reason(format!("unknown status {status}")))?;
    Ok(tray::png(status, frame, [r, g, b]).into())
}

/// How many pictures one bob of the arrow has, and how long each one shows (milliseconds).
#[napi]
pub fn tray_frames() -> Vec<u32> {
    vec![tray::FRAMES, tray::FRAME_EVERY_MS]
}
