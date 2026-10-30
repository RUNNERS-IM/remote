//! The menu-bar picture, drawn in code (shared RUNNERS spec "5A").
//!
//! All four RUNNERS apps share one frame: a rounded rectangle on a 24 × 24 grid. Remote adds an arrow pointing to the
//! upper right ("this screen goes out"), and the picture follows the status:
//! - off: frame only, because Screen Recording is not allowed and nobody can see this Mac;
//! - waiting: frame + arrow, still;
//! - viewing: the arrow bobs toward the upper right and back, so the user notices someone is looking.
//!
//! The pictures are drawn once at launch and kept in memory; the moving one is a short list of frames played in turn.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use tauri::image::Image;
use tauri::tray::TrayIcon;
use tiny_skia::{LineCap, LineJoin, Paint, PathBuilder, Pixmap, Stroke, Transform};

use crate::menu::Status;

/// 18 pt menu-bar slot at 2x, so the picture stays sharp on Retina screens.
pub const SIZE: u32 = 36;
const GRID: f32 = 24.0;
/// How far the arrow moves at the top of a bob, in grid units, along each axis (the same as the chosen preview).
const BOB: f32 = 1.2;
/// Frames in one bob cycle. 16 frames × 86 ms ≈ 1.4 s per cycle (about 12 frames a second), the speed of the preview.
const FRAMES: usize = 16;
pub const FRAME_EVERY: Duration = Duration::from_millis(86);

/// Why: macOS recolours a template picture to match the menu bar, so it is drawn in black. Windows and Linux show
/// the picture as is, and their taskbars are usually dark, so it is drawn in a light colour there.
#[cfg(target_os = "macos")]
const INK: [u8; 3] = [0, 0, 0];
#[cfg(not(target_os = "macos"))]
const INK: [u8; 3] = [0xF2, 0xF2, 0xF2];

/// Straight (not premultiplied) RGBA pixels, `SIZE` × `SIZE`.
pub type Rgba = Vec<u8>;

/// Every picture the menu bar can show, drawn once.
pub struct Pictures {
    pub off: Rgba,
    pub waiting: Rgba,
    pub viewing: Vec<Rgba>,
}

impl Pictures {
    pub fn draw() -> Self {
        Self {
            off: draw(None),
            waiting: draw(Some((0.0, 0.0))),
            viewing: (0..FRAMES).map(|i| draw(Some(bob(i)))).collect(),
        }
    }

    /// The picture for a status; `frame` only matters while viewing.
    pub fn get(&self, status: Status, frame: usize) -> &Rgba {
        match status {
            Status::Off => &self.off,
            Status::Waiting => &self.waiting,
            Status::Viewing => &self.viewing[frame % self.viewing.len()],
        }
    }
}

pub fn image(rgba: &Rgba) -> Image<'_> {
    Image::new(rgba, SIZE, SIZE)
}

/// Arrow offset for one frame: half a sine wave out to the upper right, then a short rest at the start position,
/// the same motion as the preview (`max(0, sin t) × 1.2`).
fn bob(frame: usize) -> (f32, f32) {
    let t = frame as f32 / FRAMES as f32 * std::f32::consts::TAU;
    let d = t.sin().max(0.0) * BOB;
    (d, -d)
}

/// Draws the frame, and the arrow moved by `arrow` grid units when there is one.
fn draw(arrow: Option<(f32, f32)>) -> Rgba {
    let mut pixmap = Pixmap::new(SIZE, SIZE).expect("tray picture size");
    let mut paint = Paint::default();
    paint.set_color_rgba8(INK[0], INK[1], INK[2], 255);
    paint.anti_alias = true;
    let scale = SIZE as f32 / GRID;
    let grid = Transform::from_scale(scale, scale);

    // Shared frame: x 2.5, y 4.5, 19 × 15, corner radius 3, line 2.
    if let Some(frame) = rounded_rect(2.5, 4.5, 19.0, 15.0, 3.0) {
        let stroke = Stroke { width: 2.0, ..Stroke::default() };
        pixmap.stroke_path(&frame, &paint, &stroke, grid, None);
    }

    // Arrow: "M9 15 L15 9" and "M10.5 9 H15 V13.5", line 1.8, round ends and corners.
    if let Some((dx, dy)) = arrow {
        let mut pb = PathBuilder::new();
        pb.move_to(9.0, 15.0);
        pb.line_to(15.0, 9.0);
        pb.move_to(10.5, 9.0);
        pb.line_to(15.0, 9.0);
        pb.line_to(15.0, 13.5);
        if let Some(path) = pb.finish() {
            let stroke = Stroke { width: 1.8, line_cap: LineCap::Round, line_join: LineJoin::Round, ..Stroke::default() };
            pixmap.stroke_path(&path, &paint, &stroke, grid.pre_translate(dx, dy), None);
        }
    }

    // Why: tiny-skia keeps premultiplied colour, and Tauri's Image wants plain RGBA.
    pixmap.take_demultiplied()
}

