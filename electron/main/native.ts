// Loads Remote's one native module (native/, napi-rs): display capture, posted input, permission checks and the
// menu-bar picture. Why a path instead of a package: the build leaves one file per OS and CPU
// (remote-native.darwin-arm64.node …); a dev run reads it from native/, a packaged app from Resources/native/
// (electron-builder extraResources).
import { app } from "electron";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export interface Native {
  computerName(): string;
  /** JSON list of displays (src/types.ts). Main thread only, where AppKit gives the names. */
  displays(): string;
  /** One JPEG picture; rejects with a short code (`permission`, `display`, `timeout`, `unsupported`) or a message. */
  capture(display: number): Promise<Buffer>;
  /** JSON `{ screenRecording, accessibility }`. */
  permissions(): string;
  requestScreenRecording(): boolean;
  requestAccessibility(): boolean;
  /** Posts one input (JSON); returns the global point `[x, y]` a click or move went to, or `[]`. */
  sendInput(json: string): number[];
  trayPng(status: string, frame: number, r: number, g: number, b: number): Buffer;
  /** `[frames in one bob, milliseconds per frame]`. */
  trayFrames(): number[];
}

function load(): Native {
  const dir = app.isPackaged ? join(process.resourcesPath, "native") : join(app.getAppPath(), "native");
  const prefix = `remote-native.${process.platform}-${process.arch}`;
  const file = readdirSync(dir).find((name) => name.startsWith(prefix) && name.endsWith(".node"));
  if (!file) throw new Error(`no ${prefix}*.node in ${dir}; run pnpm native`);
  return createRequire(__filename)(join(dir, file)) as Native;
}

export const native = load();
