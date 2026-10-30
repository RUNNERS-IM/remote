// What the preload script gives the page as `window.remote`.

export type MenuCommand = "open" | "login" | "autoUpdate" | "about" | "updates" | "help" | "quit";

export type MenuState = { openAtLogin: boolean; autoUpdate: boolean };

export type Permissions = { screenRecording: boolean; accessibility: boolean };

export type PermissionKind = keyof Permissions;

/** What the receiving side is doing: off (nobody can see this computer), waiting, or viewed by another computer. */
export type State = "off" | "waiting" | "viewing";

/** Why Remote is off: not macOS (the only system it works on for now), or Screen Recording is not allowed. */
export type OffReason = "platform" | "screenRecording";

export type Status = {
  computer: string;
  state: State;
  /** Set only while off. */
  reason: OffReason | null;
  /** False on Windows and Linux, where nothing works yet. */
  supported: boolean;
  permissions: Permissions;
};

export type Display = {
  id: number;
  /** The name macOS shows in System Settings; empty when unknown. */
  name: string;
  main: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
};

/** One click or key a viewer sends; `x` and `y` are fractions of the display (0 at the left / top, 1 at the far edge). */
export type Input =
  | { kind: "move"; display: number; x: number; y: number }
  | { kind: "click"; display: number; x: number; y: number; button: "left" | "right"; count: number }
  | { kind: "key"; code: number; modifiers: ("shift" | "control" | "option" | "command")[] }
  | { kind: "text"; text: string };

/** Where the press that asked for a click happened, in screen points, so Remote can tell its own click coming back. */
export type PressAt = { x: number; y: number };

/** What happened to a sent input: sent, or ignored because it was Remote's own click landing on the picture again. */
export type SendResult = "sent" | "echo";

export type RemoteApi = {
  status: () => Promise<Status>;
  displays: () => Promise<Display[]>;
  /** One JPEG picture of a display for the window on this computer. It never counts as being viewed. */
  capture: (display: number) => Promise<Uint8Array>;
  /** Shows the system prompt, or opens the System Settings page when macOS no longer shows it. */
  requestPermission: (kind: PermissionKind) => Promise<void>;
  /** The "Send Clicks" switch in the window; every input is refused while it is off. */
  setSendClicks: (on: boolean) => Promise<void>;
  /** Rejects with `off`, `accessibility`, `unsupported`, `display` or a message. */
  sendInput: (input: Input, pressAt: PressAt | null) => Promise<SendResult>;
  /** Called with true when the viewer window is shown and false when it is hidden. */
  onViewerVisible: (listener: (visible: boolean) => void) => () => void;
  /** Whether the OS blurs what is behind the window; the page draws a solid background when it does not. */
  translucent: () => Promise<boolean>;
  /** Sets the window's content height so it fits the page. */
  fitHeight: (height: number) => void;
  /** App version as people see it (2.6.1030.2). */
  version: () => Promise<string>;
  /** Opens an https link in the default browser. */
  openExternal: (url: string) => Promise<void>;
  /** The system accent colour as #rrggbb, or null where the OS has none. */
  accentColor: () => Promise<string | null>;
  menuState: () => Promise<MenuState>;
  /** Runs a menu line; resolves to the menu state after it. */
  command: (command: MenuCommand) => Promise<MenuState>;
  closeWindow: () => void;
};
