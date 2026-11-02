// The connection (plan stage 3): other office computers see and click this one, and this one sees and clicks them.
//
// Remote shares the computer's own Tailscale (electron/main/tailscale.ts) instead of joining a network of its own
// (2026-11-02 decision "one network, Tailscale"):
//   - It listens on port 7787 of this computer's Tailscale address only, never on its other network cards, so only
//     computers in the same Tailscale network can reach it.
//   - For each connection it finds the calling address in `tailscale status` and turns the request away unless the
//     caller may come in (tailscale.caller). The name in the log is the one Tailscale lists
//     for that address, never one the request brings.
//   - It reaches other computers on their Tailscale addresses, port 7787.
//
// Why seeing and clicking are separate switches: seeing is what a coworker asks for most ("look at this error"), and
// clicking is a bigger trust step, so it starts off. Disconnect turns seeing off, which also stops clicking.
import { app, shell } from "electron";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Allow, Computer, Input, Link, LinkState, LogEntry, PeerInfo } from "../preload/api";
import { native } from "./native";
import { readSettings, writeSettings } from "./settings";
import * as status from "./status";
import * as tailscale from "./tailscale";

/** The port Remote answers on, on the Tailscale address. */
export const PORT = 7787;

const REFRESH_MS = 5000;
const FORCED_REFRESH_MS = 5000;
const LOG_KEEP = 200;
const PEER_TIMEOUT_MS = 8000;
const INPUT_BODY_MAX = 64 * 1024;
/** How long a peer that answered (or did not answer) /info is remembered, so the computer list does not ask every
 *  computer in the network at every refresh. */
const PROBE_MS = 30_000;

let state: LinkState = "starting";
let error: string | null = null;
let authUrl: string | null = null;
let self: string | null = null;
/** The last `tailscale status`, to find who is calling. */
let lastStatus: tailscale.Status | null = null;
let computers: Computer[] = [];
/** Network name -> Tailscale IPv4 address, from the last status. Only names in this map can be reached. */
let addresses = new Map<string, string>();
/** Network name -> when it last answered as a Remote (or failed to), for the computer list. */
const probes = new Map<string, { at: number; remote: boolean }>();
let server: Server | null = null;
let listeningOn: string | null = null;
let refreshing: Promise<void> | null = null;
const log: LogEntry[] = [];
/** Who is on the far end of each connection, asked once per connection. */
const peers = new WeakMap<Socket, Promise<string | null>>();

function note(peer: string, what: LogEntry["what"]): void {
  log.unshift({ at: Date.now(), peer, what });
  log.length = Math.min(log.length, LOG_KEEP);
}

// ---- The app server: what other computers reach on port 7787 ----

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

/** The network name of the computer on the far end of this connection, or null when it may not come in. A caller
 *  missing from the last status (it just joined) makes Remote read the status again once. */
async function callerOf(address: string): Promise<string | null> {
  const found = lastStatus && tailscale.caller(address, lastStatus);
  if (found) return found.host;
  await refresh(true);
  return (lastStatus && tailscale.caller(address, lastStatus))?.host ?? null;
}

