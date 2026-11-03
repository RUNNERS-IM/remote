#!/usr/bin/env node
// A stand-in for the system server's relay and app login (runners-app-kit docs/relay.md), for debug runs and the phone
// app before the real server is up. Everything stays on this computer and in memory.
//
//   node scripts/relay-dev.mjs [port]     (default 8790)
//   REMOTE_API_URL=http://127.0.0.1:8790 pnpm dev
//
// Login takes any email and password: the account is the email, and the access token is "dev.<email>". Tokens never
// expire, except that REMOTE_DEV_EXPIRE=1 answers every relay connection with 4401 once, to try the refresh path.
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? 8790);
const PING_MS = 30_000;

/** Account email -> deviceId -> { socket, deviceId, name, role, projectName } */
const accounts = new Map();
/** Account email -> the last `state` each host sent. */
const states = new Map();
const expired = new Set();

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let text = "";
    req.on("data", (part) => (text += part));
    req.on("end", () => {
      try {
        resolve(JSON.parse(text || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const tokensFor = (email) => ({ accessToken: `dev.${email}`, refreshToken: `devrefresh.${email}` });

const http = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://dev").pathname;
  if (req.method !== "POST") return json(res, 404, { message: "not found" });
  const body = await readJson(req);
  if (path === "/api/mobile/auth/login" || path === "/api/mobile/auth/signup") {
    if (!/^\S+@\S+$/.test(String(body.email ?? "")) || !/^[0-9a-f]{64}$/.test(String(body.password ?? ""))) {
      return json(res, 400, { message: "bad request" });
    }
    return json(res, 200, { user: { id: body.email, email: body.email }, tokens: tokensFor(body.email) });
  }
  if (path === "/api/mobile/auth/refresh") {
    const email = String(body.refreshToken ?? "").replace(/^devrefresh\./, "");
    if (!email || email === body.refreshToken) return json(res, 401, { message: "unauthorized" });
    return json(res, 200, tokensFor(email));
  }
  if (path === "/api/mobile/auth/logout") return json(res, 200, {});
  return json(res, 404, { message: "not found" });
});

const wss = new WebSocketServer({ noServer: true });

http.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://dev");
  if (url.pathname !== "/api/relay") return socket.destroy();
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "") || url.searchParams.get("token") || "";
  const email = token.startsWith("dev.") ? token.slice(4) : null;
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!email) return ws.close(4401, "unauthorized");
    if (process.env.REMOTE_DEV_EXPIRE && !expired.has(email)) {
      expired.add(email);
      return ws.close(4401, "expired");
    }
    attach(ws, email);
  });
});

function others(email, deviceId) {
  return [...(accounts.get(email)?.values() ?? [])].filter((d) => d.deviceId !== deviceId);
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function attach(ws, email) {
  let me = null;
  let alive = true;
  ws.on("pong", () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, PING_MS);

  ws.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return send(ws, { type: "error", error: "not json" });
    }
    if (message.type === "hello") {
      const { deviceId, projectName, name, role } = message;
      if (!deviceId || !["host", "viewer"].includes(role)) return send(ws, { type: "error", error: "bad hello" });
      const devices = accounts.get(email) ?? new Map();
      accounts.set(email, devices);
      devices.get(deviceId)?.socket.close(4409, "replaced");
      me = { socket: ws, deviceId, name: String(name ?? ""), role, projectName };
      devices.set(deviceId, me);
      send(ws, { type: "peers", peers: others(email, deviceId).map(({ deviceId, name, role }) => ({ deviceId, name, role })) });
      for (const other of others(email, deviceId)) {
        send(other.socket, { type: "peer-joined", peer: { deviceId, name: me.name, role } });
      }
      if (role === "viewer") {
        for (const [from, data] of states.get(email) ?? []) send(ws, { type: "state", from, data });
      }
      console.log(`hello ${email} ${role} ${me.name} (${deviceId})`);
      return;
    }
    if (!me) return send(ws, { type: "error", error: "hello first" });
    if (["signal", "command", "result"].includes(message.type)) {
      const target = accounts.get(email)?.get(message.to);
      if (!target) {
        if (message.type === "command") send(ws, { type: "result", id: message.id, ok: false, data: { error: "offline" } });
        return;
      }
      return send(target.socket, { ...message, from: me.deviceId });
    }
    if (message.type === "state" && me.role === "host") {
      const kept = states.get(email) ?? new Map();
      states.set(email, kept);
      kept.set(me.deviceId, message.data);
      for (const other of others(email, me.deviceId)) {
        if (other.role === "viewer") send(other.socket, { type: "state", from: me.deviceId, data: message.data });
      }
      return;
    }
    if (message.type === "alert") return console.log(`alert for ${email}: ${message.title} / ${message.body}`);
    send(ws, { type: "error", error: `unknown type ${message.type}` });
  });

  ws.on("close", () => {
    clearInterval(ping);
    if (!me) return;
    const devices = accounts.get(email);
    if (devices?.get(me.deviceId)?.socket !== ws) return;
    devices.delete(me.deviceId);
    for (const other of others(email, me.deviceId)) send(other.socket, { type: "peer-left", deviceId: me.deviceId });
    console.log(`bye ${email} ${me.name}`);
  });
}

http.listen(port, "127.0.0.1", () => console.log(`relay-dev on http://127.0.0.1:${port} (ws /api/relay)`));
