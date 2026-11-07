// The connection (2026-11-03 decision 「네 앱 컴퓨터판 · 휴대폰판 개발 방식」, Remote: WebRTC): computers and phones of
// the same RUNNERS account see and click each other.
//   - The relay (relay.ts) lists who is online and carries the WebRTC signals.
//   - The WebRTC connections live in the Remote window's page (src/peer.ts), which is made at launch and only hidden,
//     so this computer can be seen while nobody has the window open. Screens go there as video; questions (info,
//     a still picture, a click) go over a data channel.
//   - Whatever another device asks of this computer comes here (hostRequest), where the See This and Click and Type
//     switches and the permissions decide. The name in the log is the one the relay lists for that device.
//   - Claude's questions about other computers go the other way (peerInfo …): from here to the page, which asks over
//     its connection to that computer.
//
// Why seeing and clicking are separate switches: seeing is what a coworker asks for most ("look at this error"), and
// clicking is a bigger trust step, so it starts off. Disconnect turns seeing off, which also stops clicking.
import { app, clipboard, desktopCapturer, ipcMain, nativeImage, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import type { Allow, Computer, Input, Link, LogEntry, PeerInfo } from "../preload/api";
import * as account from "./account";
import { native } from "./native";
import * as relay from "./relay";
import { readSettings, writeSettings } from "./settings";
import * as status from "./status";

const DEV = !app.isPackaged;
const LOG_KEEP = 200;
const ASK_TIMEOUT_MS = 15_000;
/** Narrowest and widest still picture a caller may ask for with `width`; the grid asks for small ones. */
const MIN_WIDTH = 160;
const MAX_WIDTH = 1280;
/** Debug runs only: REMOTE_FAKE_SCREEN=1 sends a drawn test picture instead of the screen, so two copies on one Mac can
 *  be tried without the Screen Recording permission and without anyone's screen leaving the window. */
const FAKE_SCREEN = DEV && process.env.REMOTE_FAKE_SCREEN === "1";
/** Debug runs only: `REMOTE_FAKE_INPUT=1` prints each input from another computer instead of posting it, and keeps
 *  copied text in memory instead of this computer's clipboard, so two test copies on one Mac never click or paste in it. */
export const FAKE_INPUT = DEV && process.env.REMOTE_FAKE_INPUT === "1";
let fakeClipboard = "";

const log: LogEntry[] = [];
let page: () => WebContents | null = () => null;

function note(peer: string, what: LogEntry["what"]): void {
  log.unshift({ at: Date.now(), peer, what });
  log.length = Math.min(log.length, LOG_KEEP);
}

// ---- What other devices ask of this computer ----

function info(): PeerInfo {
  const now = status.current();
  const settings = readSettings();
  const shown = settings.allowViewing && (now.supported || FAKE_SCREEN);
  return {
    computer: now.computer,
    // Why: with seeing off, even the monitor names stay private.
    displays: shown ? JSON.parse(native.displays()) : [],
    viewing: settings.allowViewing && (now.reason === null || FAKE_SCREEN),
    control: settings.allowViewing && now.permissions.accessibility,
    reason: FAKE_SCREEN ? null : now.reason,
  };
}

/** The still picture made narrower when the caller asks for a width (the grid shows each screen small, and a full
 *  picture is about 300 KB). Without one, or when it is not narrower, the picture is sent as taken. */
function shrink(jpeg: Buffer, asked: unknown): Buffer {
  const width = Math.round(Number(asked));
  if (asked === undefined || asked === null || !Number.isFinite(width)) return jpeg;
  const image = nativeImage.createFromBuffer(jpeg);
  const target = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
  if (image.isEmpty() || image.getSize().width <= target) return jpeg;
  return image.resize({ width: target, quality: "good" }).toJPEG(70);
}

/** The debug test picture: a colour that changes every second, so a still picture visibly moves, under speckles that
 *  make the JPEG large enough (over 100 KB) to be sent in parts like a real screen. */
function fakePicture(): Buffer {
  const width = 1280;
  const height = 800;
  const pixels = Buffer.alloc(width * height * 4);
  const shade = (Math.floor(Date.now() / 1000) * 40) % 256;
  for (let i = 0; i < pixels.length; i += 4) {
    const speck = (i * 2654435761) >>> 24;
    pixels[i] = (shade + speck) & 255;
    pixels[i + 1] = 120;
    pixels[i + 2] = (255 - shade + speck) & 255;
    pixels[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, { width, height }).toJPEG(70);
}

function logKind(input: Input): LogEntry["what"] | null {
  if (input.kind === "click") return "click";
  if (input.kind === "press") return input.down ? "click" : null;
  if (input.kind === "key") return "key";
  if (input.kind === "text") return "text";
  return null;
}

/** The capture source Chromium needs for a display (macOS gives both the same display id). */
async function sourceFor(display: number): Promise<string> {
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
  const source = sources.find((s) => s.display_id === String(display)) ?? (display === 0 ? sources[0] : undefined);
  if (!source) throw new Error("display");
  return source.id;
}

/** One question from another device. Throws a short code the asking side turns into text: forbidden, off, control,
 *  accessibility, unsupported, permission, display, or a message. */
async function hostRequest(peerId: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  const peer = relay.device(peerId);
  if (!peer) throw new Error("forbidden");
  const settings = readSettings();
  const now = status.current();

  if (method === "info") return info();
  if (!settings.allowViewing) {
    if (method === "frame" || method === "watch" || method === "input") note(peer.name, "refused");
    throw new Error("off");
  }
  if (method === "front") return status.SUPPORTED ? JSON.parse(native.frontApp()) : null;
  if (method === "viewing") {
    if (status.remoteFrameSent(peer.name)) note(peer.name, "view");
    return true;
  }
  if (method === "frame") {
    if (FAKE_SCREEN) return shrink(fakePicture(), params.width);
    if (!status.SUPPORTED) throw new Error("unsupported");
    const jpeg = await native.capture(Number(params.display));
    if (status.remoteFrameSent(peer.name)) note(peer.name, "view");
    return shrink(jpeg, params.width);
  }
  if (method === "watch") {
    if (FAKE_SCREEN) return { fake: true };
    if (!status.SUPPORTED) throw new Error("unsupported");
    if (!now.permissions.screenRecording) throw new Error("permission");
    if (status.remoteFrameSent(peer.name)) note(peer.name, "view");
    return { sourceId: await sourceFor(Number(params.display)) };
  }
  if (method === "input") {
    if (!settings.allowViewing) {
      note(peer.name, "refused");
      throw new Error("control");
    }
    const input = params.input as Input;
    if (FAKE_INPUT) console.log("input:", JSON.stringify(input));
    else {
      if (!status.SUPPORTED) throw new Error("unsupported");
      if (!now.permissions.accessibility) throw new Error("accessibility");
      native.sendInput(JSON.stringify(input));
    }
    const kind = logKind(input);
    if (kind) note(peer.name, kind);
    return "sent";
  }
  // Copy and paste with the computer on screen: only while it lets others see it, like the keys that copy.
  if (method === "clipboardGet" || method === "clipboardSet") {
    if (!settings.allowViewing) {
      note(peer.name, "refused");
      throw new Error("control");
    }
    if (method === "clipboardSet") {
      const text = String(params.text ?? "");
      if (FAKE_INPUT) {
        fakeClipboard = text;
        console.log("clipboard set:", text);
      } else clipboard.writeText(text);
      note(peer.name, "paste");
      return "sent";
    }
    note(peer.name, "copy");
    return FAKE_INPUT ? fakeClipboard || "fake copied text" : clipboard.readText();
  }
  throw new Error(`unknown method ${method}`);
}

// ---- Asking other computers (for Claude), through the page ----

const waiting = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function askPage(host: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const target = page();
  if (!target) return Promise.reject(new Error("unreachable"));
  if (relay.device(host)?.role !== "host") return Promise.reject(new Error("unreachable"));
  const rid = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(rid);
      reject(new Error("unreachable"));
    }, ASK_TIMEOUT_MS);
    waiting.set(rid, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    target.send("remote:clientRequest", { rid, device: host, method, params });
  });
}

