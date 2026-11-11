// The app's picture inside Remote's own windows follows light and dark (decision 2026-11-11, 2B): the white tile in
// light, the black tile in dark, so a white tile does not stand out in a dark window. Places the system draws (Dock,
// Finder, dialogs) keep the white tile only (1A, build/icon.*).
import { useSyncExternalStore } from "react";
import white from "./assets/app-icon.png";
import black from "./assets/app-icon-black.png";

const dark = window.matchMedia("(prefers-color-scheme: dark)");

function subscribe(onChange: () => void): () => void {
  dark.addEventListener("change", onChange);
  return () => dark.removeEventListener("change", onChange);
}

export function useAppIcon(): string {
  return useSyncExternalStore(subscribe, () => (dark.matches ? black : white));
}
