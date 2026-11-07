// The right-click tray menu, with the same groups as the left-click panel and as Monitor's: the status line,
// Disconnect while someone is looking, Open Remote, the two Allow switches once connected, the two settings,
// About / Check for Updates… / Help & Feedback, Quit.
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
  // Why: on/off lines use the native check mark with no icon (decision 「[PROGRAM] 켬 끔 토글」 2A), like other Mac
  // apps' menus; a check mark and an icon cannot share the slot.
  const check = (id: Command, key: string, on: boolean) =>
    new MenuItem({ id, label: t(key), type: "checkbox", checked: on, click: () => run(id) });
  const separator = () => new MenuItem({ type: "separator" });
  return Menu.buildFromTemplate([
    { label: statusLine(status), icon: icon(DOT[status.state]), enabled: false },
    ...(status.state === "viewing" ? [line("disconnect", "menu.disconnect", "unplug")] : []),
    line("open", "menu.open", "app-window"),
    separator(),
    ...(state.linked
      ? [
          check("allowViewing", "menu.allowViewing", state.allowViewing),
          separator(),
        ]
      : []),
    check("login", "menu.openAtLogin", state.openAtLogin),
    check("autoUpdate", "menu.autoUpdate", state.autoUpdate),
    separator(),
    line("about", "menu.about", "info"),
    line("updates", "menu.checkUpdates", "refresh-cw"),
    line("help", "menu.help", "circle-help"),
    separator(),
    line("quit", "menu.quit", "square-x", "CmdOrCtrl+Q"),
  ]);
}

export function forgetIcons(): void {
  icons.clear();
}