export async function peerInfo(host: string): Promise<PeerInfo> {
  return (await askPage(host, "info")) as PeerInfo;
}

export async function peerCapture(host: string, display: number, width?: number): Promise<Buffer> {
  const bytes = (await askPage(host, "frame", { display, width })) as Uint8Array;
  return Buffer.from(bytes);
}

export async function peerFront(host: string): Promise<{ bundleId: string; name: string } | null> {
  return (await askPage(host, "front")) as { bundleId: string; name: string } | null;
}

export async function peerInput(host: string, input: Input): Promise<void> {
  await askPage(host, "input", { input });
}

// ---- State for the window and the menu ----

/** Whether this computer is on the relay, so the Allow switches mean something. */
export function hasServer(): boolean {
  return relay.current().state === "running";
}

export async function current(): Promise<Link> {
  const now = relay.current();
  const settings = readSettings();
  const computers: Computer[] = now.devices
    .filter((d) => d.role === "host")
    .map((d) => ({ name: d.name, host: d.deviceId, online: true, os: "" }));
  return {
    state: now.state,
    error: now.error,
    account: account.email(),
    computers,
    allowViewing: settings.allowViewing,
    log: log.slice(0, 50),
  };
}

export function setAllow(what: Allow, on: boolean): void {
  writeSettings({ [what]: on });
  if (what === "allowViewing" && !on) {
    status.forgetViewers();
    // Why: turning seeing off must also end the video already going out, not only refuse new questions.
    page()?.send("remote:dropHosted");
  }
}

