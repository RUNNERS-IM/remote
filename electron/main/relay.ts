// The system server's relay (runners-app-kit docs/relay.md): one WebSocket per computer. It tells Remote which
// computers and phones of the same account are online, and carries the WebRTC signals between them. Screens and clicks
// never pass through it; they go over the WebRTC connection the signals set up (src/peer.ts).
import { app } from "electron";
import * as account from "./account";
import * as status from "./status";

const RETRY_FIRST_MS = 2000;
const RETRY_MAX_MS = 30_000;
/** Close codes from runners-app-kit docs/relay.md: the token was refused, it belongs to another app, or a newer
 *  connection with this device id took over. */
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_WRONG_APP = 4403;
const CLOSE_REPLACED = 4409;
/** Why: the server checks open connections every minute and closes them once the 1-hour token runs out, which would
 *  drop every session watching this computer. A fresh token is fetched a little before and handed over with `auth`. */
const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const REFRESH_RETRY_MS = 60 * 1000;

/** A computer or phone of the same account, as the relay lists it. */
export type Device = { deviceId: string; name: string; role: "host" | "viewer" };

/** What a signal carries: an offer or answer, or one ICE candidate. */
export type Signal = { from: string; sdp?: unknown; candidate?: unknown };

export type RelayState = "signedOut" | "starting" | "running" | "failed";

let socket: WebSocket | null = null;
let state: RelayState = "starting";
let error: string | null = null;
const devices = new Map<string, Device>();
let retryMs = RETRY_FIRST_MS;
let retry: NodeJS.Timeout | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
/** A refresh already answered 4401 on this run of connections; a second 4401 waits instead of looping at full speed. */
let refreshedOnce = false;
let onSignal: (signal: Signal) => void = () => undefined;
let onLeft: (deviceId: string) => void = () => undefined;

export function current(): { state: RelayState; error: string | null; devices: Device[] } {
  return { state, error, devices: [...devices.values()] };
}

export function device(deviceId: string): Device | null {
  return devices.get(deviceId) ?? null;
}

export function send(message: Record<string, unknown>): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function later(): void {
  if (retry) return;
  retry = setTimeout(() => {
    retry = null;
    connect();
  }, retryMs);
  retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
}

function stopRefreshing(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

/** Fetches a new token before this one runs out and gives it to the open connection, which stays up. */
function scheduleRefresh(ms?: number): void {
  stopRefreshing();
  const expiry = account.accessTokenExpiry();
  const wait = ms ?? (expiry === null ? null : Math.max(0, expiry - REFRESH_AHEAD_MS - Date.now()));
  if (wait === null) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void account.refresh().then((result) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (result.ok) {
        send({ type: "auth", token: account.accessToken() });
        scheduleRefresh();
      } else if (result.reason === "network") scheduleRefresh(REFRESH_RETRY_MS);
      else connect();
    });
  }, wait);
}

function receive(text: string): void {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return;
  }
  if (message.type === "peers" && Array.isArray(message.peers)) {
    devices.clear();
    for (const peer of message.peers as Device[]) devices.set(peer.deviceId, peer);
    state = "running";
    error = null;
    retryMs = RETRY_FIRST_MS;
    // Why here and not on open: the relay answers hello only after it checked the token.
    refreshedOnce = false;
    scheduleRefresh();
  } else if (message.type === "peer-joined" && message.peer) {
    const peer = message.peer as Device;
    devices.set(peer.deviceId, peer);
  } else if (message.type === "peer-left" && typeof message.deviceId === "string") {
    devices.delete(message.deviceId);
    onLeft(message.deviceId);
  } else if (message.type === "signal" && typeof message.from === "string") {
    onSignal({ from: message.from, sdp: message.sdp, candidate: message.candidate });
  } else if (message.type === "error") {
    console.error("relay:", message.error);
  }
}

/** Opens the relay connection with this account's token; signed out, it only notes that. */
export function connect(): void {
  if (retry) clearTimeout(retry);
  retry = null;
  stopRefreshing();
  socket?.close();
  socket = null;
  devices.clear();
  const token = account.accessToken();
  if (!token) {
    state = "signedOut";
    error = null;
    return;
  }
  state = "starting";
  error = null;
  // Why the header: Node's WebSocket (undici) takes headers, so the token stays out of the address and server logs.
  // Why User-Agent: the system server's load balancer turns away requests without one (403); set here rather than
  // rely on Node's default.
  const ws = new WebSocket(account.RELAY_URL, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": `Remote/${app.getVersion()}` },
  } as unknown as string[]);
  socket = ws;
  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        type: "hello",
        deviceId: account.deviceId(),
        projectName: "REMOTE",
        name: status.current().computer,
        role: "host",
      }),
    );
  });
  ws.addEventListener("message", (event) => receive(String(event.data)));
  ws.addEventListener("error", () => {
    if (socket !== ws) return;
    error = "unreachable";
  });
  ws.addEventListener("close", (event) => {
    if (socket !== ws) return;
    socket = null;
    devices.clear();
    stopRefreshing();
    // Why: 4401 is an expired or wrong token. One refresh; only the server refusing it ends the sign-in. No internet
    // is not a sign-out: the sign-in stays and the same steps run again a little later.
    if (event.code === CLOSE_UNAUTHORIZED && !refreshedOnce) {
      refreshedOnce = true;
      void account.refresh().then((result) => {
        if (socket) return;
        if (result.ok) connect();
        else if (result.reason === "network") {
          refreshedOnce = false;
          state = "failed";
          error = "unreachable";
          later();
        } else {
          state = "signedOut";
          error = null;
        }
      });
      return;
    }
    // Why: 4409 means a newer connection with this same device id took over (the same user data folder running
    // twice), and joining again would push that one off in turn, over and over. 4403 means the sign-in belongs to
    // another app, which trying again cannot change (runners-app-kit docs/relay.md).
    if (event.code === CLOSE_REPLACED || event.code === CLOSE_WRONG_APP) {
      state = "failed";
      error = "elsewhere";
      return;
    }
    state = "failed";
    error = error ?? (event.reason || `closed ${event.code}`);
    later();
  });
}

export function disconnect(): void {
  if (retry) clearTimeout(retry);
  retry = null;
  stopRefreshing();
  const ws = socket;
  socket = null;
  ws?.close();
  devices.clear();
}

export function start(handlers: { signal: (signal: Signal) => void; left: (deviceId: string) => void }): void {
  onSignal = handlers.signal;
  onLeft = handlers.left;
  connect();
  app.on("before-quit", disconnect);
}
