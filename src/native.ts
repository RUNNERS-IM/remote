// The page's way to the app: a thin wrapper over `window.remote`, which the preload script provides
// (electron/preload). Everything the page asks of the main process goes through here.
import type {
  Allow,
  Computer,
  Display,
  Input,
  Link,
  LogEntry,
  MenuCommand,
  MenuState,
  SettingsTab,
  PeerInfo,
  PermissionKind,
  Permissions,
  PressAt,
  RemoteApi,
  Status,
  UpdateOffer,
} from "../electron/preload/api";

declare global {
  interface Window {
    remote: RemoteApi;
  }
}

const api = () => window.remote;

export type { Allow, Computer, Display, Input, Link, LogEntry, PeerInfo, MenuCommand, MenuState, PermissionKind, Permissions, SettingsTab, Status, UpdateOffer };

/** Which window this page is: the Remote window, the panel, Settings or the update question. */
export const page: "viewer" | "panel" | "settings" | "update" =
  location.hash === "#panel" ? "panel" : location.hash === "#settings" ? "settings" : location.hash === "#update" ? "update" : "viewer";

export const status = () => api().status();
export const displays = () => api().displays();
export const capture = (display: number) => api().capture(display);
export const requestPermission = (kind: PermissionKind) => api().requestPermission(kind);
export const setSendClicks = (on: boolean) => api().setSendClicks(on);
export const sendInput = (input: Input, pressAt: PressAt | null) => api().sendInput(input, pressAt);
export const link = () => api().link();
export const readClipboard = () => api().readClipboard();
export const writeClipboard = (text: string) => api().writeClipboard(text);
export const keysToPeer = (on: boolean) => api().keysToPeer(on);
export const signIn = (mode: "login" | "signup", email: string, password: string, code?: string) =>
  api().signIn(mode, email, password, code);
export const sendCode = (purpose: "signup" | "reset", email: string) => api().sendCode(purpose, email);
export const resetPassword = (email: string, code: string, password: string) =>
  api().resetPassword(email, code, password);
export const signOut = () => api().signOut();
export const setAllow = (what: Allow, on: boolean) => api().setAllow(what, on);
export const disconnect = () => api().disconnect();
export const onViewerVisible = (listener: (visible: boolean) => void) => api().onViewerVisible(listener);
export const fitHeight = (height: number) => api().fitHeight(height);
export const version = () => api().version();
export const openExternal = (url: string) => api().openExternal(url);
export const menuState = () => api().menuState();
export const command = (name: MenuCommand) => api().command(name);
export const closeWindow = () => api().closeWindow();
export const openSettings = (tab: SettingsTab) => api().openSettings(tab);
export const onSettingsTab = (listener: (tab: SettingsTab) => void) => api().onSettingsTab(listener);
export const openComputer = (host: string) => api().openComputer(host);
export const onOpenComputer = (listener: (host: string) => void) => api().onOpenComputer(listener);
export const updateOffer = () => api().updateOffer();
export const onUpdateOffer = (listener: (offer: UpdateOffer) => void) => api().onUpdateOffer(listener);
export const answerUpdate = (answer: "install" | "later") => api().answerUpdate(answer);

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
      if (!color) return;
      // Why: the window look (runners-window.css) follows the OS accent.
      document.documentElement.style.setProperty("--rw-accent", color);
    });
}
