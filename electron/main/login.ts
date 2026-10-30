// "Open at login": Remote starts with the computer so this computer can be seen without anyone opening it first
// (the shared default for all RUNNERS apps is on). The first release run turns it on once; after that only the menu
// line changes it, so turning it off sticks. macOS 13+ registers the app itself (listed by name and icon under
// Login Items), Windows uses the Run key, Linux an autostart .desktop file.
import { app } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Marks that the one-time default was applied, so a later launch never turns it back on. */
const DEFAULT_APPLIED = "open-at-login-default";
const LINUX_AUTOSTART = join(homedir(), ".config", "autostart", "remote.desktop");

export function isOn(): boolean {
  if (process.platform === "linux") return existsSync(LINUX_AUTOSTART);
  return app.getLoginItemSettings().openAtLogin;
}

export function setOn(on: boolean): void {
  if (process.platform === "linux") {
    if (!on) {
      rmSync(LINUX_AUTOSTART, { force: true });
      return;
    }
    // Why: an AppImage runs from a temporary mount, so the file names the AppImage itself.
    const exec = process.env.APPIMAGE ?? process.execPath;
    mkdirSync(join(homedir(), ".config", "autostart"), { recursive: true });
    writeFileSync(
      LINUX_AUTOSTART,
      `[Desktop Entry]\nType=Application\nName=Remote\nExec="${exec}"\nX-GNOME-Autostart-enabled=true\n`,
    );
    return;
  }
  app.setLoginItemSettings({ openAtLogin: on });
}

/** The menu line: flips the setting and returns what it is now. */
export function toggle(): boolean {
  setOn(!isOn());
  return isOn();
}

/** Release builds only: turns the login item on the first time. Debug runs leave the login items alone, so a dev
 *  copy of Electron is never registered. */
export function applyDefault(): void {
  if (!app.isPackaged) return;
  const marker = join(app.getPath("userData"), DEFAULT_APPLIED);
  if (existsSync(marker)) return;
  setOn(true);
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(marker, "");
}
