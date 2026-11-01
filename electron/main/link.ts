// The connection (plan stage 3): other office computers see and click this one, and this one sees and clicks them.
//
// Two parts work together:
//   - remote-link (link/main.go), a small program Remote starts. It joins the office network through our own
//     coordination server (Headscale) and is the only thing reachable from other computers: port 7787 on the network
//     address, never on the computer's own network cards. It tells us who is asking (the network vouches for the name).
//   - The app server below, on 127.0.0.1 with a random port and a secret token. Only remote-link knows both, so only
//     requests that came through the office network reach it.
//
// Why seeing and clicking are separate switches: seeing is what a coworker asks for most ("look at this error"), and
// clicking is a bigger trust step, so it starts off. Disconnect turns seeing off, which also stops clicking.
import { app, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Allow, Computer, Input, Link, LinkState, LogEntry, PeerInfo } from "../preload/api";
import { native } from "./native";
import { readSettings, writeSettings } from "./settings";
import * as status from "./status";

/** Debug runs only: `REMOTE_LINK_SERVER`, `REMOTE_LINK_KEY` and `REMOTE_LINK_NAME` stand in for the settings, so two
 *  copies of Remote on one Mac can join a Headscale running on that Mac (link/README.md). */
const DEV = !app.isPackaged;

const RESTART_MS = 5000;
const LOG_KEEP = 200;
const PEER_TIMEOUT_MS = 8000;
const INPUT_BODY_MAX = 64 * 1024;

const TOKEN_HEADER = "x-remote-token";
const PEER_HEADER = "x-remote-peer";

let token = "";
let appPort = 0;
let child: ChildProcess | null = null;
let linkPort = 0;
let state: LinkState = "noServer";
let error: string | null = null;
let authUrl: string | null = null;
let self: string | null = null;
let computers: Computer[] = [];
let quitting = false;
const log: LogEntry[] = [];

function note(peer: string, what: LogEntry["what"]): void {
  log.unshift({ at: Date.now(), peer, what });
  log.length = Math.min(log.length, LOG_KEEP);
}

/** A typed or linked server address as the origin remote-link is given (`remote.example.com` ->
 *  `https://remote.example.com`), or null when it cannot be one. Why https only: the coordination server hands out
 *  who is in the network, so a plain-http address would let anyone on the way swap in their own computers. Debug runs
 *  also take http, for a Headscale on this Mac. */
export function parseServer(text: string): string | null {
  const typed = text.trim();
  if (!typed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(DEV && url.protocol === "http:")) return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost" && !DEV) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function server(): { url: string; key: string | null } | null {
  const settings = readSettings();
  const url = (DEV && process.env.REMOTE_LINK_SERVER) || settings.linkServer;
  if (!url) return null;
  return { url, key: (DEV && process.env.REMOTE_LINK_KEY) || settings.linkKey };
}

/** The computer's name as a network name: lower case letters, digits and dashes ("RUNNERS Mac Studio" -> "runners-mac-studio"). */
export function networkName(computer: string): string {
  const name = computer
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return name || "remote";
}

