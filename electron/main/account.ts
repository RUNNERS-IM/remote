// The RUNNERS account (2026-11-03 decision 「네 앱 컴퓨터판 · 휴대폰판 개발 방식」): computers and phones signed in
// to the same account see each other. Login goes to the system server's app login (`/api/mobile/auth/*`, the same one
// the phone apps use through runners-app-kit), and the tokens are kept encrypted by the OS (safeStorage) in the user
// data folder. Nothing but the email and the two tokens is kept.
import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSettings, writeSettings } from "./settings";

const DEV = !app.isPackaged;
const PROJECT = "REMOTE";
const TIMEOUT_MS = 15_000;

/** Debug runs may point at scripts/relay-dev.mjs with REMOTE_API_URL; a packaged app always uses the real server. */
export const API_URL = (DEV && process.env.REMOTE_API_URL) || "https://server.system.runners.im";
export const RELAY_URL = `${API_URL.replace(/^http/, "ws")}/api/relay`;

type Tokens = { accessToken: string; refreshToken: string };
type Saved = { email: string; tokens: Tokens };

/** Why: the same outcomes as runners-app-kit refreshSession(). Only "rejected" ends the sign-in; "network" means the
 *  server could not be reached or was briefly unwell, so the tokens stay and the caller tries again later. */
export type RefreshResult = { ok: true } | { ok: false; reason: "rejected" | "network" | "signedOut" };

/** A failed call: `message` is the code the sign-in sheet reads, `status` the server's answer (none when unreached). */
class ApiError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

let saved: Saved | null | undefined;

function file(): string {
  return join(app.getPath("userData"), "account.bin");
}

// Why plain text in debug runs: the dev copy of Electron has no stable signature, so the keychain could stop it with a
// prompt nobody is there to answer. Debug runs only hold test tokens from scripts/relay-dev.mjs.
// Why the availability check: encrypting throws where the OS has no key store (a Linux without one), and that would
// show up as "could not reach the server" after a correct password. The same fallback as Monitor; the file stays
// readable by this user only (mode 0600).
function seal(text: string): Buffer {
  return !DEV && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text);
}

function unseal(data: Buffer): string {
  return !DEV && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString("utf8");
}

function load(): Saved | null {
  if (saved !== undefined) return saved;
  saved = null;
  try {
    if (existsSync(file())) saved = JSON.parse(unseal(readFileSync(file()))) as Saved;
  } catch {
    // Why: a file the OS can no longer decrypt (another user, a reinstalled keychain) is the same as signed out.
    saved = null;
  }
  return saved;
}

function save(next: Saved | null): void {
  saved = next;
  if (!next) {
    rmSync(file(), { force: true });
    return;
  }
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(file(), seal(JSON.stringify(next)), { mode: 0o600 });
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
  return load()?.email ?? null;
}

export function accessToken(): string | null {
  return load()?.tokens.accessToken ?? null;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError("network", null);
  }
  if (res.status === 401 || res.status === 400 || res.status === 404) throw new ApiError("bad", res.status);
  if (res.status === 409) throw new ApiError("exists", res.status);
  if (!res.ok) throw new ApiError("network", res.status);
  const answer = (await res.json()) as unknown;
  // Why: the system server wraps a success as {code, data}; scripts/relay-dev.mjs answers bare.
  return (answer && typeof answer === "object" && "code" in answer && "data" in answer ? answer.data : answer) as T;
}

/** Signs in (or makes the account first). Throws `bad`, `exists` or `network`. The password goes as typed over HTTPS,
 *  as runners-app-kit sends it; the server takes letters and digits, 6 to 20 of them. */
export async function signIn(mode: "login" | "signup", address: string, password: string): Promise<void> {
  const answer = await post<{ tokens: Tokens }>(`/api/mobile/auth/${mode}`, {
    email: address.trim(),
    password,
    projectName: PROJECT,
  });
  save({ email: address.trim(), tokens: answer.tokens });
}

let refreshing: Promise<RefreshResult> | null = null;

/** New tokens, before the old one runs out or after the relay said it did. Only the server refusing the refresh token
 *  (401) ends the sign-in, as in runners-app-kit docs/relay.md; a 400 or 404 is not a verdict on the account. */
export function refresh(): Promise<RefreshResult> {
  refreshing ??= (async (): Promise<RefreshResult> => {
    const now = load();
    if (!now) return { ok: false, reason: "signedOut" };
    try {
      const tokens = await post<Tokens>("/api/mobile/auth/refresh", { refreshToken: now.tokens.refreshToken });
      save({ ...now, tokens });
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        save(null);
        return { ok: false, reason: "rejected" };
      }
      return { ok: false, reason: "network" };
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
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

export async function signOut(): Promise<void> {
  const now = load();
  save(null);
  if (now) await post("/api/mobile/auth/logout", { refreshToken: now.tokens.refreshToken }).catch(() => undefined);
}
