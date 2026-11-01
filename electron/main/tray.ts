// The menu-bar / tray icon: the shared RUNNERS frame with Remote's arrow, drawn by the native module.
// Off shows the frame only, waiting adds the arrow, and while another computer looks the arrow bobs.
import { nativeImage, Tray } from "electron";
import type { State } from "../preload/api";
import { native } from "./native";

// Why: macOS uses the picture as a template (only its shape counts) and tints it for a dark or light menu bar.
// Windows and Linux show the colour as drawn; a light grey suits the usual dark taskbar.
const COLOR: [number, number, number] = process.platform === "darwin" ? [0, 0, 0] : [0xf2, 0xf2, 0xf2];

const [FRAMES, FRAME_MS] = native.trayFrames();
const pictures = new Map<string, Electron.NativeImage>();

function picture(state: State, frame: number): Electron.NativeImage {
  const key = `${state}-${state === "viewing" ? frame : 0}`;
  let image = pictures.get(key);
  if (!image) {
    image = nativeImage.createFromBuffer(native.trayPng(state, frame, ...COLOR), { scaleFactor: 2 });
    if (process.platform === "darwin") image.setTemplateImage(true);
    pictures.set(key, image);
  }
  return image;
}

let shown: State | null = null;
let timer: NodeJS.Timeout | null = null;

export function createTray(state: State): Tray {
  const tray = new Tray(picture(state, 0));
  tray.setToolTip("Remote");
  shown = state;
  return tray;
}

/** Puts the picture for `state` on the tray; does nothing while it stays the same. */
export function showState(tray: Tray, state: State): void {
  if (state === shown) return;
  shown = state;
  if (timer) clearInterval(timer);
  timer = null;
  if (tray.isDestroyed()) return;
  tray.setImage(picture(state, 0));
  if (state !== "viewing") return;
  let frame = 0;
  timer = setInterval(() => {
    frame = (frame + 1) % FRAMES;
    if (!tray.isDestroyed()) tray.setImage(picture("viewing", frame));
  }, FRAME_MS);
}
