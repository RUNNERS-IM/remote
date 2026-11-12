// Starts Remote again when it ends without anyone asking (a crash, Force Quit, the system stopping it), so this computer
// stays visible to the other computers and phones (decision 「Remote 항상 켜 두기」 1B). A quit someone asked for (Quit
// Remote, ⌘Q, installing an update, logging out) leaves a mark first, and then nothing starts it again.
// A small shell process waits for Remote to end; it is not a login item, so turning Open at Login off still keeps
// Remote from starting with the computer.
import { app } from "electron";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HIDDEN_ARG } from "./login";

/** Given to the Remote started again, so it opens without its window (like a login start) and counts the restart. */
export const RESTARTED_ARG = "--restarted";
const QUIT_MARK = "quit-asked";
const RESTARTS = "restarts.json";
// Why a limit: a Remote that ends again right after every start would be started for ever; after three restarts in ten
// minutes it stays off until someone opens it.
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 10 * 60_000;

// Why the second's pause: macOS takes a moment to let go of an app that just ended before it opens it again.
const WATCHER = `pid=$1; mark=$2; shift 2
while kill -0 "$pid" 2>/dev/null; do sleep 2; done
[ -e "$mark" ] && exit 0
sleep 1
exec "$@"`;

let mark: string | null = null;

/** Notes that this quit was asked for, so Remote is not started again. Safe to call more than once. */
export function quitAsked(): void {
  if (mark) writeFileSync(mark, "");
}

/** Whether one more restart fits in the limit; a start by a person clears the count. */
function mayRestart(file: string): boolean {
  if (!process.argv.includes(RESTARTED_ARG)) {
    rmSync(file, { force: true });
    return true;
  }
  let times: number[] = [];
  try {
    times = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as number[]) : [];
  } catch {
    times = [];
  }
  const now = Date.now();
  times = [...times.filter((at) => now - at < RESTART_WINDOW_MS), now];
  writeFileSync(file, JSON.stringify(times));
  return times.length < MAX_RESTARTS;
}

/** How this Remote is started again: the app through macOS, or (debug runs) the same Electron command. */
function command(): string[] {
  if (app.isPackaged) {
    const bundle = process.execPath.slice(0, process.execPath.indexOf(".app/") + ".app".length);
    return ["/usr/bin/open", "-g", bundle, "--args", HIDDEN_ARG, RESTARTED_ARG];
  }
  const args = process.argv.slice(1).filter((arg) => arg !== RESTARTED_ARG && arg !== HIDDEN_ARG);
  return [process.execPath, ...args, HIDDEN_ARG, RESTARTED_ARG];
}

/** macOS release builds, and debug runs with REMOTE_KEEP_ALIVE=1 (so ordinary debug runs are never started again). */
export function start(): void {
  if (process.platform !== "darwin") return;
  if (!app.isPackaged && process.env.REMOTE_KEEP_ALIVE !== "1") return;
  const dir = app.getPath("userData");
  mark = join(dir, QUIT_MARK);
  rmSync(mark, { force: true });
  app.on("before-quit", quitAsked);
  if (!mayRestart(join(dir, RESTARTS))) return;
  spawn("/bin/sh", ["-c", WATCHER, "remote-keep-alive", String(process.pid), mark, ...command()], {
    detached: true,
    stdio: "ignore",
  }).unref();
}