/// A rounded rectangle; corners are cubic curves, the usual circle approximation (0.5523 of the radius).
fn rounded_rect(x: f32, y: f32, w: f32, h: f32, r: f32) -> Option<tiny_skia::Path> {
    let k = r * 0.552_284_8;
    let (right, bottom) = (x + w, y + h);
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(right - r, y);
    pb.cubic_to(right - r + k, y, right, y + r - k, right, y + r);
    pb.line_to(right, bottom - r);
    pb.cubic_to(right, bottom - r + k, right - r + k, bottom, right - r, bottom);
    pb.line_to(x + r, bottom);
    pb.cubic_to(x + r - k, bottom, x, bottom - r + k, x, bottom - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    pb.close();
    pb.finish()
}

/// Shows `rgba` in the menu bar. Why: one call that sets the picture and the template flag together, because
/// `set_icon` alone turns the template flag off on macOS and the picture would flash black on a dark menu bar.
fn show(tray: &TrayIcon, rgba: &Rgba) {
    let _ = tray.set_icon_with_as_template(Some(image(rgba)), cfg!(target_os = "macos"));
}

/// Starts the thread that keeps the menu-bar picture in step with the status, and returns where to send new statuses.
/// While viewing it plays the next frame every `FRAME_EVERY`; otherwise it sleeps until the status changes.
pub fn start(tray: TrayIcon, pictures: Pictures, first: Status) -> Sender<Status> {
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || animate(&tray, &pictures, first, &receive));
    send
}

fn animate(tray: &TrayIcon, pictures: &Pictures, first: Status, receive: &Receiver<Status>) {
    let mut status = first;
    let mut frame = 0;
    loop {
        let next = if status == Status::Viewing {
            match receive.recv_timeout(FRAME_EVERY) {
                Ok(next) => Some(next),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        } else {
            match receive.recv() {
                Ok(next) => Some(next),
                Err(_) => return,
            }
        };
        match next {
            Some(next) if next == status => continue,
            Some(next) => {
                status = next;
                frame = 0;
            }
            None => frame = (frame + 1) % FRAMES,
        }
        show(tray, pictures.get(status, frame));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ink(rgba: &Rgba) -> usize {
        rgba.chunks(4).filter(|px| px[3] > 0).count()
    }

    #[test]
    fn every_state_is_drawn_at_36_px_and_differs_where_it_should() {
        let pictures = Pictures::draw();
        let all: Vec<&Rgba> = [&pictures.off, &pictures.waiting].into_iter().chain(pictures.viewing.iter()).collect();
        for rgba in &all {
            assert_eq!(rgba.len(), (SIZE * SIZE * 4) as usize);
            assert!(ink(rgba) > 0, "a picture is empty");
        }
        assert_ne!(pictures.waiting, pictures.off, "waiting should add the arrow");
        assert!(ink(&pictures.waiting) > ink(&pictures.off));
        for (i, frame) in pictures.viewing.iter().enumerate() {
            assert_ne!(*frame, pictures.off, "viewing frame {i} should have the arrow");
        }
        // The first frame is the rest position (same as waiting); the middle of the bob is moved.
        assert_eq!(pictures.viewing[0], pictures.waiting);
        assert_ne!(pictures.viewing[FRAMES / 4], pictures.waiting, "the arrow should move while viewing");
    }

    /// Writes the pictures to PNG for a look by eye: `TRAY_PNG_DIR=/some/dir cargo test --lib tray_icon`.
    #[test]
    fn writes_pngs_when_asked() {
        let Ok(dir) = std::env::var("TRAY_PNG_DIR") else {
            return;
        };
        std::fs::create_dir_all(&dir).unwrap();
        let pictures = Pictures::draw();
        let save = |name: &str, rgba: &Rgba| {
            let mut pixmap = Pixmap::new(SIZE, SIZE).unwrap();
            for (px, c) in pixmap.pixels_mut().iter_mut().zip(rgba.chunks(4)) {
                *px = tiny_skia::ColorU8::from_rgba(c[0], c[1], c[2], c[3]).premultiply();
            }
            pixmap.save_png(format!("{dir}/{name}.png")).unwrap();
        };
        save("off", &pictures.off);
        save("waiting", &pictures.waiting);
        for (i, frame) in pictures.viewing.iter().enumerate() {
            save(&format!("viewing-{i:02}"), frame);
        }
    }
}