function binary(): string {
  const file = `remote-link-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  return app.isPackaged ? join(process.resourcesPath, "link", file) : join(app.getAppPath(), "link", "bin.noindex", file);
}

// ---- The app server: what other computers reach through remote-link ----

function sameToken(given: string | undefined): boolean {
  if (!given || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

function reply(res: ServerResponse, code: number, body: string | Buffer, type = "text/plain; charset=utf-8"): void {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on("data", (part: Buffer) => {
      size += part.length;
      if (size > INPUT_BODY_MAX) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      parts.push(part);
    });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

function info(): PeerInfo {
  const now = status.current();
  const settings = readSettings();
  return {
    computer: now.computer,
    // Why: with seeing off, even the monitor names stay private.
    displays: now.supported && settings.allowViewing ? JSON.parse(native.displays()) : [],
    viewing: settings.allowViewing && now.reason === null,
    control: settings.allowViewing && settings.allowControl && now.permissions.accessibility,
    reason: now.reason,
  };
}

/** What the input is, for the log; moves are left out so the log shows presses, not every mouse step. */
function logKind(input: Input): LogEntry["what"] | null {
  if (input.kind === "click") return "click";
  if (input.kind === "key") return "key";
  if (input.kind === "text") return "text";
  return null;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!sameToken(req.headers[TOKEN_HEADER] as string | undefined)) return reply(res, 403, "forbidden");
  const peer = String(req.headers[PEER_HEADER] || "");
  if (!peer) return reply(res, 403, "forbidden");
  const url = new URL(req.url || "/", "http://remote");
  const settings = readSettings();

  if (req.method === "GET" && url.pathname === "/info") {
    return reply(res, 200, JSON.stringify(info()), "application/json");
  }
  if (req.method === "GET" && url.pathname === "/frame") {
    if (!settings.allowViewing) {
      note(peer, "refused");
      return reply(res, 403, "off");
    }
    if (!status.SUPPORTED) return reply(res, 501, "unsupported");
    try {
      const jpeg = await native.capture(Number(url.searchParams.get("display")));
      if (status.remoteFrameSent(peer)) note(peer, "view");
      return reply(res, 200, jpeg, "image/jpeg");
    } catch (e) {
      return reply(res, 500, e instanceof Error ? e.message : String(e));
    }
  }
  if (req.method === "GET" && url.pathname === "/front") {
    if (!settings.allowViewing) return reply(res, 403, "off");
    return reply(res, 200, status.SUPPORTED ? native.frontApp() : "null", "application/json");
  }
  if (req.method === "POST" && url.pathname === "/input") {
    if (!settings.allowViewing) return reply(res, 403, "off");
    if (!settings.allowControl) {
      note(peer, "refused");
      return reply(res, 403, "control");
    }
    if (!status.SUPPORTED) return reply(res, 501, "unsupported");
    if (!status.permissions().accessibility) return reply(res, 403, "accessibility");
    try {
      const input = JSON.parse(await readBody(req)) as Input;
      native.sendInput(JSON.stringify(input));
      const kind = logKind(input);
      if (kind) note(peer, kind);
      return reply(res, 200, "sent");
    } catch (e) {
      return reply(res, 400, e instanceof Error ? e.message : String(e));
    }
  }
  return reply(res, 404, "not found");
}

function startAppServer(): Promise<void> {
  const http = createServer((req, res) => {
    handle(req, res).catch((e) => reply(res, 500, String(e)));
  });
  return new Promise((resolve) => {
    http.listen(0, "127.0.0.1", () => {
      appPort = (http.address() as AddressInfo).port;
      resolve();
    });
  });
}

// ---- remote-link: starting it, and asking it things ----

function startLink(): void {
  const target = server();
  if (!target) {
    state = "noServer";
    return;
  }
  const file = binary();
  if (!existsSync(file)) {
    state = "failed";
    error = "missing";
    return;
  }
  // Why one folder per server: the network identity in it belongs to the server that approved it, so switching servers
  // must not reuse it, and switching back finds the old approval again.
  const dir = join(app.getPath("userData"), "link", new URL(target.url).host.replace(/[^a-z0-9.-]/gi, "_"));
  mkdirSync(dir, { recursive: true });
  const name = (DEV && process.env.REMOTE_LINK_NAME) || networkName(status.current().computer);
  const args = ["--dir", dir, "--hostname", name, "--control", target.url, "--app", `127.0.0.1:${appPort}`, "--token", token];
  if (target.key) args.push("--authkey", target.key);
  state = "starting";
  error = null;
  // Why: stdin stays open as a pipe; remote-link quits when it closes, so it never outlives Remote.
  const started = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
  child = started;
  createInterface({ input: started.stdout! }).on("line", (line) => {
    try {
      const ready = JSON.parse(line) as { port?: number };
      if (ready.port) linkPort = ready.port;
    } catch {
      // Not the ready line.
    }
  });
  let lastError = "";
  createInterface({ input: started.stderr! }).on("line", (line) => {
    lastError = line;
  });
  started.on("exit", () => {
    if (child !== started) return;
    child = null;
    linkPort = 0;
    if (quitting) return;
    state = "failed";
    error = lastError.replace(/^\S+ \S+ /, "") || "stopped";
    setTimeout(() => {
      if (!child && !quitting) startLink();
    }, RESTART_MS);
  });
}

async function askLink(path: string, init: RequestInit = {}): Promise<Response> {
  if (!linkPort) throw new Error("unreachable");
  const headers = new Headers(init.headers);
  headers.set("X-Remote-Token", token);
  return fetch(`http://127.0.0.1:${linkPort}${path}`, { ...init, headers, signal: AbortSignal.timeout(PEER_TIMEOUT_MS) });
}

