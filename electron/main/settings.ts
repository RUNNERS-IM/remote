// Remote's few settings, kept in settings.json in the user data folder.
import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Settings = {
  /** Check GitHub for a new release once a day. On by default. */
  autoUpdate: boolean;
  /** The day (`2026-10-30`) "Later" was chosen in the update dialog, so the daily check does not ask again that day. */
  updateLaterOn: string | null;
  /** The coordination server (Headscale) every office computer joins, e.g. `https://remote.example.com`. Null until
   *  typed in the viewer or set by a `remote://join` link (electron/main/join.ts). */
  linkServer: string | null;
  /** Pre-authorized key from that server, so this computer joins without anyone approving it in a browser. */
  linkKey: string | null;
  /** Other computers in the network may see this one. "Disconnect" turns it off. */
  allowViewing: boolean;
  /** Other computers may also click and type here. Off by default: seeing is asked for far more often than doing. */
  allowControl: boolean;
  /** Apps (bundle ids) Claude may click in without a person approving each time (decision 5B). */
  claudeApps: string[];
};

const DEFAULTS: Settings = {
  autoUpdate: true,
  updateLaterOn: null,
  linkServer: null,
  linkKey: null,
  allowViewing: true,
  allowControl: false,
  claudeApps: [],
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
