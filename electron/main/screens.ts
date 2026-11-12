// This computer's displays, one still picture of a display, and input posted into it, the same calls on every system.
//
// macOS asks the native module for all three (ScreenCaptureKit and CGEvent, in display points). Windows and Linux take
// the display list from Electron and the picture from Chromium's own capture, the same capture the live video already
// uses (peer.ts), so only posting input needs native code there. The native side wants screen pixels on those
// systems, so the fraction of the display a viewer sends becomes a point here, where Electron knows each display's
// place and scale.
import type { Display, Input } from "../preload/api";
import { desktopCapturer, screen } from "electron";
import { native } from "./native";

const MAC = process.platform === "darwin";

/** As capture.rs: the longest side of a still picture, so a 4K display is not sent at full size five times a second. */
const MAX_SIDE = 1920;
const JPEG_QUALITY = 60;

/** Every display, main display first, then left to right (as on macOS). */
export function displays(): Display[] {
  if (MAC) return JSON.parse(native.displays()) as Display[];
  const main = screen.getPrimaryDisplay().id;
  return screen
    .getAllDisplays()
    .map((d) => ({
      id: d.id,
      name: d.label,
      main: d.id === main,
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      pixelWidth: Math.round(d.bounds.width * d.scaleFactor),
      pixelHeight: Math.round(d.bounds.height * d.scaleFactor),
    }))
    .sort((a, b) => Number(b.main) - Number(a.main) || a.x - b.x || a.y - b.y);
}

/** One JPEG picture of a display. Rejects with `display`, `permission` or a message, like the native capture. */
export async function capture(id: number): Promise<Buffer> {
  if (MAC) return native.capture(id);
  const display = screen.getAllDisplays().find((d) => d.id === id);
  if (!display) throw new Error("display");
  const scale = Math.min(MAX_SIDE / Math.max(display.size.width, display.size.height), 1);
  const thumbnailSize = { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) };
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
  // Why the fallback: with one display some Linux desktops leave display_id empty.
  const source = sources.find((s) => s.display_id === String(id)) ?? (sources.length === 1 ? sources[0] : undefined);
  if (!source) throw new Error("display");
  if (source.thumbnail.isEmpty()) throw new Error("permission");
  return source.thumbnail.toJPEG(JPEG_QUALITY);
}

/** Posts one input. Returns the point a move or click went to as `[x, y]` (display points on macOS, Electron's screen
 *  points elsewhere, the same space the viewer window's own position uses), or `[]` for keys and text. */
export function sendInput(input: Input): number[] {
  const json = JSON.stringify(input);
  if (MAC) return native.sendInput(json);
  if (input.kind === "key" || input.kind === "text") return native.sendInputAt(json, 0, 0);
  const display = screen.getAllDisplays().find((d) => d.id === input.display);
  if (!display) throw new Error("display");
  const at = pointOn(display.bounds, input.x, input.y);
  // Why dipToScreenPoint: Windows places displays of different scale in real pixels, which only Electron can map to.
  const pixel = process.platform === "win32" ? screen.dipToScreenPoint(at) : scaled(at, display.scaleFactor);
  native.sendInputAt(json, pixel.x, pixel.y);
  return [at.x, at.y];
}

/** As to_global in input.rs: fractions outside 0..1 go to the nearest edge, and the far edge stays one point inside so
 *  a click never lands on the display next to it. */
export function pointOn(bounds: Electron.Rectangle, x: number, y: number): Electron.Point {
  const fx = Number.isFinite(x) ? Math.min(Math.max(x, 0), 1) : 0;
  const fy = Number.isFinite(y) ? Math.min(Math.max(y, 0), 1) : 0;
  return {
    x: Math.max(bounds.x, Math.min(bounds.x + fx * bounds.width, bounds.x + bounds.width - 1)),
    y: Math.max(bounds.y, Math.min(bounds.y + fy * bounds.height, bounds.y + bounds.height - 1)),
  };
}

/** Linux X11: Electron's points are the X server's pixels divided by the one scale the desktop uses. */
function scaled(at: Electron.Point, scale: number): Electron.Point {
  return { x: Math.round(at.x * scale), y: Math.round(at.y * scale) };
}
