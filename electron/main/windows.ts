// The three windows: the tray panel (frameless, OS blur, closes when focus leaves), the viewer window that shows
// this computer's screen, and the About window.
import { BrowserWindow, nativeTheme, screen, type Tray } from "electron";
import { join } from "node:path";
import { t } from "./i18n";

export const PANEL_WIDTH = 300;
const ABOUT_WIDTH = 520;
/** First height only; the page then fits the window to its content. */
const ABOUT_HEIGHT = 560;
/** Space between the menu bar (or taskbar) and the panel. */
const GAP = 4;

/** Whether the OS blurs what is behind the panel; the page draws a solid background when it does not. */
export const TRANSLUCENT = process.platform === "darwin" || process.platform === "win32";

function load(window: BrowserWindow, page: "panel" | "viewer" | "about"): void {
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${page}`);
  else void window.loadFile(join(__dirname, "../renderer/index.html"), { hash: page });
}

const preload = join(__dirname, "../preload/index.js");

/** macOS gets the menu material Split's menu has, Windows gets Acrylic, Linux has no blur and stays solid. */
function blur(): Electron.BrowserWindowConstructorOptions {
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
    webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false },
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

let about: BrowserWindow | null = null;

/** Opens the About window, or brings the open one to the front. An ordinary window with a title bar. */
export function showAbout(): void {
  if (about && !about.isDestroyed()) {
    about.show();
    about.focus();
    return;
  }
  about = new BrowserWindow({
    width: ABOUT_WIDTH,
    height: ABOUT_HEIGHT,
    useContentSize: true,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: t("about.title"),
    ...(process.platform === "darwin"
      ? { vibrancy: "under-window" as const, visualEffectState: "active" as const, backgroundColor: "#00000000" }
      : process.platform === "win32"
        ? { backgroundMaterial: "acrylic" as const, backgroundColor: "#00000000" }
        : {}),
    autoHideMenuBar: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  });
  about.setMenu(null);
  // Why: the page's <title> is "Remote"; the window keeps its own localized "About Remote".
  about.on("page-title-updated", (event) => event.preventDefault());
  about.once("ready-to-show", () => {
    about?.center();
    about?.show();
    // Why: Remote has no Dock icon, so without focus the window can open behind the app in front.
    about?.focus();
  });
  about.on("closed", () => {
    about = null;
  });
  load(about, "about");
}

const VIEWER_WIDTH = 960;
const VIEWER_HEIGHT = 680;

let viewer: BrowserWindow | null = null;
let quitting = false;

/** Lets the viewer window really close when Remote quits; until then closing only hides it. */
export function allowClose(): void {
  quitting = true;
}

/** Opens the viewer window, or brings it to the front. Closing it only hides it, and the page is told either way so
 *  it stops taking pictures and turns Send Clicks off while hidden. */
export function showViewer(onHide: () => void): BrowserWindow {
  if (!viewer || viewer.isDestroyed()) {
    viewer = new BrowserWindow({
      width: VIEWER_WIDTH,
      height: VIEWER_HEIGHT,
      minWidth: 520,
      minHeight: 400,
      useContentSize: true,
      show: false,
      title: "Remote",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e20" : "#f6f6f6",
      autoHideMenuBar: true,
      webPreferences: { preload, sandbox: true, contextIsolation: true },
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
    window.once("ready-to-show", () => {
      window.center();
      window.show();
      window.focus();
    });
    load(window, "viewer");
    return window;
  }
  viewer.show();
  if (viewer.isMinimized()) viewer.restore();
  viewer.focus();
  return viewer;
}
