#!/usr/bin/env node
// Remote's MCP server: lets Claude see and click the office computers through the Remote app running on this computer.
// Plain Node with no packages, so it runs from the app bundle as it is:
//
//   claude mcp add remote -- env ELECTRON_RUN_AS_NODE=1 /Applications/Remote.app/Contents/MacOS/Remote \
//     /Applications/Remote.app/Contents/Resources/mcp/remote-mcp.mjs
//
// It speaks MCP (JSON-RPC, one message per line) on stdin/stdout and passes each tool call to Remote over the socket
// Remote opens for this user (electron/main/claude.ts). Remote decides what needs a person's approval, not this file.
// REMOTE_SOCKET overrides where the socket is (a debug copy of Remote with its own user data folder).
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const VERSION = "1";

function socketPath() {
  if (process.env.REMOTE_SOCKET) return process.env.REMOTE_SOCKET;
  if (process.platform === "win32") return `\\\\.\\pipe\\remote-claude-${process.env.USERNAME ?? "user"}`;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Remote", "claude.sock");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Remote", "claude.sock");
}

/** macOS virtual key codes for the key names Claude uses. */
const KEYS = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, "=": 24, 9: 25, 7: 26, "-": 27, 8: 28, 0: 29, "]": 30, o: 31, u: 32,
  "[": 33, i: 34, p: 35, return: 36, enter: 36, l: 37, j: 38, "'": 39, k: 40, ";": 41, "\\": 42, ",": 43, "/": 44,
  n: 45, m: 46, ".": 47, tab: 48, space: 49, "`": 50, backspace: 51, escape: 53, esc: 53, f5: 96, f6: 97, f7: 98,
  f3: 99, f8: 100, f9: 101, f11: 103, f10: 109, f12: 111, home: 115, pageup: 116, delete: 117, f4: 118, end: 119,
  f2: 120, pagedown: 121, f1: 122, left: 123, right: 124, down: 125, up: 126,
};

const computer = {
  type: "string",
  description: 'Which computer: "this" for the computer Claude runs on, or a name from remote_computers.',
};
const display = { type: "number", description: "Display id from remote_displays (the main display when left out)." };

const TOOLS = [
  {
    name: "remote_computers",
    description: "Lists this computer and the office computers Remote can reach, with whether each is online.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "remote_displays",
    description: "Lists a computer's displays: id, name, whether it is the main one, and size in points.",
    inputSchema: { type: "object", properties: { computer }, required: ["computer"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "remote_screenshot",
    description:
      "Takes a picture of one display of a computer. Clicks on that display use this picture's pixel coordinates, so take a new one whenever the screen may have changed.",
    inputSchema: { type: "object", properties: { computer, display }, required: ["computer"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "remote_click",
    description:
      "Clicks at a point given in pixels of the latest remote_screenshot of that display. A person may have to approve it first (outside the apps they allowed, and always in macOS security windows); a refusal comes back as an error.",
    inputSchema: {
      type: "object",
      properties: {
        computer,
        display,
        x: { type: "number", description: "Pixels from the left of the screenshot." },
        y: { type: "number", description: "Pixels from the top of the screenshot." },
        button: { type: "string", enum: ["left", "right"] },
        count: { type: "number", description: "2 for a double click." },
      },
      required: ["computer", "display", "x", "y"],
    },
  },
  {
    name: "remote_type",
    description: "Types text into whatever has the keyboard focus on that computer. May need a person's approval.",
    inputSchema: { type: "object", properties: { computer, text: { type: "string" } }, required: ["computer", "text"] },
  },
  {
    name: "remote_key",
    description:
      'Presses one key with optional modifiers, e.g. key "return", "escape", "tab", "up", "a" with modifiers ["command"]. May need a person\'s approval.',
    inputSchema: {
      type: "object",
      properties: {
        computer,
        key: { type: "string" },
        modifiers: { type: "array", items: { type: "string", enum: ["shift", "control", "option", "command"] } },
      },
      required: ["computer", "key"],
    },
  },
];

let socket = null;
let nextId = 1;
const waiting = new Map();

function connect() {
  if (socket) return socket;
  socket = createConnection(socketPath());
  createInterface({ input: socket }).on("line", (line) => {
    const answer = JSON.parse(line);
    const done = waiting.get(answer.id);
    if (!done) return;
    waiting.delete(answer.id);
    done(answer);
  });
  const fail = (error) => {
    socket = null;
    for (const done of waiting.values()) done({ error: `Remote is not running or not reachable (${error?.message ?? "closed"})` });
    waiting.clear();
  };
  socket.on("error", fail);
  socket.on("close", fail);
  return socket;
}

function ask(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, (answer) => (answer.error ? reject(new Error(answer.error)) : resolve(answer.result)));
    connect().write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

async function call(name, args) {
  switch (name) {
    case "remote_computers":
      return text(await ask("computers", {}));
    case "remote_displays":
      return text(await ask("displays", { computer: args.computer }));
    case "remote_screenshot": {
      const shot = await ask("screenshot", { computer: args.computer, display: args.display });
      return {
        content: [
          { type: "image", data: shot.jpeg, mimeType: "image/jpeg" },
          { type: "text", text: `display ${shot.display}, ${shot.width}×${shot.height} pixels` },
        ],
      };
    }
    case "remote_click":
      return text(await ask("click", args));
    case "remote_type":
      return text(await ask("type", { computer: args.computer, text: args.text }));
    case "remote_key": {
      const code = KEYS[String(args.key ?? "").toLowerCase()];
      if (code === undefined) throw new Error(`unknown key ${args.key}`);
      return text(await ask("key", { computer: args.computer, code, modifiers: args.modifiers ?? [] }));
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function write(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (id === undefined) return;
  try {
    if (method === "initialize") {
      write({
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "remote", version: VERSION },
        },
      });
    } else if (method === "tools/list") {
      write({ id, result: { tools: TOOLS } });
    } else if (method === "tools/call") {
      try {
        write({ id, result: await call(params.name, params.arguments ?? {}) });
      } catch (error) {
        write({ id, result: { isError: true, content: [{ type: "text", text: error.message }] } });
      }
    } else if (method === "ping") {
      write({ id, result: {} });
    } else {
      write({ id, error: { code: -32601, message: `unknown method ${method}` } });
    }
  } catch (error) {
    write({ id, error: { code: -32603, message: error.message } });
  }
});

process.stdin.on("end", () => {
  socket?.end();
  process.exit(0);
});
