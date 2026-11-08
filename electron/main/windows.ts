// The windows: the tray panel (frameless, OS blur, closes when focus leaves), Settings, the Remote window (every
// computer and one computer's screens) and the update question (shared decision 2026-11-07, Remote 1B 2B).
import { app, BrowserWindow, nativeTheme, screen, type Tray, type WebContents } from "electron";
import { join } from "node:path";
import type { SettingsTab } from "../preload/api";
import { t } from "./i18n";

export const PANEL_WIDTH = 300;
/** Space between the menu bar (or taskbar) and the panel. */
const GAP = 4;
const UPDATE_WIDTH = 400;
/** Buttons and keys in the update window do nothing this long after it appears. */
const UPDATE_GUARD_MS = 1000;
/** Debug runs only: `REMOTE_SOLID=1` turns the blur off, because a page capture shows a see-through window as white. */
const SOLID = !app.isPackaged && process.env.REMOTE_SOLID === "1";
/** Whether the OS blurs what is behind a window; the page draws a solid background when it does not. */
export const TRANSLUCENT = !SOLID && (process.platform === "darwin" || process.platform === "win32");

/** The design system's window background (--rw-window-bg), so a window shows no other colour before its page paints. */
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff");

function load(window: BrowserWindow, page: "viewer" | "panel" | "settings" | "update", query = ""): void {
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query ? `?${query}` : ""}#${page}`);
  else void window.loadFile(join(__dirname, "../renderer/index.html"), { hash: page, search: query });
}

const preload = join(__dirname, "../preload/index.js");

/** macOS gets the menu material Split's menu has, Windows gets Acrylic, Linux has no blur and stays solid. */
function blur(): Electron.BrowserWindowConstructorOptions {
  if (SOLID) return { backgroundColor: nativeTheme.shouldUseDarkColors ? "#2a2a2a" : "#ececec" };
  if (process.platform === "darwin") return { vibrancy: "menu", visualEffectState: "active", backgroundColor: "#00000000" };
  if (process.platform === "win32") return { backgroundMaterial: "acrylic", backgroundColor: "#00000000" };
  return { backgroundColor: nativeTheme.shouldUseDarkColors ? "#2a2a2a" : "#ececec" };
}

export function createPanel(): BrowserWindow {
  const panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 360,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    title: "Remote",
    ...blur(),
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  });
  // Why: a menu shows over full-screen apps and on every Space, so the panel does too.
  panel.setAlwaysOnTop(true, "pop-up-menu");
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  load(panel, "panel");
  return panel;
}

/** Puts the panel just under the tray icon (above it on Windows), kept inside the screen the icon is on. */
export function placeUnderTray(panel: BrowserWindow, tray: Tray | null): void {
  const [width, height] = panel.getSize();
  const icon = tray && !tray.isDestroyed() ? tray.getBounds() : null;
  // Why: Linux trays do not report where the icon is, so the panel goes to the top-right corner there.
  const anchor = icon && icon.width > 0 ? icon : null;
  const display = anchor ? screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }) : screen.getPrimaryDisplay();
  const area = display.workArea;
  let x: number;
  let y: number;
  if (anchor) {
    x = Math.round(anchor.x + anchor.width / 2 - width / 2);
    y = process.platform === "win32" ? anchor.y - height - GAP : anchor.y + anchor.height + GAP;
  } else {
    x = area.x + area.width - width - GAP;
    y = area.y + GAP;
  }
  x = Math.min(Math.max(x, area.x + GAP), area.x + area.width - width - GAP);
  y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  panel.setPosition(x, y, false);
}

const SETTINGS_WIDTH = 656;
const SETTINGS_HEIGHT = 700;

let settings: BrowserWindow | null = null;

/** Opens Settings on `tab` (the first tab when none is named), or brings the open window forward on it. */
export function showSettings(tab?: SettingsTab): void {
  if (settings && !settings.isDestroyed()) {
    if (tab) settings.webContents.send("remote:settingsTab", tab);
    settings.show();
    settings.focus();
    // Why: Remote has no Dock icon while its window is closed, so without this Settings can stay behind the app in front.
    app.focus({ steal: true });
    return;
  }
  settings = new BrowserWindow({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    minWidth: SETTINGS_WIDTH,
    minHeight: 420,
    show: false,
    maximizable: false,
    fullscreenable: false,
    title: t("settings.title"),
    // Why: like Split's Settings, macOS keeps only the window buttons and the page draws the title centred above the tabs.
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 12, y: 10 } } : {}),
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  });
  settings.setMenu(null);
  settings.on("page-title-updated", (event) => event.preventDefault());
  settings.once("ready-to-show", () => {
    settings?.center();
    settings?.show();
    settings?.focus();
    app.focus({ steal: true });
  });
  settings.on("closed", () => {
    settings = null;
  });
  load(settings, "settings", tab ? `tab=${tab}` : "");
}

const VIEWER_WIDTH = 960;
const VIEWER_HEIGHT = 680;

let viewer: BrowserWindow | null = null;
let quitting = false;
let shownOnce = false;

/** Lets the viewer window really close when Remote quits; until then closing only hides it. */
export function allowClose(): void {
  quitting = true;
}

