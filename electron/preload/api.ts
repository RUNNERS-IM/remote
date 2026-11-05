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

/** `linked` is false until this computer is on the relay (signed in and connected); the two Allow lines show only after
 *  that. */
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

/** One click or key a viewer sends; `x` and `y` are fractions of the display (0 at the left / top, 1 at the far edge).
 *  `press` is one half of a click (for dragging), `drag` a move with the button held, `scroll` pixels as the browser
 *  counts them (positive `dy` shows what is further down). */
export type Input =
  | { kind: "move"; display: number; x: number; y: number }
  | { kind: "click"; display: number; x: number; y: number; button: "left" | "right"; count: number }
  | { kind: "press"; display: number; x: number; y: number; button: "left" | "right"; down: boolean; count?: number }
  | { kind: "drag"; display: number; x: number; y: number; button: "left" | "right" }
  | { kind: "scroll"; display: number; x: number; y: number; dx: number; dy: number }
  | { kind: "key"; code: number; modifiers: ("shift" | "control" | "option" | "command")[] }
  | { kind: "text"; text: string };

/** One computer of the same RUNNERS account that has Remote open. `host` is its device id on the relay, used to reach
 *  it. */
export type Computer = { name: string; host: string; online: boolean; os: string };

/** The connection: not signed in to a RUNNERS account, starting, running, or failed (the reason is in `error`; it
 *  tries again by itself). */
export type LinkState = "signedOut" | "starting" | "running" | "failed";

/** One line of the connection log: who did what to this computer, and when (ms since 1970). `refused` is a request
 *  turned away because seeing or clicking was off. Typed text itself is never written down. */
export type LogEntry = { at: number; peer: string; what: "view" | "click" | "key" | "text" | "copy" | "paste" | "refused" };

export type Link = {
  state: LinkState;
  error: string | null;
  /** The signed-in account's email, or null. */
  account: string | null;
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

/** A WebRTC signal from another device, passed on by the relay. */
export type Signal = { from: string; sdp?: unknown; candidate?: unknown };

/** Claude asking another computer something through the page's connection to it (link.ts askPage). */
export type ClientRequest = { rid: string; device: string; method: string; params: Record<string, unknown> };

/** Signing in or making the account first. */
export type SignMode = "login" | "signup";

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
  /** Signs in to the RUNNERS account. Rejects with `bad`, `exists` or `network`. */
  signIn: (mode: SignMode, email: string, password: string) => Promise<Link>;
  signOut: () => Promise<Link>;
  /** Turns letting others see or click in this computer on or off. */
  setAllow: (what: Allow, on: boolean) => Promise<Link>;
  /** Stops everyone looking now and turns seeing off until it is turned on again. */
  disconnect: () => Promise<Link>;
  /** This computer's id on the relay. */
  deviceId: () => Promise<string>;
  /** Passes a WebRTC signal to another device of the account. */
  sendSignal: (to: string, payload: { sdp?: unknown; candidate?: unknown }) => void;
  onSignal: (listener: (signal: Signal) => void) => () => void;
  /** A device went offline; its connections can be closed. */
  onPeerLeft: (listener: (deviceId: string) => void) => () => void;
  /** Another device's question to this computer; the main process decides with the switches and permissions. */
  hostRequest: (peer: string, method: string, params: Record<string, unknown>) => Promise<unknown>;
  /** Seeing was turned off: end every connection other devices have to this computer. */
  onDropHosted: (listener: () => void) => () => void;
  /** Signed out: end every connection. */
  onDropAll: (listener: () => void) => () => void;
  onClientRequest: (listener: (request: ClientRequest) => void) => () => void;
  clientReply: (rid: string, ok: boolean, value: unknown) => void;
  /** Called with true when the viewer window is shown and false when it is hidden. */
  onViewerVisible: (listener: (visible: boolean) => void) => () => void;
  /** This computer's copied text, and putting text there: copy and paste between this computer and the one on screen. */
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  /** While keys go to the computer on screen, this window's menu shortcuts (Command-C, Command-V…) are left alone so
   *  the keys reach the page and go there. */
  keysToPeer: (on: boolean) => void;
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
