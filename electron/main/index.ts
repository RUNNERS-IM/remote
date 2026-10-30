// Remote's main process: a tray app that shows whether this computer can be seen (off / waiting / being viewed),
// a panel under the tray with the permissions and the shared menu lines, and a viewer window that shows this
// computer's own screens and can send test clicks into them.
import { app, BrowserWindow, ipcMain, nativeTheme, shell, systemPreferences, type Tray } from "electron";
import type { Input, PermissionKind, PressAt } from "../preload/api";
import * as input from "./input";
import * as login from "./login";
import { buildMenu, forgetIcons, type Command, type MenuState } from "./menu";
import { native } from "./native";
import { readSettings, writeSettings } from "./settings";
import * as status from "./status";
import { createTray, showState } from "./tray";
import { checkNow, displayVersion, startUpdates } from "./updates";
import { allowClose, createPanel, placeUnderTray, showAbout, showViewer, TRANSLUCENT } from "./windows";

const ISSUES_URL = "https://github.com/RUNNERS-IM/remote/issues";
const STATUS_EVERY_MS = 2000;
/** System Settings pages for each permission, opened when macOS no longer shows its own prompt. */
const SETTINGS_PAGE: Record<PermissionKind, string> = {
  screenRecording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
};
// Why: the tray click that opens the panel can also send it a focus-lost event right away, so blur is ignored this long after opening.
const BLUR_GRACE_MS = 400;
// Why: clicking the tray while the panel is open first takes focus from the panel (which hides it); a click that
// lands this soon after is the same click and must not open it again.
const REOPEN_GUARD_MS = 300;

/** Debug runs only: everything below that reads REMOTE_* is ignored in a packaged app. */
const DEV = !app.isPackaged;

let tray: Tray | null = null;
let panel: BrowserWindow | null = null;
let shownAt = 0;
let hiddenByBlurAt = 0;

function hidePanel(): void {
  panel?.hide();
  panel?.setFocusable(true);
}

/** Shows the panel without taking focus, under the tray (debug captures only). */
function showWithoutFocus(): void {
  if (!panel) return;
  panel.setFocusable(false);
  placeUnderTray(panel, tray);
  panel.showInactive();
}

function togglePanel(): void {
  if (!panel) return;
  if (panel.isVisible()) {
    hidePanel();
    return;
  }
  if (Date.now() - hiddenByBlurAt < REOPEN_GUARD_MS) return;
  panel.setFocusable(true);
  placeUnderTray(panel, tray);
  shownAt = Date.now();
  panel.show();
  panel.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
}

function openViewer(): void {
  if (process.platform === "darwin") app.focus({ steal: true });
  // Why: a hidden window must never keep clicking, so the switch turns off with it.
  showViewer(() => input.setSendClicks(false));
}

function menuState(): MenuState {
  return { openAtLogin: login.isOn(), autoUpdate: readSettings().autoUpdate };
}

function run(command: Command): void {
  switch (command) {
    case "open":
      hidePanel();
      openViewer();
      break;
    case "login":
      login.toggle();
      break;
    case "autoUpdate":
      writeSettings({ autoUpdate: !readSettings().autoUpdate });
      break;
    case "about":
      hidePanel();
      showAbout();
      break;
    case "updates":
      hidePanel();
      checkNow();
      break;
    case "help":
      hidePanel();
      void shell.openExternal(ISSUES_URL);
      break;
    case "quit":
      app.quit();
      break;
  }
  refreshLinuxMenu();
}

/** Linux trays only open a menu set beforehand (no click events), so it is rebuilt when its lines change. */
let linuxMenuText = "";
function refreshLinuxMenu(): void {
  if (process.platform !== "linux" || !tray) return;
  const now = status.current();
  const text = JSON.stringify([now.state, now.reason, menuState(), nativeTheme.shouldUseDarkColors]);
  if (text === linuxMenuText) return;
  linuxMenuText = text;
  tray.setContextMenu(buildMenu(now, menuState(), run));
}

function statusLoop(): void {
  const tick = () => {
    if (tray) showState(tray, status.current().state);
    refreshLinuxMenu();
  };
  tick();
  setInterval(tick, STATUS_EVERY_MS);
}