function peerOf(req: IncomingMessage): Promise<string | null> {
  const socket = req.socket;
  let known = peers.get(socket);
  if (!known) {
    const address = (socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    known = address ? callerOf(address) : Promise.resolve(null);
    peers.set(socket, known);
  }
  return known;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const peer = await peerOf(req);
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

/** Listens on `address` (this computer's Tailscale IPv4), moving when the address changes. */
function listenOn(address: string | null): void {
  if (address === listeningOn) return;
  server?.close();
  server = null;
  listeningOn = null;
  if (!address) return;
  const next = createServer((req, res) => {
    handle(req, res).catch((e) => reply(res, 500, String(e)));
  });
  next.on("error", (e) => {
    if (server !== next) return;
    server = null;
    listeningOn = null;
    state = "failed";
    error = e.message;
  });
  next.listen(PORT, address);
  server = next;
  listeningOn = address;
}

// ---- Tailscale: what the network looks like ----

/** Whether a peer answers as a Remote, remembered for PROBE_MS. Offline peers and ones without an address are not
 *  asked. Why ask at all: the Tailscale network also holds phones and computers without Remote, and a tab for them
 *  would only fail. */
function isRemote(node: tailscale.Node): boolean {
  if (!node.online || !node.address) return false;
  const known = probes.get(node.host);
  if (!known || Date.now() - known.at > PROBE_MS) {
    probes.set(node.host, { at: Date.now(), remote: known?.remote ?? false });
    fetch(`http://${node.address}:${PORT}/info`, { signal: AbortSignal.timeout(PEER_TIMEOUT_MS) }).then(
      (res) => probes.set(node.host, { at: Date.now(), remote: res.ok }),
      () => probes.set(node.host, { at: Date.now(), remote: false }),
    );
  }
  return probes.get(node.host)?.remote ?? false;
}

async function refreshNow(): Promise<void> {
  if (!tailscale.binary()) {
    state = "noTailscale";
    error = null;
    self = null;
    lastStatus = null;
    computers = [];
    addresses = new Map();
    listenOn(null);
    return;
  }
  try {
    const now = await tailscale.status();
    authUrl = now.authUrl || null;
    self = now.self?.host ?? null;
    lastStatus = now;
    if (now.state !== "Running") {
      state = now.state === "Starting" || now.state === "NoState" ? "starting" : "needsLogin";
      error = null;
      computers = [];
      addresses = new Map();
      listenOn(null);
      return;
    }
    listenOn(now.self?.address ?? null);
    const mine = now.peers.filter((p) => tailscale.trusted(p));
    addresses = new Map(mine.flatMap((p) => (p.address ? [[p.host, p.address] as [string, string]] : [])));
    computers = mine
      .filter((p) => isRemote(p))
      .map((p) => ({ name: p.name, host: p.host, online: p.online, os: p.os }));
    if (server) {
      state = "running";
      error = null;
    }
  } catch (e) {
    state = "failed";
    error = e instanceof Error ? e.message : String(e);
  }
}

let lastForced = 0;

/** `forced` is a refresh for an unknown caller; at most one every few seconds, so a stranger knocking repeatedly
 *  cannot make Remote run `tailscale status` without end. */
function refresh(forced = false): Promise<void> {
  if (forced) {
    if (Date.now() - lastForced < FORCED_REFRESH_MS) return refreshing ?? Promise.resolve();
    lastForced = Date.now();
  }
  refreshing ??= refreshNow().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Whether this computer is in the network, so the Allow switches mean something. */
export function hasServer(): boolean {
  return state === "running";
}

export async function current(): Promise<Link> {
  await refresh();
  const settings = readSettings();
  return {
    state,
    error,
    self,
    computers,
    allowViewing: settings.allowViewing,
    allowControl: settings.allowControl,
    log: log.slice(0, 50),
  };
}

export function openLogin(): void {
  // Why: the address comes from Tailscale, never from the page, so a page cannot open anything else this way.
  if (state === "needsLogin" && authUrl && /^https:\/\//.test(authUrl)) void shell.openExternal(authUrl);
}

export function setAllow(what: Allow, on: boolean): void {
  writeSettings({ [what]: on });
  if (what === "allowViewing" && !on) status.forgetViewers();
}

/** Disconnect: nobody sees or clicks this computer until seeing is turned on again. */
export function disconnect(): void {
  setAllow("allowViewing", false);
}

// ---- Asking other computers ----

/** Why: the name goes into an address, so only network names (letters, digits, dashes) known to Tailscale are used. */
function peerUrl(host: string, path: string): string {
  if (!/^[a-z0-9-]{1,63}$/.test(host)) throw new Error("bad computer name");
  const address = addresses.get(host);
  if (!address) throw new Error("unreachable");
  return `http://${address}:${PORT}${path}`;
}

async function ask(host: string, path: string, init: RequestInit = {}): Promise<Response> {
  if (addresses.size === 0) await refresh();
  try {
    return await fetch(peerUrl(host, path), { ...init, signal: AbortSignal.timeout(PEER_TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof Error && e.message === "bad computer name") throw e;
    throw new Error("unreachable");
  }
}

async function failure(res: Response): Promise<Error> {
  const text = (await res.text()).trim();
  return new Error(text || `HTTP ${res.status}`);
}

export async function peerInfo(host: string): Promise<PeerInfo> {
  const res = await ask(host, "/info");
  if (!res.ok) throw await failure(res);
  return (await res.json()) as PeerInfo;
}

export async function peerCapture(host: string, display: number): Promise<Buffer> {
  const res = await ask(host, `/frame?display=${Number(display)}`);
  if (!res.ok) throw await failure(res);
  return Buffer.from(await res.arrayBuffer());
}

export async function peerFront(host: string): Promise<{ bundleId: string; name: string } | null> {
  const res = await ask(host, "/front");
  if (!res.ok) throw await failure(res);
  return (await res.json()) as { bundleId: string; name: string } | null;
}

export async function peerInput(host: string, input: Input): Promise<void> {
  const res = await ask(host, "/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await failure(res);
}

export async function startConnection(): Promise<void> {
  await refresh();
  // Why keep refreshing without a window open: the address can change (Tailscale restarted, logged in later), and
  // other computers must still reach this one while nobody looks at Remote here.
  setInterval(() => void refresh(), REFRESH_MS).unref();
  app.on("before-quit", () => listenOn(null));
}
