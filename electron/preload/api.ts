// What the preload script gives the page as `window.remote`.

export type MenuCommand =
  | "open"
  | "allowViewing"
  | "allowControl"
  | "disconnect"
  | "login"
  | "autoUpdate"
  | "about"
  | "updates"
  | "help"
  | "quit";

/** `linked` is false until a coordination server is set; the two Allow lines show only after that. */
export type MenuState = {
  openAtLogin: boolean;
  autoUpdate: boolean;
  linked: boolean;
  allowViewing: boolean;
  allowControl: boolean;
};

/** The update window's content: new version as people see it, the "What's new" lines (null hides the box) and the
 *  download's progress while it is still downloading. */
export type UpdateOffer = { version: string; notes: string[] | null; downloading: boolean; percent: number };

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
  /** The computers looking at this one right now; empty unless the state is viewing. */
  viewers: string[];
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

/** One computer in the office network (link/main.go `Computer`). `host` is the address name used to reach it. */
export type Computer = { name: string; host: string; online: boolean; os: string };

/** The connection: no coordination server set yet, starting, waiting for this computer to be approved, running, or
 *  failed (the reason is in `error`). */
export type LinkState = "noServer" | "starting" | "needsLogin" | "running" | "failed";

/** One line of the connection log: who did what to this computer, and when (ms since 1970). `refused` is a request
 *  turned away because seeing or clicking was off. Typed text itself is never written down. */
export type LogEntry = { at: number; peer: string; what: "view" | "click" | "key" | "text" | "refused" };

export type Link = {
  /** The coordination server this computer joins (`https://remote.example.com`), or null when none is set. */
  server: string | null;
  state: LinkState;
  error: string | null;
  /** This computer's name in the network. */
  self: string | null;
  computers: Computer[];
  allowViewing: boolean;
  allowControl: boolean;
  /** Newest first. */
  log: LogEntry[];
};

/** The two switches other computers depend on. */
export type Allow = "allowViewing" | "allowControl";

/** What another computer tells a viewer before it is looked at. `viewing` / `control` say whether it lets others see
 *  it and click in it right now; `reason` is set when it cannot be seen at all (same codes as OffReason). */
export type PeerInfo = {
  computer: string;
  displays: Display[];
  viewing: boolean;
  control: boolean;
  reason: OffReason | null;
};

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
  /** The connection and the computers in the network. */
  link: () => Promise<Link>;
  /** Saves the connection server typed in the viewer (an empty text removes it). Rejects with `bad` when the text
   *  cannot be a server address. */
  setLinkServer: (text: string) => Promise<Link>;
  /** Opens the page where this computer is approved to join (only while the state is needsLogin). */
  openLinkLogin: () => Promise<void>;
  /** Turns letting others see or click in this computer on or off. */
  setAllow: (what: Allow, on: boolean) => Promise<Link>;
  /** Stops everyone looking now and turns seeing off until it is turned on again. */
  disconnect: () => Promise<Link>;
  /** Another computer's name and displays. Rejects with `unreachable`, `off`, or a message. */
  peerInfo: (host: string) => Promise<PeerInfo>;
  /** One JPEG picture of another computer's display. Rejects with `off`, `permission`, `display` or a message. */
  peerCapture: (host: string, display: number) => Promise<Uint8Array>;
  /** One click or key into another computer. Rejects with `off`, `control`, `accessibility` or a message. */
  peerInput: (host: string, input: Input) => Promise<void>;
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
  /** What the update window shows, or null when no update is being offered. */
  updateOffer: () => Promise<UpdateOffer | null>;
  /** Called when the offer changes (download progress, download done). */
  onUpdateOffer: (listener: (offer: UpdateOffer) => void) => () => void;
  /** The update window's answer; Later closes the window, Install Now keeps it up until the app quits. */
  answerUpdate: (answer: "install" | "later") => void;
};