function accentColor(): string | null {
  if (process.platform !== "darwin" && process.platform !== "win32") return null;
  const color = systemPreferences.getAccentColor();
  return color ? `#${color.slice(0, 6)}` : null;
}

function requestPermission(kind: PermissionKind): void {
  if (!status.SUPPORTED) return;
  const granted = kind === "screenRecording" ? native.requestScreenRecording() : native.requestAccessibility();
  // Why: macOS shows each prompt only once per app; after that the switch is only in System Settings.
  if (!granted) void shell.openExternal(SETTINGS_PAGE[kind]);
}

function registerIpc(): void {
  ipcMain.handle("remote:status", () => status.current());
  ipcMain.handle("remote:displays", () => (status.SUPPORTED ? JSON.parse(native.displays()) : []));
  ipcMain.handle("remote:capture", (_event, display: number) => {
    if (!status.SUPPORTED) throw new Error("unsupported");
    return native.capture(Number(display));
  });
  ipcMain.handle("remote:requestPermission", (_event, kind: PermissionKind) => {
    if (kind === "screenRecording" || kind === "accessibility") requestPermission(kind);
  });
  ipcMain.handle("remote:setSendClicks", (_event, on: boolean) => input.setSendClicks(Boolean(on)));
  ipcMain.handle("remote:sendInput", (_event, what: Input, pressAt: PressAt | null) => input.send(what, pressAt));
  ipcMain.handle("remote:translucent", () => TRANSLUCENT);
  ipcMain.handle("remote:version", () => displayVersion());
  ipcMain.handle("remote:accentColor", () => accentColor());
  ipcMain.handle("remote:menuState", () => menuState());
  ipcMain.handle("remote:command", (_event, command: Command) => {
    run(command);
    return menuState();
  });
  ipcMain.handle("remote:openExternal", (_event, url: string) => {
    // Why: only https links are opened, so a page can never launch anything else.
    if (/^https:\/\//.test(String(url))) void shell.openExternal(String(url));
  });
  ipcMain.on("remote:fitHeight", (event, height: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !Number.isFinite(height) || height <= 0) return;
    const [width] = window.getContentSize();
    window.setContentSize(width, Math.ceil(height));
    // Why: on Windows the panel hangs above the taskbar, so a taller panel must move up to stay attached.
    if (window === panel && process.platform === "win32" && panel.isVisible()) placeUnderTray(panel, tray);
  });
  ipcMain.on("remote:closeWindow", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
}

/** Debug runs only: `REMOTE_OPEN=panel|viewer|about` opens that window at launch, so it can be captured without
 *  clicking the tray, and `REMOTE_THEME=dark|light` forces the look. The panel opens without focus, so it stays up. */
function debugHooks(): void {
  const theme = process.env.REMOTE_THEME;
  if (theme === "dark" || theme === "light") nativeTheme.themeSource = theme;
  const which = process.env.REMOTE_OPEN;
  // Why: the tray icon needs a moment before it reports where it sits.
  if (which === "about") setTimeout(showAbout, 1500);
  if (which === "panel") setTimeout(showWithoutFocus, 1500);
  if (which === "viewer") setTimeout(openViewer, 1500);
}

function start(): void {
  // Why: Remote lives in the tray only, so it should not take a Dock slot on macOS.
  app.dock?.hide();
  registerIpc();
  login.applyDefault();
  panel = createPanel();
  panel.on("blur", () => {
    if (Date.now() - shownAt < BLUR_GRACE_MS) return;
    hiddenByBlurAt = Date.now();
    hidePanel();
  });
  tray = createTray(status.current().state);
  if (process.platform === "linux") refreshLinuxMenu();
  else {
    tray.on("click", togglePanel);
    tray.on("right-click", () => tray?.popUpContextMenu(buildMenu(status.current(), menuState(), run)));
  }
  nativeTheme.on("updated", () => {
    forgetIcons();
    refreshLinuxMenu();
  });
  statusLoop();
  startUpdates();
  if (DEV) debugHooks();
}

// Why: a second copy would add a second tray icon; opening it again opens the viewer of the running one instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", openViewer);
  app.on("before-quit", allowClose);
  // Why: closing a window must not quit a tray app.
  app.on("window-all-closed", () => undefined);
  void app.whenReady().then(start);
}
