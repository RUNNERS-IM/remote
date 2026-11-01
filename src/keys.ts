// Keys typed in the viewer window, turned into what the other computer is sent (electron/preload/api.ts `Input`).
//
// Why by physical key (event.code) for shortcuts: macOS shortcuts are bound to key positions, so Command-C must send
// the key code of C on any keyboard layout. Plain characters go as text instead, so accents and Korean typed here
// arrive as typed, whatever layout the other computer uses.
import type { Input } from "./native";

/** macOS virtual key codes (Carbon `kVK_*`) by the browser's KeyboardEvent.code. */
const CODES: Record<string, number> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9, KeyB: 11, KeyQ: 12,
  KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit6: 22,
  Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27, Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31,
  KeyU: 32, BracketLeft: 33, KeyI: 34, KeyP: 35, Enter: 36, KeyL: 37, KeyJ: 38, Quote: 39, KeyK: 40, Semicolon: 41,
  Backslash: 42, Comma: 43, Slash: 44, KeyN: 45, KeyM: 46, Period: 47, Tab: 48, Space: 49, Backquote: 50,
  Backspace: 51, Escape: 53, F5: 96, F6: 97, F7: 98, F3: 99, F8: 100, F9: 101, F11: 103, F10: 109, F12: 111,
  Home: 115, PageUp: 116, Delete: 117, F4: 118, End: 119, F2: 120, PageDown: 121, F1: 122, ArrowLeft: 123,
  ArrowRight: 124, ArrowDown: 125, ArrowUp: 126, NumpadEnter: 76,
};

/** Keys that are never text, even without a modifier. */
const ALWAYS_KEY = new Set([
  "Enter", "NumpadEnter", "Tab", "Backspace", "Escape", "Delete", "Home", "End", "PageUp", "PageDown",
  "ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10",
  "F11", "F12",
]);

type Modifier = "shift" | "control" | "option" | "command";

/** What to send for a key press, or null for keys that send nothing (a lone Shift, a key mid-composition). */
export function keyInput(event: KeyboardEvent): Input | null {
  if (event.isComposing || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) return null;
  const shortcut = event.metaKey || event.ctrlKey;
  if (!shortcut && !ALWAYS_KEY.has(event.code) && [...event.key].length === 1) return { kind: "text", text: event.key };
  const code = CODES[event.code];
  if (code === undefined) return null;
  const modifiers: Modifier[] = [];
  if (event.shiftKey) modifiers.push("shift");
  if (event.ctrlKey) modifiers.push("control");
  if (event.altKey) modifiers.push("option");
  if (event.metaKey) modifiers.push("command");
  return { kind: "key", code, modifiers };
}