/** Makes the Remote window without showing it. It holds the WebRTC connections (src/peer.ts), so it is made at launch
 *  and closing it only hides it: other devices keep seeing this computer while nobody has the window open. The page is
 *  told when it is shown or hidden, so it stops its own pictures and turns Send Clicks off while hidden. */
export function prepareViewer(onHide: () => void): BrowserWindow {
  if (viewer && !viewer.isDestroyed()) return viewer;
  viewer = new BrowserWindow({
    width: VIEWER_WIDTH,
    height: VIEWER_HEIGHT,
    minWidth: 520,
    minHeight: 400,
    useContentSize: true,
    show: false,
    title: "Remote",
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    // Why: a hidden page is slowed down by default, which would stall the video other devices are watching.
    webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  viewer.setMenu(null);
  const window = viewer;
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  window.on("hide", () => {
    onHide();
    window.webContents.send("remote:viewerVisible", false);
  });
  window.on("show", () => window.webContents.send("remote:viewerVisible", true));
  window.on("closed", () => {
    viewer = null;
  });
  load(window, "viewer");
  return window;
}

/** The page holding the WebRTC connections, or null before it is made or after Remote quit. */
export function viewerContents(): WebContents | null {
  return viewer && !viewer.isDestroyed() ? viewer.webContents : null;
}

/** Shows the Remote window and brings it to the front. */
export function showViewer(onHide: () => void): BrowserWindow {
  const window = prepareViewer(onHide);
  const first = !window.isVisible() && !shownOnce;
  shownOnce = true;
  if (first) window.center();
  window.show();
  if (window.isMinimized()) window.restore();
  window.focus();
  return window;
}

/** What the update window shows: the new version (as people see it), its "What's new" lines (null hides the box) and,
 *  while it is still being downloaded, how far along it is (0–100). */
export type UpdateOffer = { version: string; notes: string[] | null; downloading: boolean; percent: number };
export type UpdateAnswer = "install" | "later";

/** An open update window: its answer once a button is pressed (closing it is Later), and a way to change its state. */
export type UpdatePrompt = { answer: Promise<UpdateAnswer>; set: (change: Partial<UpdateOffer>) => void; close: () => void };

let update: { window: BrowserWindow; offer: UpdateOffer; answer: (answer: UpdateAnswer) => void } | null = null;

/** Asks whether to install, in a small window drawn like the menu: title, one line, "What's new", a progress bar while
 *  downloading, [Later] [Install Now]. Why a window and not a message box: the native box can hold neither a list that
 *  scrolls nor a progress bar. Closing it counts as Later.
 *  `focus` is for the menu's "Check for Updates…", where the person is waiting for it. The daily check shows the
 *  window without taking focus, so a Return typed into another app never lands on Install Now. */
export function askUpdate(offer: UpdateOffer, focus: boolean): UpdatePrompt {
  if (update && !update.window.isDestroyed()) update.window.close();
  let resolve!: (answer: UpdateAnswer) => void;
  const answerPromise = new Promise<UpdateAnswer>((done) => {
    resolve = done;
  });
  const window = new BrowserWindow({
    width: UPDATE_WIDTH,
    height: 200,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: true,
    roundedCorners: true,
    alwaysOnTop: true,
    title: "Remote",
    backgroundColor: windowBackground(),
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  });
  const current = { window, offer: { ...offer }, answer: (_: UpdateAnswer) => {} };
  let answered = false;
  let shownAt = Number.POSITIVE_INFINITY;
  current.answer = (value: UpdateAnswer) => {
    // Why: a Return or click meant for something else must not answer a window that just appeared (a test window
    // was answered Install Now this way while someone was typing). Closing the window is still Later at any time.
    if (Date.now() - shownAt < UPDATE_GUARD_MS) return;
    // Why: Install Now cannot be chosen before the download is done; the button is off then, this guards Return too.
    if (answered || (value === "install" && current.offer.downloading)) return;
    answered = true;
    resolve(value);
    // Why: after Install Now the window stays up showing "Installing…" until the app quits.
    if (value === "later" && !window.isDestroyed()) window.close();
  };
  update = current;
  window.on("page-title-updated", (event) => event.preventDefault());
  window.once("ready-to-show", () => {
    window.center();
    shownAt = Date.now();
    if (!focus) {
      window.showInactive();
      return;
    }
    app.focus({ steal: true });
    window.show();
    window.focus();
  });
  window.on("closed", () => {
    if (update === current) update = null;
    // Why: closing is Later, also within the first second and while still downloading.
    if (!answered) {
      answered = true;
      resolve("later");
    }
  });
  load(window, "update");
  return {
    answer: answerPromise,
    set: (change) => {
      // Why: the buttons appear only when the download is done, so the one-second guard starts again then.
      if (current.offer.downloading && change.downloading === false) shownAt = Date.now();
      current.offer = { ...current.offer, ...change };
      if (!window.isDestroyed()) window.webContents.send("remote:updateOffer", current.offer);
    },
    close: () => {
      if (!window.isDestroyed()) window.close();
    },
  };
}

/** The offer for the update page, so the page can draw it. */
export function updateOffer(): UpdateOffer | null {
  return update?.offer ?? null;
}

/** The button the update page's reader pressed. */
export function answerUpdate(value: UpdateAnswer): void {
  update?.answer(value);
}
