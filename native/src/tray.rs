//! The menu-bar picture, drawn in code (shared RUNNERS spec "5A").
//!
//! All four RUNNERS apps share one frame: a rounded rectangle on a 24 × 24 grid. Remote adds an arrow pointing to the
//! upper right ("this screen goes out"), and the picture follows the status:
//! - off: frame only, because Remote cannot show this computer (no Screen Recording, or not macOS);
//! - waiting: frame + arrow, still;
//! - viewing: the arrow bobs toward the upper right and back, so the user notices someone is looking.
//!
//! The main process asks for one PNG per status (and per frame while viewing) and keeps them; the moving one is
//! played there as a short list of frames.

use tiny_skia::{LineCap, LineJoin, Paint, PathBuilder, Pixmap, Stroke, Transform};

/// 18 pt menu-bar slot at 2x, so the picture stays sharp on Retina screens.
pub const SIZE: u32 = 36;
const GRID: f32 = 24.0;
/// How far the arrow moves at the top of a bob, in grid units, along each axis (the same as the chosen preview).
const BOB: f32 = 1.2;
/// Frames in one bob cycle. 16 frames × 86 ms ≈ 1.4 s per cycle (about 12 frames a second), the speed of the preview.
pub const FRAMES: u32 = 16;
pub const FRAME_EVERY_MS: u32 = 86;

/// What the receiving side is doing, as the menu bar shows it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Off,
    Waiting,
    Viewing,
}

impl Status {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "off" => Some(Self::Off),
            "waiting" => Some(Self::Waiting),
            "viewing" => Some(Self::Viewing),
            _ => None,
        }
    }
}

/// The picture for a status in `color` as straight RGBA; `frame` only matters while viewing. Only the tests read raw pixels.
#[cfg(test)]
pub fn rgba(status: Status, frame: u32, color: [u8; 3]) -> Vec<u8> {
    draw(arrow(status, frame), color).take_demultiplied()
}

/// The same picture as a PNG file, which Electron's `nativeImage.createFromBuffer` reads.
/// Why a colour: macOS reads it as a template (only the alpha counts), other systems show the colour as drawn.
pub fn png(status: Status, frame: u32, color: [u8; 3]) -> Vec<u8> {
    draw(arrow(status, frame), color).encode_png().unwrap_or_default()
}

fn arrow(status: Status, frame: u32) -> Option<(f32, f32)> {
    match status {
        Status::Off => None,
        Status::Waiting => Some((0.0, 0.0)),
        Status::Viewing => Some(bob(frame % FRAMES)),
    }
}

/// Arrow offset for one frame: half a sine wave out to the upper right, then a short rest at the start position,
/// the same motion as the preview (`max(0, sin t) × 1.2`).
fn bob(frame: u32) -> (f32, f32) {
    let t = frame as f32 / FRAMES as f32 * std::f32::consts::TAU;
    let d = t.sin().max(0.0) * BOB;
    (d, -d)
}

/// Draws the frame, and the arrow moved by `arrow` grid units when there is one.
fn draw(arrow: Option<(f32, f32)>, color: [u8; 3]) -> Pixmap {
    let mut pixmap = Pixmap::new(SIZE, SIZE).expect("tray picture size");
    let mut paint = Paint::default();
    paint.set_color_rgba8(color[0], color[1], color[2], 255);
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

    pixmap
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

#[cfg(test)]
mod tests {
    use super::*;

    const INK: [u8; 3] = [0, 0, 0];

    fn ink(rgba: &[u8]) -> usize {
        rgba.chunks(4).filter(|px| px[3] > 0).count()
    }

    #[test]
    fn every_state_is_drawn_at_36_px_and_differs_where_it_should() {
        let off = rgba(Status::Off, 0, INK);
        let waiting = rgba(Status::Waiting, 0, INK);
        let viewing: Vec<Vec<u8>> = (0..FRAMES).map(|i| rgba(Status::Viewing, i, INK)).collect();
        for picture in [&off, &waiting].into_iter().chain(viewing.iter()) {
            assert_eq!(picture.len(), (SIZE * SIZE * 4) as usize);
            assert!(ink(picture) > 0, "a picture is empty");
        }
        assert_ne!(waiting, off, "waiting should add the arrow");
        assert!(ink(&waiting) > ink(&off));
        for (i, frame) in viewing.iter().enumerate() {
            assert_ne!(*frame, off, "viewing frame {i} should have the arrow");
        }
        // The first frame is the rest position (same as waiting); the middle of the bob is moved.
        assert_eq!(viewing[0], waiting);
        assert_ne!(viewing[(FRAMES / 4) as usize], waiting, "the arrow should move while viewing");
    }

    #[test]
    fn png_is_a_png() {
        let file = png(Status::Waiting, 0, INK);
        assert_eq!(&file[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn reads_status_names() {
        assert_eq!(Status::parse("off"), Some(Status::Off));
        assert_eq!(Status::parse("viewing"), Some(Status::Viewing));
        assert_eq!(Status::parse("other"), None);
    }

    /// Writes the pictures to PNG for a look by eye: `TRAY_PNG_DIR=/some/dir cargo test tray`.
    #[test]
    fn writes_pngs_when_asked() {
        let Ok(dir) = std::env::var("TRAY_PNG_DIR") else {
            return;
        };
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(format!("{dir}/off.png"), png(Status::Off, 0, INK)).unwrap();
        std::fs::write(format!("{dir}/waiting.png"), png(Status::Waiting, 0, INK)).unwrap();
        for i in 0..FRAMES {
            std::fs::write(format!("{dir}/viewing-{i:02}.png"), png(Status::Viewing, i, INK)).unwrap();
        }
    }
}
