// The system server's relay (runners-app-kit docs/relay.md): one WebSocket per computer. It tells Remote which
// computers and phones of the same account are online, and carries the WebRTC signals between them. Screens and clicks
// never pass through it; they go over the WebRTC connection the signals set up (src/peer.ts).
import { app } from "electron";
import * as account from "./account";
import * as status from "./status";

const RETRY_FIRST_MS = 2000;
const RETRY_MAX_MS = 30_000;

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
  // Why the header: Node's WebSocket (undici) takes headers, so the token stays out of the address and server logs.
  const ws = new WebSocket(account.RELAY_URL, { headers: { Authorization: `Bearer ${token}` } } as unknown as string[]);
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
    // Why: 4401 is an expired or wrong token; one refresh, then sign in again if that fails too.
    if (event.code === 4401) {
      void account.refresh().then((ok) => {
        if (ok) connect();
        else {
          state = "signedOut";
          error = null;
        }
      });
      return;
    }
    // Why: 4409 means a newer connection with this same device id took over (the same user data folder running
    // twice); joining again would push that one off in turn, over and over (runners-app-kit docs/relay.md).
    if (event.code === 4409) {
      state = "failed";
      error = "replaced";
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
