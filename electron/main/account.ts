// The RUNNERS account (2026-11-03 decision 「네 앱 컴퓨터판 · 휴대폰판 개발 방식」): computers and phones signed in
// to the same account see each other. Login goes to the system server's app login (`/api/mobile/auth/*`, the same one
// the phone apps use through runners-app-kit), and the tokens are kept encrypted by the OS (safeStorage) in the user
// data folder. Nothing but the email and the two tokens is kept.
import { app, safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
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

let saved: Saved | null | undefined;

function file(): string {
  return join(app.getPath("userData"), "account.bin");
}

// Why plain text in debug runs: the dev copy of Electron has no stable signature, so the keychain could stop it with a
// prompt nobody is there to answer. Debug runs only hold test tokens from scripts/relay-dev.mjs.
function seal(text: string): Buffer {
  return DEV ? Buffer.from(text) : safeStorage.encryptString(text);
}

function unseal(data: Buffer): string {
  return DEV ? data.toString("utf8") : safeStorage.decryptString(data);
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
    throw new Error("network");
  }
  if (res.status === 401 || res.status === 400 || res.status === 404) throw new Error("bad");
  if (res.status === 409) throw new Error("exists");
  if (!res.ok) throw new Error("network");
  return (await res.json()) as T;
}

/** Signs in (or makes the account first). Throws `bad`, `exists` or `network`. The server takes the password as its
 *  SHA-256 in hex, like the phone apps send it. */
export async function signIn(mode: "login" | "signup", address: string, password: string): Promise<void> {
  const hashed = createHash("sha256").update(password).digest("hex");
  const answer = await post<{ tokens: Tokens }>(`/api/mobile/auth/${mode}`, {
    email: address.trim(),
    password: hashed,
    projectName: PROJECT,
  });
  save({ email: address.trim(), tokens: answer.tokens });
}

/** New tokens after the relay said the old one expired. False when the account has to sign in again. */
export async function refresh(): Promise<boolean> {
  const now = load();
  if (!now) return false;
  try {
    const tokens = await post<Tokens>("/api/mobile/auth/refresh", { refreshToken: now.tokens.refreshToken });
    save({ ...now, tokens });
    return true;
  } catch (e) {
    if (e instanceof Error && e.message === "bad") save(null);
    return false;
  }
}

export async function signOut(): Promise<void> {
  const now = load();
  save(null);
  if (now) await post("/api/mobile/auth/logout", { refreshToken: now.tokens.refreshToken }).catch(() => undefined);
}
