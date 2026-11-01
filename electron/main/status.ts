// What the receiving side is doing, shown in the menu bar picture, the panel and the right-click menu.
//
// "Being viewed" means another computer is looking at this one. The viewer window on this same computer never
// counts: it is the owner looking at their own screen, and showing "being viewed" for it made the warning meaningless.
// Other computers reach this one through the connection (link.ts), which calls remoteFrameSent for every picture it
// hands out.
import type { OffReason, Permissions, State, Status } from "../preload/api";
import { native } from "./native";

/** Windows and Linux capture and input are not written yet (plan stage 6). */
export const SUPPORTED = process.platform === "darwin";

/** A viewer asks for a picture about every 200 ms, so a longer gap means nobody is looking any more. */
const VIEWING_GAP_MS = 1500;

/** When each computer last got a picture of this one. */
const lastFrameAt = new Map<string, number>();

/** Called by the connection each time a picture of this computer goes to another computer. Returns true when that
 *  computer was not looking a moment ago, so the connection log notes when viewing starts and not every picture. */
export function remoteFrameSent(peer: string): boolean {
  const before = lastFrameAt.get(peer) ?? 0;
  const now = Date.now();
  lastFrameAt.set(peer, now);
  return now - before >= VIEWING_GAP_MS;
}

/** The computers looking at this one right now, by name. */
export function viewers(): string[] {
  const now = Date.now();
  return [...lastFrameAt].filter(([, at]) => now - at < VIEWING_GAP_MS).map(([peer]) => peer);
}

/** Forgets everyone looking, so the state drops to waiting at once after Disconnect. */
export function forgetViewers(): void {
  lastFrameAt.clear();
}

export function permissions(): Permissions {
  if (!SUPPORTED) return { screenRecording: false, accessibility: false };
  return JSON.parse(native.permissions()) as Permissions;
}

let computer: string | null = null;

export function current(): Status {
  computer ??= native.computerName();
  const allowed = permissions();
  let state: State = "waiting";
  let reason: OffReason | null = null;
  if (!SUPPORTED) {
    state = "off";
    reason = "platform";
  } else if (!allowed.screenRecording) {
    state = "off";
    reason = "screenRecording";
  }
  const watching = state === "waiting" ? viewers() : [];
  if (watching.length > 0) state = "viewing";
  return { computer, state, reason, supported: SUPPORTED, permissions: allowed, viewers: watching };
}