async function refresh(): Promise<void> {
  if (!linkPort) return;
  try {
    const res = await askLink("/status");
    const now = (await res.json()) as { state: string; authUrl: string; self: string; computers: Computer[] };
    self = now.self || null;
    computers = now.computers;
    authUrl = now.authUrl || null;
    state = now.state === "Running" ? "running" : now.state === "NeedsLogin" || now.state === "NeedsMachineAuth" ? "needsLogin" : "starting";
    error = null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
}

/** Whether a coordination server is set, so the Allow switches mean something. */
export function hasServer(): boolean {
  return server() !== null;
}

export async function current(): Promise<Link> {
  await refresh();
  const settings = readSettings();
  return {
    server: server()?.url ?? null,
    state,
    error,
    self,
    computers,
    allowViewing: settings.allowViewing,
    allowControl: settings.allowControl,
    log: log.slice(0, 50),
  };
}

/** The server this computer joins (null leaves the network): saved, and remote-link restarted for it. A key saved
 *  for the old server is dropped, since it only works there. */
export function setServer(url: string | null): void {
  const before = readSettings();
  if (before.linkServer === url) return;
  writeSettings({ linkServer: url, linkKey: null });
  const old = child;
  child = null;
  old?.kill();
  linkPort = 0;
  self = null;
  computers = [];
  authUrl = null;
  error = null;
  startLink();
}

export function openLogin(): void {
  // Why: the address comes from remote-link, never from the page, so a page cannot open anything else this way.
  if (state === "needsLogin" && authUrl && /^https?:\/\//.test(authUrl)) void shell.openExternal(authUrl);
}

export function setAllow(what: Allow, on: boolean): void {
  writeSettings({ [what]: on });
  if (what === "allowViewing" && !on) status.forgetViewers();
}

/** Disconnect: nobody sees or clicks this computer until seeing is turned on again. */
export function disconnect(): void {
  setAllow("allowViewing", false);
}

/** Why: the name goes into a path, so only network names (letters, digits, dashes) are passed on. */
function peerPath(host: string, path: string): string {
  if (!/^[a-z0-9-]{1,63}$/.test(host)) throw new Error("bad computer name");
  return `/peer/${host}${path}`;
}

async function failure(res: Response): Promise<Error> {
  const text = (await res.text()).trim();
  return new Error(res.status === 502 ? "unreachable" : text || `HTTP ${res.status}`);
}

export async function peerInfo(host: string): Promise<PeerInfo> {
  const res = await askLink(peerPath(host, "/info"));
  if (!res.ok) throw await failure(res);
  return (await res.json()) as PeerInfo;
}

export async function peerCapture(host: string, display: number): Promise<Buffer> {
  const res = await askLink(peerPath(host, `/frame?display=${Number(display)}`));
  if (!res.ok) throw await failure(res);
  return Buffer.from(await res.arrayBuffer());
}

export async function peerFront(host: string): Promise<{ bundleId: string; name: string } | null> {
  const res = await askLink(peerPath(host, "/front"));
  if (!res.ok) throw await failure(res);
  return (await res.json()) as { bundleId: string; name: string } | null;
}

export async function peerInput(host: string, input: Input): Promise<void> {
  const res = await askLink(peerPath(host, "/input"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await failure(res);
}

export async function startConnection(): Promise<void> {
  token = randomBytes(24).toString("hex");
  await startAppServer();
  startLink();
  app.on("before-quit", () => {
    quitting = true;
    child?.kill();
  });
}