/** Disconnect: nobody sees or clicks this computer until seeing is turned on again. */
export function disconnect(): void {
  setAllow("allowViewing", false);
}

export async function signIn(mode: "login" | "signup", email: string, password: string, code?: string): Promise<Link> {
  await account.signIn(mode, email, password, code);
  relay.connect();
  return current();
}

export function sendCode(purpose: "signup" | "reset", email: string, locale: string): Promise<void> {
  return account.sendCode(purpose, email, locale);
}

export async function resetPassword(email: string, code: string, password: string): Promise<Link> {
  await account.resetPassword(email, code, password);
  relay.connect();
  return current();
}

export async function signOut(): Promise<Link> {
  page()?.send("remote:dropAll");
  await account.signOut();
  relay.connect();
  return current();
}

/** `contents` gives the page that holds the WebRTC connections (the Remote window, made hidden at launch). */
export function startConnection(contents: () => WebContents | null): void {
  page = contents;
  ipcMain.handle("remote:hostRequest", async (_event, peerId: string, method: string, params: Record<string, unknown>) =>
    hostRequest(String(peerId), String(method), params ?? {}),
  );
  ipcMain.on("remote:sendSignal", (_event, to: string, payload: Record<string, unknown>) => {
    // Why: only devices the relay listed for this account are signalled, and only an offer, answer or candidate.
    if (!relay.device(String(to))) return;
    relay.send({ type: "signal", to: String(to), sdp: payload?.sdp, candidate: payload?.candidate });
  });
  ipcMain.on("remote:clientReply", (_event, rid: string, ok: boolean, value: unknown) => {
    const pending = waiting.get(String(rid));
    if (!pending) return;
    waiting.delete(String(rid));
    if (ok) pending.resolve(value);
    else pending.reject(new Error(String(value)));
  });
  ipcMain.handle("remote:deviceId", () => account.deviceId());
  relay.start({
    signal: (signal) => page()?.send("remote:signal", signal),
    left: (deviceId) => page()?.send("remote:peerLeft", deviceId),
  });
}
