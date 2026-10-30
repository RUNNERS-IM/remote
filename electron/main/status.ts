// What the receiving side is doing, shown in the menu bar picture, the panel and the right-click menu.
//
// "Being viewed" means another computer is looking at this one. The viewer window on this same computer never
// counts: it is the owner looking at their own screen, and showing "being viewed" for it made the warning meaningless.
// Connections from other computers come with the link stage (_docs/[REMOTE] 작업 계획서.md, stage 3); until then
// nothing calls remoteFrameSent and the state is only ever off or waiting.
import type { OffReason, Permissions, State, Status } from "../preload/api";
import { native } from "./native";

/** Windows and Linux capture and input are not written yet (plan stage 6). */
export const SUPPORTED = process.platform === "darwin";

/** A viewer asks for a picture about every 200 ms, so a longer gap means nobody is looking any more. */
const VIEWING_GAP_MS = 1500;

let lastRemoteFrameAt = 0;

/** Called by the connection each time a picture of this computer goes to another computer. */
export function remoteFrameSent(): void {
  lastRemoteFrameAt = Date.now();
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
  } else if (Date.now() - lastRemoteFrameAt < VIEWING_GAP_MS) {
    state = "viewing";
  }
  return { computer, state, reason, supported: SUPPORTED, permissions: allowed };
}
