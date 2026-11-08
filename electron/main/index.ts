// Remote's main process: a menu bar app whose picture shows whether this computer can be seen (off / waiting / being
// viewed), a panel under it listing the other computers, the Remote window that shows every office computer and one
// computer's screens with clicks and typing, and Settings for everything about this Mac.
import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeTheme, shell, systemPreferences, type Tray } from "electron";
import { writeFileSync } from "node:fs";
import { uptime } from "node:os";
import type { Allow, Input, PermissionKind, PressAt, SettingsTab } from "../preload/api";
import { startClaude } from "./claude";
import * as input from "./input";
import * as link from "./link";
import * as login from "./login";
import { buildMenu, forgetIcons, type Command, type MenuState } from "./menu";
import { currentLocale, t } from "./i18n";
import { native } from "./native";
import { readSettings, writeSettings } from "./settings";
import * as status from "./status";
import { createTray, showState } from "./tray";
import { checkNow, displayVersion, startUpdates } from "./updates";
import { allowClose, answerUpdate, askUpdate, createPanel, placeUnderTray, prepareViewer, showSettings, showViewer, TRANSLUCENT, updateOffer, viewerContents } from "./windows";

const ISSUES_URL = "https://github.com/RUNNERS-IM/remote/issues";
const STATUS_EVERY_MS = 2000;
// Why: the tray click that opens the panel can also send it a focus-lost event right away, so blur is ignored this long after opening.
const BLUR_GRACE_MS = 200;
// Why: clicking the tray while the panel is open first takes focus from the panel (which hides it); a click that
// soon after is that same click and must not open it again.
const REOPEN_GUARD_MS = 300;
/** System Settings pages for each permission, opened when macOS no longer shows its own prompt. */
const SETTINGS_PAGE: Record<PermissionKind, string> = {
  screenRecording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
};
/** Debug runs only: everything below that reads REMOTE_* is ignored in a packaged app. */
const DEV = !app.isPackaged;
// Why: a debug run keeps its own data folder, so it runs next to the installed Remote (which holds the single-instance
// lock on the shared folder) and never signs it in or out.
if (DEV) app.setPath("userData", `${app.getPath("userData")}-dev`);

let tray: Tray | null = null;
let panel: BrowserWindow | null = null;
let shownAt = 0;
let hiddenByBlurAt = 0;

function hidePanel(): void {
  panel?.hide();
}

function togglePanel(): void {
  if (!panel) return;
  if (panel.isVisible()) {
    hidePanel();
    return;
  }
  if (Date.now() - hiddenByBlurAt < REOPEN_GUARD_MS) return;
  placeUnderTray(panel, tray);
  shownAt = Date.now();
  panel.show();
  panel.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
}

/** Opens the Remote window. While it is open Remote also shows in the Dock, so it can be found like any app's window;
 *  closed, Remote is back to the menu bar only (2026-11-02: menu bar, plus the Dock while the window is open). */
function viewerHidden(): void {
  // Why: a hidden window must never keep clicking, so the switch turns off with it.
  input.setSendClicks(false);
  app.dock?.hide();
}

function openViewer(): void {
  hidePanel();
  if (process.platform === "darwin") {
    void app.dock?.show();
    app.focus({ steal: true });
  }
  showViewer(viewerHidden);
}

/** Started by the computer at login rather than by a person (decision 「[REMOTE] 개발 - 원격 기능 넓히기」 1B): then the
 *  window stays closed and only the menu bar picture shows. Windows and Linux start it with `--hidden` (login.ts). */
function startedAtLogin(): boolean {
  if (process.argv.includes(login.HIDDEN_ARG)) return true;
  if (process.platform !== "darwin") return false;
  // Why the uptime too: an app registered as a login item through macOS 13's own list may not be told it was started
  // at login, and nobody opens Remote by hand in the first two minutes after the Mac starts.
  return app.getLoginItemSettings().wasOpenedAtLogin || uptime() < 120;
}

function openSettings(tab?: SettingsTab): void {
  hidePanel();
  showSettings(tab);
}

function menuState(): MenuState {
  const settings = readSettings();
  return {
    openAtLogin: login.isOn(),
    autoUpdate: settings.autoUpdate,
    linked: link.hasServer(),
    allowViewing: settings.allowViewing,
    trayIcon: settings.showTrayIcon,
    canHideIcon: process.platform === "darwin",
  };
}

