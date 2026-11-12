// Remote's few settings, kept in settings.json in the user data folder.
import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Settings = {
  /** Check GitHub for a new release once a day. On by default. */
  autoUpdate: boolean;
  /** The day (`2026-10-30`) "Later" was chosen in the update dialog, so the daily check does not ask again that day. */
  updateLaterOn: string | null;
  /** When a check last reached GitHub (milliseconds since 1970), so a wake from sleep checks only when one is due. */
  updateCheckedAt?: number;
  /** Other computers and phones of the same account may see this one, and click and type in it. "Disconnect" turns it off. */
  allowViewing: boolean;
  /** Apps (bundle ids) Claude may click in without a person approving each time (decision 5B). */
  claudeApps: string[];
  /** This computer's id on the relay, made at first start (account.ts). */
  deviceId: string | null;
  /** The picture in the menu bar. macOS only; other systems always keep it, or nothing would lead back to Remote. */
  showTrayIcon: boolean;
};

const DEFAULTS: Settings = {
  autoUpdate: true,
  updateLaterOn: null,
  allowViewing: true,
  claudeApps: [],
  deviceId: null,
  showTrayIcon: true,
};

function file(): string {
  return join(app.getPath("userData"), "settings.json");
}

export function readSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(file(), "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(change: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...change };
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}
