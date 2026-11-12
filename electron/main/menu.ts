// The tray menu on Linux, whose trays only open a menu set beforehand (macOS and Windows open the panel on either
// click): the status line, Disconnect while someone is looking, Open Remote, the Allow switch once connected,
// Settings… / Check for Updates… / Help & Feedback, Quit.
// Icons are the Lucide PNGs from scripts/menu-icons.sh (resources/menu/).
import { app, Menu, MenuItem, nativeImage, nativeTheme } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MenuCommand as Command, MenuState, Status } from "../preload/api";
import { statusLine, t } from "./i18n";

export type { Command, MenuState };

const icons = new Map<string, Electron.NativeImage>();

/** Lucide icon: a template image on macOS (the menu tints it), black or white by theme elsewhere. */
function icon(name: string): Electron.NativeImage {
  const dot = name.startsWith("dot-");
  const file = dot ? name : `${name}-${process.platform !== "darwin" && nativeTheme.shouldUseDarkColors ? "white" : "black"}`;
  let image = icons.get(file);
  if (!image) {
    // Why: 36 px drawn for an 18 pt slot, so the image is read at 2x.
    image = nativeImage.createFromBuffer(readFileSync(join(app.getAppPath(), "resources", "menu", `${file}.png`)), {
      scaleFactor: 2,
    });
    if (process.platform === "darwin" && !dot) image.setTemplateImage(true);
    icons.set(file, image);
  }
  return image;
}

/** Why: "being viewed" is yellow, not green, because the screen is being seen and the user should notice. */
const DOT = { off: "dot-grey", waiting: "dot-green", viewing: "dot-yellow" } as const;

export function buildMenu(status: Status, state: MenuState, run: (command: Command) => void): Menu {
  const line = (id: Command, key: string, iconName: string, accelerator?: string) =>
    new MenuItem({
      id,
      label: t(key),
      icon: icon(iconName),
      accelerator,
      registerAccelerator: false,
      click: () => run(id),
    });
  // Why: on/off lines keep the native check mark (decision 「[PROGRAM] 켬 끔 토글」 2A) and an icon like every other line;
  // macOS draws the check in its own column to the left of the icon, so all labels line up.
  const check = (id: Command, key: string, iconName: string, on: boolean, enabled = true) =>
    new MenuItem({ id, label: t(key), icon: icon(iconName), type: "checkbox", checked: on, enabled, click: () => run(id) });
  const separator = () => new MenuItem({ type: "separator" });
  return Menu.buildFromTemplate([
    { label: statusLine(status), icon: icon(DOT[status.state]), enabled: false },
    ...(status.state === "viewing" ? [line("disconnect", "menu.disconnect", "unplug")] : []),
    line("open", "menu.open", "app-window"),
    separator(),
    ...(state.linked
      ? [
          // Why: Windows and Linux cannot share their screen yet, so the line reads off and cannot be pressed there.
          check("allowViewing", "menu.allowViewing", "eye", status.supported && state.allowViewing, status.supported),
          separator(),
        ]
      : []),
    // Why: the other on/off lines live in Settings › General (shared decision 2026-11-07 2A).
    line("settings", "menu.settings", "settings", "CmdOrCtrl+,"),
    line("updates", "menu.checkUpdates", "refresh-cw"),
    line("help", "menu.help", "circle-help"),
    separator(),
    line("quit", "menu.quit", "square-x", "CmdOrCtrl+Q"),
  ]);
}

export function forgetIcons(): void {
  icons.clear();
}