function run(command: Command): void {
  switch (command) {
    case "open":
      openViewer();
      break;
    case "allowViewing":
      link.setAllow("allowViewing", !readSettings().allowViewing);
      break;
    case "disconnect":
      link.disconnect();
      break;
    case "login":
      login.toggle();
      break;
    case "autoUpdate":
      writeSettings({ autoUpdate: !readSettings().autoUpdate });
      break;
    case "settings":
      openSettings();
      break;
    case "trayIcon":
      writeSettings({ showTrayIcon: !readSettings().showTrayIcon });
      updateTray();
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

/** Makes or removes the menu bar picture to match the setting. */
function updateTray(): void {
  if (process.platform === "darwin" && !readSettings().showTrayIcon) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (tray) return;
  const icon = createTray(status.current().state);
  tray = icon;
  showState(icon, status.current().state);
  if (process.platform === "linux") {
    linuxMenuText = "";
    refreshLinuxMenu();
  } else {
    icon.on("click", togglePanel);
    icon.on("right-click", togglePanel);
  }
}

/** macOS only: the app menu, so ⌘, opens Settings from whichever Remote window is in front. Why a menu and not a key
 *  listener: while keys go to another computer the Remote window turns menu shortcuts off (remote:keysToPeer), so ⌘,
 *  reaches that computer then. The other menus are the ones Electron gives by default (copy and paste need them). */
function setAppMenu(): void {
  if (process.platform !== "darwin") return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { label: t("menu.settings"), accelerator: "CmdOrCtrl+,", click: () => openSettings() },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { label: t("menu.quit"), accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
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
  ipcMain.handle("remote:readClipboard", () => (link.FAKE_INPUT ? "fake local text" : clipboard.readText()));
  ipcMain.handle("remote:writeClipboard", (_event, text: unknown) => {
    if (link.FAKE_INPUT) console.log("local clipboard:", String(text));
    else clipboard.writeText(String(text));
  });
  ipcMain.on("remote:keysToPeer", (event, on: unknown) => event.sender.setIgnoreMenuShortcuts(Boolean(on)));
  ipcMain.handle("remote:translucent", () => TRANSLUCENT);
  ipcMain.on("remote:openComputer", (_event, host: unknown) => {
    openViewer();
    viewerContents()?.send("remote:openComputer", String(host));
  });
  ipcMain.on("remote:openSettings", (_event, tab: SettingsTab) => openSettings(tab));
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
  });
  ipcMain.on("remote:closeWindow", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("remote:link", () => link.current());
  ipcMain.handle("remote:signIn", (_event, mode: unknown, email: unknown, password: unknown, code: unknown) =>
    link.signIn(
      mode === "signup" ? "signup" : "login",
      String(email),
      String(password),
      typeof code === "string" ? code : undefined,
    ),
  );
  ipcMain.handle("remote:sendCode", (_event, purpose: unknown, email: unknown) =>
    link.sendCode(purpose === "reset" ? "reset" : "signup", String(email), app.getLocale()),
  );
  ipcMain.handle("remote:resetPassword", (_event, email: unknown, code: unknown, password: unknown) =>
    link.resetPassword(String(email), String(code), String(password)),
  );
  ipcMain.handle("remote:signOut", () => link.signOut());
  ipcMain.handle("remote:setAllow", (_event, what: Allow, on: boolean) => {
    if (what === "allowViewing") link.setAllow(what, Boolean(on));
    return link.current();
  });
  ipcMain.handle("remote:disconnect", () => {
    link.disconnect();
    return link.current();
  });
  ipcMain.handle("remote:updateOffer", () => updateOffer());
  ipcMain.on("remote:answerUpdate", (_event, answer: unknown) => answerUpdate(answer === "install" ? "install" : "later"));
}

/** Debug runs only: `REMOTE_OPEN=viewer|panel|settings[:tab]|update|update-progress` opens that window at launch, so it can be
 *  captured without clicking the tray (`update` / `update-progress` show the update question with made-up notes,
 *  downloaded or still downloading, and install nothing), and `REMOTE_THEME=dark|light` forces the look. */
function debugHooks(): void {
  const theme = process.env.REMOTE_THEME;
  if (theme === "dark" || theme === "light") nativeTheme.themeSource = theme;
  const which = process.env.REMOTE_OPEN;
  // Why: the tray icon needs a moment before it reports where it sits.
  if (which === "viewer") setTimeout(openViewer, 1500);
  // Why showInactive: a capture run must not take focus, and a panel that never had focus does not close on blur.
  if (which === "panel")
    setTimeout(() => {
      if (!panel) return;
      placeUnderTray(panel, tray);
      panel.showInactive();
    }, 1500);
  if (which?.startsWith("settings")) setTimeout(() => openSettings((which.split(":")[1] as SettingsTab | undefined) || undefined), 1500);
  // Why: `REMOTE_SHOT=<file.png>` saves the opened window as the app draws it, for the dark and light screenshots
  // asked for before a release, without giving the terminal the screen recording permission.
  // Why: `REMOTE_CLICK=<css selector>` presses that element in the opened window 3.5 s in, so pages reached by a click
  // (a computer's page, This Mac) can be captured too.
  const press = process.env.REMOTE_CLICK;
  if (press && which) {
    setTimeout(() => {
      const window = BrowserWindow.getAllWindows().find((w) => w.isVisible());
      void window?.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(press)})?.click()`);
    }, 3500);
  }
  const shot = process.env.REMOTE_SHOT;
  if (shot && which) {
    setTimeout(() => {
      const window = BrowserWindow.getAllWindows().find((w) => w.isVisible());
      void window
        ?.capturePage()
        .then((image) => writeFileSync(shot, image.toPNG()))
        .then(() => console.log("shot:", shot));
    }, 6000);
  }
  if (which === "update" || which === "update-progress") {
    const ko = currentLocale() === "ko";
    const notes = ko
      ? ["메뉴 막대 그림이 꺼짐 · 대기 중 · 보는 중을 보여 줍니다.", "업데이트를 받은 뒤 설치할지 묻고, 바뀐 점을 함께 보여 줍니다.", "20개 언어를 지원합니다.", "로그인할 때 이름과 아이콘이 보이게 열립니다.", "화면 보기 창의 간격을 다른 앱과 맞췄습니다.", "다섯 줄이 넘으면 이 칸 안에서 스크롤됩니다."]
      : ["The menu-bar picture shows off, waiting and being viewed.", "Updates download first, then Remote asks and shows what changed.", "20 languages.", "Opens at login with its name and icon.", "The viewer window uses the same spacing as the other apps.", "Past five lines this box scrolls."];
    // Why: `update-progress` shows the menu check's download state, held at a made-up 42%.
    const downloading = which === "update-progress";
    setTimeout(() => {
      const prompt = askUpdate({ version: "2.6.1102", notes, downloading, percent: downloading ? 42 : 100 }, false);
      void prompt.answer.then((answer) => console.log("update answer:", answer));
    }, 1500);
  }
}

function start(): void {
  // Why: Remote lives in the tray only, so it should not take a Dock slot on macOS.
  app.dock?.hide();
  registerIpc();
  login.applyDefault();
  setAppMenu();
  panel = createPanel();
  panel.on("blur", () => {
    if (Date.now() - shownAt < BLUR_GRACE_MS) return;
    hiddenByBlurAt = Date.now();
    hidePanel();
  });
  updateTray();
  nativeTheme.on("updated", () => {
    forgetIcons();
    refreshLinuxMenu();
  });
  statusLoop();
  link.startConnection(viewerContents);
  prepareViewer(viewerHidden);
  startClaude();
  startUpdates();
  if (DEV) debugHooks();
  else if (!startedAtLogin()) openViewer();
}

// Why: a second copy would add a second tray icon; opening it again opens the viewer of the running one instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => openViewer());
  // Why: opening Remote again from Finder or Spotlight while it runs comes here on macOS; it shows the window. The first
  // seconds of a login start are skipped in case macOS reports that start here too.
  app.on("activate", () => {
    if (process.uptime() > 5 || !startedAtLogin()) openViewer();
  });
  app.on("before-quit", allowClose);
  // Why: closing a window must not quit a tray app.
  app.on("window-all-closed", () => undefined);
  void app.whenReady().then(start);
}
