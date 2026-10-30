// Clicks and keys sent from the viewer window into this computer.
//
// Why the echo check: the window shows this computer's own screen, so a click sent to a spot that the window itself
// covers lands on the picture again. The page then took it for a new press and sent another click, and so on, so one
// press fired many clicks. A click that arrives at the spot Remote just clicked, right after, is that echo and is
// ignored, so each press sends exactly one click.
import type { Input, PressAt, SendResult } from "../preload/api";
import { native } from "./native";
import { permissions, SUPPORTED } from "./status";

/** How long after a sent click a press at the same spot counts as its echo. */
const ECHO_MS = 1500;
/** How close (in screen points) a press must be to the clicked spot to count as its echo. */
const ECHO_POINTS = 2;

let sendClicks = false;
let lastSent: { x: number; y: number; at: number } | null = null;

/** The window's "Send Clicks" switch. Off at launch and whenever the window hides. */
export function setSendClicks(on: boolean): void {
  sendClicks = on;
  lastSent = null;
}

function isEcho(pressAt: PressAt | null): boolean {
  if (!pressAt || !lastSent || Date.now() - lastSent.at > ECHO_MS) return false;
  return Math.abs(pressAt.x - lastSent.x) <= ECHO_POINTS && Math.abs(pressAt.y - lastSent.y) <= ECHO_POINTS;
}

/** Posts one input. Throws a short code the page turns into text: off, unsupported, accessibility, or a message. */
export function send(input: Input, pressAt: PressAt | null): SendResult {
  if (!SUPPORTED) throw new Error("unsupported");
  if (!sendClicks) throw new Error("off");
  if (isEcho(pressAt)) return "echo";
  if (!permissions().accessibility) throw new Error("accessibility");
  const at = native.sendInput(JSON.stringify(input));
  if (at.length === 2) lastSent = { x: at[0], y: at[1], at: Date.now() };
  return "sent";
}
