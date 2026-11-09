// The RUNNERS account (2026-11-03 decision 「네 앱 컴퓨터판 · 휴대폰판 개발 방식」): computers and phones signed in
// to the same account see each other. Login goes to the system server's app login (`/api/mobile/auth/*`, the same one
// the phone apps use through runners-app-kit), and keeping and refreshing the tokens is
// runners-app-kit's createAccount: encrypted by the OS (safeStorage) in the user data folder, or only in memory where
// that cannot be done.
import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createAccount, type Account } from "./runners/account";
import { readSettings, writeSettings } from "./settings";
import { displayVersion } from "./updates";

const DEV = !app.isPackaged;
const PROJECT = "REMOTE";

/** Debug runs may point at scripts/relay-dev.mjs with REMOTE_API_URL; a packaged app always uses the real server. */
export const API_URL = (DEV && process.env.REMOTE_API_URL) || "https://server.system.runners.im";
export const RELAY_URL = `${API_URL.replace(/^http/, "ws")}/api/relay`;

/** The name the server sees on this app's requests. */
export function userAgent(): string {
  return `Remote/${displayVersion()}`;
}

let made: Account | null = null;

/** Why made on first use: index.ts moves debug runs to their own data folder after this file is loaded. */
function kitAccount(): Account {
  made ??= createAccount({
    project: PROJECT,
    filePath: join(app.getPath("userData"), "account.bin"),
    apiUrl: API_URL,
    safeStorage,
    // Why: the dev copy of Electron has no stable signature, so the keychain could stop it with a prompt nobody is
    // there to answer. A debug run keeps its sign-in in memory only.
    isPackaged: app.isPackaged,
    userAgent: userAgent(),
  });
  return made;
}

/** This computer's id on the relay, made once and kept. */
export function deviceId(): string {
  const known = readSettings().deviceId;
  if (known) return known;
  const made = randomUUID();
  writeSettings({ deviceId: made });
  return made;
}

export function email(): string | null {
  return kitAccount().current();
}

export function accessToken(): string | null {
  return kitAccount().accessToken();
}

/** Signs in (or makes the account with the code mailed to the address). Throws `bad`, `none`, `format`, `exists`,
 *  `code` or `many`; anything else reads as "could not reach the server". */
export function signIn(mode: "login" | "signup", address: string, password: string, code?: string): Promise<void> {
  return kitAccount().signIn(mode, address, password, code);
}

/** Mails a six-digit code: `signup` to make the account (`exists` when there is one), `reset` for a new password
 *  (`none` when there is no account). */
export function sendCode(purpose: "signup" | "reset", address: string, locale: string): Promise<void> {
  return kitAccount().sendCode(purpose, address, locale);
}

/** Sets a new password with the mailed code and signs in with it. The four apps share the password. */
export function resetPassword(address: string, code: string, password: string): Promise<void> {
  return kitAccount().resetPassword(address, code, password);
}

/** New tokens, before the old one runs out or after the relay said it did. Only the server refusing the refresh token
 *  ends the sign-in. */
export function refresh(): ReturnType<Account["refresh"]> {
  return kitAccount().refresh();
}

/** When the access token runs out, in milliseconds since 1970, or null when it cannot be read. */
export function accessTokenExpiry(): number | null {
  const token = accessToken();
  try {
    const exp = JSON.parse(Buffer.from(token!.split(".")[1], "base64url").toString("utf8")).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function signOut(): Promise<void> {
  return kitAccount().signOut();
}
