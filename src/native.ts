// The page's way to the app: a thin wrapper over `window.remote`, which the preload script provides
// (electron/preload). Everything the page asks of the main process goes through here.
import type {
  Display,
  Input,
  MenuCommand,
  MenuState,
  PermissionKind,
  Permissions,
  PressAt,
  RemoteApi,
  Status,
} from "../electron/preload/api";

declare global {
  interface Window {
    remote: RemoteApi;
  }
}

const api = () => window.remote;

export type { Display, MenuCommand, MenuState, PermissionKind, Permissions, Status };

/** Which window this page is: the tray panel, the viewer window or the About window. */
export const page: "panel" | "viewer" | "about" =
  location.hash === "#about" ? "about" : location.hash === "#viewer" ? "viewer" : "panel";

export const status = () => api().status();
export const displays = () => api().displays();
export const capture = (display: number) => api().capture(display);
export const requestPermission = (kind: PermissionKind) => api().requestPermission(kind);
export const setSendClicks = (on: boolean) => api().setSendClicks(on);
export const sendInput = (input: Input, pressAt: PressAt | null) => api().sendInput(input, pressAt);
export const onViewerVisible = (listener: (visible: boolean) => void) => api().onViewerVisible(listener);
export const fitHeight = (height: number) => api().fitHeight(height);
export const version = () => api().version();
export const openExternal = (url: string) => api().openExternal(url);
export const menuState = () => api().menuState();
export const command = (name: MenuCommand) => api().command(name);
export const closeWindow = () => api().closeWindow();

/** The short code inside an error from the main process ("Error invoking remote method '…': Error: permission"). */
export function errorCode(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** Marks the page see-through where the OS blurs behind the window, and takes the system accent colour. */
export function applyWindowLook(): void {
  void api()
    .translucent()
    .then((on) => {
      document.documentElement.dataset.translucent = String(on);
    });
  void api()
    .accentColor()
    .then((color) => {
      if (color) document.documentElement.style.setProperty("--rm-accent", color);
    });
}
