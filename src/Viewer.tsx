// The viewer window ("Open Remote"), decision 「[REMOTE] 모든 컴퓨터 한눈에」 1A 2A:
//   - Signed out, it asks for the RUNNERS account first: computers and phones of the same account see each other.
//   - Then every computer of the account that has Remote open, as a grid. Each tile shows a small still picture of
//     that computer's main display, new every two seconds, or why it cannot be seen.
//   - Pressing a tile opens that computer: its screen as WebRTC video, clicks, keys and text going there. Arrows at the
//     sides step through its displays, and "All Displays" in the display menu shows every one side by side, a name
//     under each opening that one (decision 「[REMOTE] 개발 - 여러 화면 보기」 1C 2A). "All Computers" goes back.
// The page also holds the WebRTC connections (./peer), which is why the window is made at launch and only hidden.
//   - "This Mac" at the bottom of the grid opens this Mac's page: its permissions, the See This and Click and Type
//     switches, Disconnect, the connection log and the two general settings (decision 「[REMOTE] 메뉴 막대 패널 정리」
//     1C: there is no tray panel). While someone is watching, a bar with Disconnect sits on top of the grid.
// On Windows and Linux it says Remote works on macOS only for now.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  Laptop,
  Maximize,
  Minimize,
  Monitor,
  Pin,
  PinOff,
  Scan,
  Settings,
  Shrink,
  Type,
} from "lucide-react";
import { AccountButton, SignInSheet, type CodePurpose, type SignMode } from "./runners-account/runners-account";
import { locale, statusText, t } from "./i18n";
import { keyInput } from "./keys";
import * as native from "./native";
import * as peer from "./peer";
import type { Computer, Display, Input, Link, PeerInfo, Status } from "./native";
import "./App.css";
import "./runners-account/runners-window.css";
import "./Viewer.css";

const RETRY_MS = 1000;
const STATUS_EVERY_MS = 2000;
/** How often each tile of the grid gets a new picture, and how wide that picture is asked for (twice the tile). */
const TILE_MS = 2000;
const TILE_WIDTH = 480;

/** Mouse and keys sent to another computer: moves at most every MOVE_MS, a press within DRAG_PX of the last one and
 *  DOUBLE_MS after it is a double click, farther than DRAG_PX with the button held is a drag, wheel turns are gathered
 *  for SCROLL_MS (a line counts LINE_PX), and the copied text is fetched COPY_WAIT_MS after Command-C. */
const MOVE_MS = 30;
const DRAG_PX = 4;
const DOUBLE_MS = 500;
const SCROLL_MS = 40;
const LINE_PX = 16;
const COPY_WAIT_MS = 300;
const NOTE_MS = 3000;
/** macOS key codes of V, C and X (keys.ts). */
const KEY_V = 9;
const KEY_C = 8;
const KEY_X = 7;

/** The floating bar hides BAR_MS after the pointer leaves it while the mouse goes to that computer, and comes back
 *  when the pointer is within BAR_ZONE_PX of the top. */
const BAR_MS = 2500;
const BAR_ZONE_PX = 56;

type Shortcut = { key: "switchApp" | "spotlight" | "forceQuit" | "lock" | "screenshot"; label: string; code: number; modifiers: ("shift" | "control" | "option" | "command")[] };

/** Shortcuts the floating bar sends that this computer would take for itself (macOS key codes, keys.ts), by the system
 *  of the computer on screen. A Windows or Linux computer turns option into Alt and control into Ctrl. Why fewer there:
 *  locking and the screenshot tool need the Windows key, which a program cannot press on Windows. */
const SHORTCUTS: Record<NonNullable<PeerInfo["system"]>, Shortcut[]> = {
  mac: [
    { key: "switchApp", label: "⌘⇥", code: 48, modifiers: ["command"] },
    { key: "spotlight", label: "⌘Space", code: 49, modifiers: ["command"] },
    { key: "forceQuit", label: "⌥⌘Esc", code: 53, modifiers: ["option", "command"] },
    { key: "lock", label: "⌃⌘Q", code: 12, modifiers: ["control", "command"] },
    { key: "screenshot", label: "⌘⇧4", code: 21, modifiers: ["shift", "command"] },
  ],
  windows: [
    { key: "switchApp", label: "Alt+Tab", code: 48, modifiers: ["option"] },
    { key: "forceQuit", label: "Ctrl+Shift+Esc", code: 53, modifiers: ["control", "shift"] },
  ],
  linux: [{ key: "switchApp", label: "Alt+Tab", code: 48, modifiers: ["option"] }],
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (native.page === "viewer") peer.startPeers();

/** Why another computer cannot be seen right now, from what it says about itself, or null when it can. */
function peerProblem(info: PeerInfo): string | null {
  if (info.viewing) return null;
  if (info.reason === "screenRecording") return t("peer.noPermission");
  if (info.reason === "platform") return t("status.note.platform");
  return t("peer.off");
}

/** Gives the sign-in sheet the bare code (`bad`, `none`, …) without the IPC words around it. */
function rethrowCode(error: unknown): never {
  throw new Error(native.errorCode(error));
}

/** Turns the short error codes from another computer into a sentence. */
function captureError(error: unknown): string {
  const code = native.errorCode(error);
  if (code === "permission") return t("peer.noPermission");
  if (code === "display") return t("view.noDisplay");
  if (code === "unsupported") return t("status.note.platform");
  if (code === "off") return t("peer.off");
  if (code === "unreachable") return t("peer.unreachable");
  return t("view.failed", { error: code });
}

function inputError(error: unknown): string {
  const code = native.errorCode(error);
  if (code === "accessibility") return t("peer.noAccessibility");
  if (code === "control") return t("peer.noControl");
  if (code === "off") return t("peer.off");
  if (code === "unreachable") return t("peer.unreachable");
  return t("clickTest.failed", { error: code });
}

function displayLabel(display: Display, index: number): string {
  return display.name || t("display.fallback", { n: index + 1 });
}

/** Keeps one object URL for the latest picture, freeing the one before. */
function usePicture(): [string | null, (bytes: Uint8Array | null) => void] {
  const [url, setUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const set = useCallback((bytes: Uint8Array | null) => {
    const next = bytes ? URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" })) : null;
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = next;
    setUrl(next);
  }, []);
  useEffect(() => () => {
    if (current.current) URL.revokeObjectURL(current.current);
  }, []);
  return [url, set];
}

export default function Viewer() {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  // Why not just false: the window is made hidden at launch (it holds the connections) and says when it is shown, but
  // a window opened at once is shown before this page listens, so the page also starts from whether it is seen now.
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  /** The computer opened from the grid, or null for the grid. */
  const [computer, setComputer] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const closeSignIn = useCallback(() => setSigningIn(false), []);
  // The shared sheet reads the failure's short code (bad, exists) from the error's message.
  const signIn = useCallback(
    (mode: SignMode, email: string, password: string, code?: string) =>
      native.signIn(mode, email, password, code).then(setLink, rethrowCode),
    [],
  );
  const sendCode = useCallback(
    (purpose: CodePurpose, email: string) => native.sendCode(purpose, email).catch(rethrowCode),
    [],
  );
  const resetPassword = useCallback(
    (email: string, code: string, password: string) =>
      native.resetPassword(email, code, password).then(setLink, rethrowCode),
    [],
  );

  useEffect(() => native.onOpenComputer(setComputer), []);

  // Why: closing the window only hides it, so pictures stop while it is hidden and start again when shown.
  useEffect(() => native.onViewerVisible(setVisible), []);

  useEffect(() => {
    if (!visible) return;
    const check = () => {
      void native.status().then(setStatus);
      void native.link().then(setLink);
    };
    check();
    const timer = setInterval(check, STATUS_EVERY_MS);
    return () => clearInterval(timer);
  }, [visible]);

  const supported = status?.supported ?? true;
  const computers = link?.computers ?? [];
  const opened = computers.find((c) => c.host === computer);
  // Why remember: a computer that goes off leaves the list, and its page should still say its name, not its device id.
  const names = useRef(new Map<string, string>());
  for (const c of computers) names.current.set(c.host, c.name);

  if (!supported) {
    return (
      <main className="viewer-window">
        <header>
          <div className="title">{status?.computer}</div>
        </header>
        <section className="card">
          <div className="notice">{t("status.note.platform")}</div>
        </section>
      </main>
    );
  }

  if (computer !== null) {
    return (
      <Detail
        host={computer}
        name={opened?.name ?? names.current.get(computer) ?? computer}
        online={opened !== undefined}
        visible={visible}
        onBack={() => setComputer(null)}
      />
    );
  }

  const signedOut = link?.state === "signedOut";
  return (
    <main className="viewer-window">
      <header className="window-head">
        <div className="window-head-text">
          <div className="title">{t("grid.title")}</div>
          {/* Why only with computers: signed out, the card below says the same; with none, LinkNote says why. */}
          {computers.length > 0 && <div className="subtitle">{t("grid.subtitle", { count: computers.length })}</div>}
        </div>
        {link?.account && (
          <AccountButton
            lang={locale}
            account={link.account}
            line={
              <>
                <span className={`state-dot ${link.state === "running" ? "waiting" : ""}`} aria-hidden />
                {link.state === "running"
                  ? t("account.online", { count: link.computers.filter((c) => c.online).length })
                  : t("link.starting")}
              </>
            }
            items={[
              {
                label: t("account.thisMac"),
                icon: <Settings size={16} strokeWidth={1.5} aria-hidden />,
                onSelect: () => native.openSettings("mac"),
              },
            ]}
            onSignOut={() => void native.signOut().then(setLink)}
          />
        )}
      </header>
      {status && status.viewers.length > 0 && (
        <div className="watching">
          <span className="state-dot viewing" aria-hidden />
          <span>{t("status.viewers", { names: status.viewers.join(", ") })}</span>
          <button type="button" className="button" onClick={() => void native.disconnect().then(setLink)}>
            {t("menu.disconnect")}
          </button>
        </div>
      )}
      {signedOut ? (
        <section className="card signed-out">
          <Laptop size={28} strokeWidth={1.25} aria-hidden />
          <div className="switch-label">{t("account.emptyTitle")}</div>
          <div className="hint">{t("account.intro")}</div>
          <button type="button" className="rw-button default" onClick={() => setSigningIn(true)}>
            {t("account.signIn")}
          </button>
        </section>
      ) : (
        <LinkNote link={link} />
      )}
      {computers.length > 0 && (
        <div className="grid-scroll">
          <section className="grid" aria-label={t("grid.title")}>
            {computers.map((c) => (
              <Tile key={c.host} computer={c} visible={visible} onOpen={() => setComputer(c.host)} />
            ))}
          </section>
        </div>
      )}
      {status && (
        <button type="button" className="card this-mac" onClick={() => native.openSettings("mac")}>
          <Laptop size={16} strokeWidth={1.5} aria-hidden />
          <span className="this-mac-text">
            <span className="switch-label">
              {t("thisMac.title")} · {status.computer}
            </span>
            <span className="hint">
              <span className={`state-dot ${status.state}`} aria-hidden /> {statusText(status.state, status.reason)}
            </span>
          </span>
          <span className="hint this-mac-summary" title={t("thisMac.summary")}>
            {t("thisMac.summary")}
          </span>
          <ChevronLeft className="flip" size={14} strokeWidth={1.5} aria-hidden />
        </button>
      )}
      {signingIn && (
        <SignInSheet
          lang={locale}
          signIn={signIn}
          sendCode={sendCode}
          resetPassword={resetPassword}
          onClose={closeSignIn}
        />
      )}
    </main>
  );
}

/** One computer in the grid: a small picture of its main display, its name, and a word when it cannot be seen. */
function Tile({ computer, visible, onOpen }: { computer: Computer; visible: boolean; onOpen: () => void }) {
  const [info, setInfo] = useState<PeerInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picture, setPicture] = usePicture();
  /** Remote is on there (the relay lists it) but no connection opened; pressing the tile tries again at once. */
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!visible || !computer.online) return;
    let running = true;
    void (async () => {
      while (running) {
        try {
          const now = (await peer.ask(computer.host, "info")) as PeerInfo;
          if (!running) break;
          setInfo(now);
          const why = peerProblem(now);
          const main = now.displays.find((d) => d.main) ?? now.displays[0];
          if (why || !main) {
            setProblem(why ?? t("view.noDisplay"));
            setPicture(null);
          } else {
            const bytes = await peer.frame(computer.host, main.id, TILE_WIDTH);
            if (!running) break;
            setPicture(bytes);
            setProblem(null);
          }
          setUnreachable(false);
        } catch (error) {
          if (!running) break;
          setProblem(captureError(error));
          setUnreachable(native.errorCode(error) === "unreachable");
          setPicture(null);
        }
        await wait(TILE_MS);
      }
    })();
    return () => {
      running = false;
    };
  }, [visible, computer.host, computer.online, setPicture, attempt]);

  const shown = computer.online ? problem : t("computer.offlineNote");
  const retry = () => {
    setProblem(null);
    setUnreachable(false);
    setAttempt((n) => n + 1);
  };
  const monitors = info?.displays.length ?? 0;
  return (
    <button type="button" className="tile" disabled={!computer.online} onClick={computer.online && unreachable ? retry : onOpen}>
      <div className="tile-screen">
        {picture && !shown ? (
          <img src={picture} alt="" draggable={false} />
        ) : (
          <div className="empty">
            {shown ?? t("view.loading")}
            {computer.online && unreachable && <span className="tile-retry">{t("session.retry")}</span>}
          </div>
        )}
      </div>
      <div className="tile-label">
        <span className={computer.online ? "state-dot waiting" : "state-dot"} aria-hidden />
        <span className="tile-name">{computer.name}</span>
        {monitors > 1 && <span className="tab-badge">{t("grid.monitors", { count: monitors })}</span>}
      </div>
    </button>
  );
}

/** Where a pointer is on the picture, as fractions; null outside it unless `clamp` (a drag may leave the picture). */
function spotOn(
  element: HTMLVideoElement | null,
  clientX: number,
  clientY: number,
  clamp: boolean,
): { x: number; y: number } | null {
  if (!element?.videoWidth) return null;
  // Why: the video may sit letterboxed inside its box, so the spot is measured on the picture itself.
  const box = element.getBoundingClientRect();
  const scale = Math.min(box.width / element.videoWidth, box.height / element.videoHeight);
  const width = element.videoWidth * scale;
  const height = element.videoHeight * scale;
  const x = (clientX - box.left - (box.width - width) / 2) / width;
  const y = (clientY - box.top - (box.height - height) / 2) / height;
  if (clamp) return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}

/** One computer opened from the grid: its displays as tabs, the screen, and sending clicks, keys and text. */
function Detail(props: { host: string; name: string; online: boolean; visible: boolean; onBack: () => void }) {
  const { host, name, online, visible, onBack } = props;
  const [info, setInfo] = useState<PeerInfo | null>(null);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  /** Every display side by side instead of the chosen one, each its own video. */
  const [all, setAll] = useState(false);
  const [allStreams, setAllStreams] = useState<MediaStream[]>([]);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** Clicks and keys always go there once that computer lets them (it has macOS Accessibility on); there is no switch. */
  const sendClicks = info?.control ?? false;
  const [clickError, setClickError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  /** What the input method is putting together (a Korean syllable), shown over the picture until it is sent. */
  const [composing, setComposing] = useState("");
  /** The hidden key box has focus, so keys go to that computer. */
  const [typing, setTyping] = useState(false);
  const [actual, setActual] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const screenBox = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  /** Inputs go out in this order; a paste waits here until the copied text has arrived there. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** The button held down on the picture, and whether it has moved far enough to be a drag. */
  const pressed = useRef<{ button: "left" | "right"; count: number; clientX: number; clientY: number; dragging: boolean } | null>(null);
  /** The last press, to tell the second press of a double click. */
  const lastPress = useRef<{ at: number; clientX: number; clientY: number; button: "left" | "right"; count: number } | null>(null);
  const lastMove = useRef(0);
  /** Which menu of the floating bar is open, whether the bar is out, and a new try after a failure. */
  const [menu, setMenu] = useState<"displays" | "keys" | "text" | null>(null);
  const [barAwake, setBarAwake] = useState(true);
  const barTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Pinned, the bar stays out (Windows App users complained of a bar that keeps sliding in and out). */
  const [pinned, setPinned] = useState(false);

  const loadDisplays = useCallback(async () => {
    let list: Display[] = [];
    try {
      const now = (await peer.ask(host, "info")) as PeerInfo;
      setInfo(now);
      list = now.displays;
      setProblem(peerProblem(now));
    } catch (error) {
      setInfo(null);
      setProblem(captureError(error));
    }
    setDisplays(list);
    setChosen((current) => (current !== null && list.some((d) => d.id === current) ? current : (list[0]?.id ?? null)));
  }, [host]);

  /** The connection the video came over; a new one (the other side dropped it) means asking for the video again. */
  const [serial, setSerial] = useState(0);

  // Why ask again every few seconds: the other computer can turn seeing off or go away at any time, and the video by
  // itself would just stop on its last picture.
  useEffect(() => {
    if (!visible) return;
    if (!online) {
      // Why: the relay already said it left, so nobody waits for a connection that cannot come.
      setInfo(null);
      setProblem(t("computer.offlineNote"));
      return;
    }
    const check = () => void loadDisplays().then(() => setSerial(peer.serial(host)));
    check();
    const timer = setInterval(check, STATUS_EVERY_MS);
    return () => clearInterval(timer);
  }, [visible, online, loadDisplays, host, attempt]);

  const viewable = online && (info?.viewing ?? false);

  // The video: asked for once per display; the other computer sends only what changes. The first picture drawn shows
  // it. A failed start is tried again after a moment.
  // Side by side, every display comes on its own video line; a computer whose Remote is older answers with an unknown
  // method, and the viewer goes back to one display with a note saying why.
  const displayIds = displays.map((d) => d.id).join(",");
  useEffect(() => {
    if (!visible || !all || !viewable || displayIds === "") return;
    let running = true;
    setPlaying(false);
    void (async () => {
      while (running) {
        try {
          const streams = await peer.watchAll(host, displayIds.split(",").map(Number));
          if (!running) break;
          setAllStreams(streams);
          setPlaying(true);
          setProblem(null);
          break;
        } catch (error) {
          if (!running) break;
          if (error instanceof Error && error.message.startsWith("unknown method")) {
            setAll(false);
            setNote(t("display.allOld"));
            break;
          }
          setProblem(captureError(error));
          await wait(RETRY_MS);
        }
      }
    })();
    return () => {
      running = false;
      setAllStreams([]);
      void peer.unwatch(host);
    };
  }, [visible, all, host, viewable, displayIds, serial, attempt]);

  useEffect(() => {
    if (!visible || chosen === null || !viewable || all) return;
    let running = true;
    let counter = 0;
    setPlaying(false);
    const drawn = () => {
      if (running) setPlaying(true);
    };
    void (async () => {
      while (running) {
        try {
          const stream = await peer.watch(host, chosen);
          if (!running) break;
          const element = video.current;
          if (element) {
            element.srcObject = stream;
            void element.play().catch(() => undefined);
            counter = element.requestVideoFrameCallback(drawn);
          }
          setProblem(null);
          break;
        } catch (error) {
          if (!running) break;
          setProblem(captureError(error));
          await wait(RETRY_MS);
        }
      }
    })();
    return () => {
      running = false;
      video.current?.cancelVideoFrameCallback(counter);
      void peer.unwatch(host);
    };
  }, [visible, chosen, host, viewable, all, serial, attempt]);

  useEffect(() => setClickError(null), [sendClicks]);

  /** Sends one input, after anything still waiting in `queue` (a paste first puts the copied text there). The reply is
   *  not waited for, so a drag never lags behind the replies. */
  const post = useCallback(
    (input: Input) => {
      queue.current = queue.current.then(() => {
        void peer
          .ask(host, "input", { input })
          .then(() => setClickError(null))
          .catch((error) => setClickError(inputError(error)));
      });
    },
    [host],
  );

  // The mouse (decision 「[REMOTE] 개발 - 원격 기능 넓히기」 2A): the button goes down and up there as it does here, so a
  // click, a double click, a right click and a drag all happen as made. Moves are sent at most every MOVE_MS.
  const onPointerDown = (event: PointerEvent<HTMLVideoElement>) => {
    if (!sendClicks || chosen === null || (event.button !== 0 && event.button !== 2)) return;
    const at = spotOn(video.current, event.clientX, event.clientY, false);
    if (!at) return;
    event.preventDefault();
    keys.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const button = event.button === 2 ? "right" : "left";
    const last = lastPress.current;
    const again =
      last &&
      last.button === button &&
      event.timeStamp - last.at < DOUBLE_MS &&
      Math.hypot(event.clientX - last.clientX, event.clientY - last.clientY) < DRAG_PX;
    const count = again ? Math.min(last.count + 1, 3) : 1;
    lastPress.current = { at: event.timeStamp, clientX: event.clientX, clientY: event.clientY, button, count };
    pressed.current = { button, count, clientX: event.clientX, clientY: event.clientY, dragging: false };
    post({ kind: "press", display: chosen, ...at, button, down: true, count });
  };

  const onPointerMove = (event: PointerEvent<HTMLVideoElement>) => {
    if (!sendClicks || chosen === null || event.timeStamp - lastMove.current < MOVE_MS) return;
    const held = pressed.current;
    if (held) {
      if (!held.dragging && Math.hypot(event.clientX - held.clientX, event.clientY - held.clientY) < DRAG_PX) return;
      held.dragging = true;
      const at = spotOn(video.current, event.clientX, event.clientY, true);
      if (!at) return;
      lastMove.current = event.timeStamp;
      post({ kind: "drag", display: chosen, ...at, button: held.button });
      return;
    }
    const at = spotOn(video.current, event.clientX, event.clientY, false);
    if (!at) return;
    lastMove.current = event.timeStamp;
    post({ kind: "move", display: chosen, ...at });
  };

  const onPointerUp = (event: PointerEvent<HTMLVideoElement>) => {
    const held = pressed.current;
    if (!held || chosen === null) return;
    pressed.current = null;
    const at = spotOn(video.current, event.clientX, event.clientY, true);
    if (at) post({ kind: "press", display: chosen, ...at, button: held.button, down: false, count: held.count });
  };

  // Scrolling: gathered for SCROLL_MS and sent as one, at the spot. Why a listener of its own: React's wheel listener
  // cannot stop the box itself from scrolling at original size.
  useEffect(() => {
    const element = video.current;
    if (!element || !sendClicks || chosen === null) return;
    let dx = 0;
    let dy = 0;
    let where: { x: number; y: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (event: WheelEvent) => {
      const at = spotOn(video.current, event.clientX, event.clientY, false);
      if (!at) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? element.clientHeight : 1;
      dx += event.deltaX * unit;
      dy += event.deltaY * unit;
      where = at;
      timer ??= setTimeout(() => {
        timer = null;
        if (where && (Math.round(dx) || Math.round(dy))) {
          post({ kind: "scroll", display: chosen, ...where, dx: Math.round(dx), dy: Math.round(dy) });
        }
        dx = 0;
        dy = 0;
      }, SCROLL_MS);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      if (timer) clearTimeout(timer);
    };
  }, [sendClicks, chosen, post]);

  // While keys go there, this window's own menu shortcuts stand aside, so Command-C, Command-V and the rest reach it.
  useEffect(() => {
    native.keysToPeer(sendClicks && typing);
    return () => native.keysToPeer(false);
  }, [sendClicks, typing]);

  // Keys (2B): shortcuts and keys like Return go as keys; letters, accents and Korean are left to the hidden box below,
  // whose input method puts the syllables together here, and each finished piece is sent as text.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!sendClicks || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const input = keyInput(event.nativeEvent);
    if (!input || input.kind !== "key") return;
    event.preventDefault();
    const command = input.modifiers.length === 1 && input.modifiers[0] === "command";
    // Copy and paste (2C): Command-V first puts the text copied here on that computer; after Command-C or Command-X
    // the text copied there is brought here.
    if (command && input.code === KEY_V) {
      queue.current = queue.current
        .then(async () => peer.ask(host, "clipboardSet", { text: await native.readClipboard() }))
        .catch((error) => setClickError(inputError(error)));
    }
    post(input);
    if (command && (input.code === KEY_C || input.code === KEY_X)) {
      queue.current = queue.current
        .then(() => wait(COPY_WAIT_MS))
        .then(() => peer.ask(host, "clipboardGet"))
        .then((text) => native.writeClipboard(String(text ?? "")))
        .then(() => setNote(t("peer.copied")))
        .catch((error) => setClickError(inputError(error)));
    }
  };

  const onTyped = (event: FormEvent<HTMLTextAreaElement>) => {
    const typed = event.nativeEvent as InputEvent;
    if (typed.isComposing) return;
    if (sendClicks && typed.inputType === "insertText" && typed.data) post({ kind: "text", text: typed.data });
    event.currentTarget.value = "";
  };

  const onComposed = (event: CompositionEvent<HTMLTextAreaElement>) => {
    setComposing("");
    if (sendClicks && event.data) post({ kind: "text", text: event.data });
  };

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  // Fullscreen and original size (2D). Esc leaves fullscreen and is not sent.
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void screenBox.current?.requestFullscreen().then(() => keys.current?.focus());
  };

  const sendText = (event: FormEvent) => {
    event.preventDefault();
    if (!text) return;
    peer
      .ask(host, "input", { input: { kind: "text", text } satisfies Input })
      .then(() => {
        setText("");
        setClickError(null);
      })
      .catch((error) => setClickError(inputError(error)));
  };

  const display = displays.find((d) => d.id === chosen);
  const at = displays.findIndex((d) => d.id === chosen);
  const previous = displays.length > 1 ? displays[(at - 1 + displays.length) % displays.length] : null;
  const next = displays.length > 1 ? displays[(at + 1) % displays.length] : null;
  const shown = playing && problem === null;
  const showOne = (id: number) => {
    setAll(false);
    setChosen(id);
  };

  const sendShortcut = (code: number, modifiers: ("shift" | "control" | "option" | "command")[]) => {
    setMenu(null);
    post({ kind: "key", code, modifiers });
    keys.current?.focus();
  };

  // The floating bar (like Chrome Remote Desktop and Zoom): always there until the mouse goes to that computer, then it
  // slides up after BAR_MS and comes back when the pointer nears the top edge.
  const wake = useCallback(() => {
    setBarAwake(true);
    if (barTimer.current) clearTimeout(barTimer.current);
    barTimer.current = setTimeout(() => setBarAwake(false), BAR_MS);
  }, []);
  useEffect(() => () => {
    if (barTimer.current) clearTimeout(barTimer.current);
  }, []);
  const barHidden = sendClicks && shown && !barAwake && !pinned && menu === null;

  return (
    <main className="viewer-window session">
      <div
        ref={screenBox}
        className={actual ? "screen-box actual" : "screen-box"}
        onPointerMove={(event) => {
          const top = event.currentTarget.getBoundingClientRect().top;
          if (event.clientY - top < BAR_ZONE_PX) wake();
        }}
      >
        <video
          ref={video}
          className={sendClicks ? "screen clickable" : "screen"}
          style={actual && display ? { width: display.width } : undefined}
          hidden={!shown || all}
          aria-label={display ? displayLabel(display, displays.indexOf(display)) : ""}
          muted
          playsInline
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(event) => event.preventDefault()}
        />
        {all && shown && <AllScreens displays={displays} streams={allStreams} onPick={showOne} />}
        {!all && shown && previous && next && (
          <>
            <button
              type="button"
              className="edge-arrow left"
              title={displayLabel(previous, displays.indexOf(previous))}
              aria-label={displayLabel(previous, displays.indexOf(previous))}
              onClick={() => setChosen(previous.id)}
            >
              <ChevronLeft size={22} strokeWidth={1.5} aria-hidden />
            </button>
            <button
              type="button"
              className="edge-arrow right"
              title={displayLabel(next, displays.indexOf(next))}
              aria-label={displayLabel(next, displays.indexOf(next))}
              onClick={() => setChosen(next.id)}
            >
              <ChevronRight size={22} strokeWidth={1.5} aria-hidden />
            </button>
            <div className="edge-dots" aria-hidden>
              {displays.map((d) => (
                <span key={d.id} className={d.id === chosen ? "on" : ""} />
              ))}
            </div>
          </>
        )}
        {!shown && (
          <div className="session-state">
            {problem === null ? (
              <>
                <span className="spinner" aria-hidden />
                <div className="session-state-title">{t("session.connecting", { name })}</div>
              </>
            ) : (
              <>
                <div className="session-state-title">{t("session.cannotSee", { name })}</div>
                <div className="hint">{problem}</div>
                <div className="session-state-buttons">
                  <button type="button" className="rw-button" onClick={onBack}>
                    {t("grid.back")}
                  </button>
                  <button type="button" className="rw-button default" onClick={() => setAttempt((n) => n + 1)}>
                    {t("session.retry")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <textarea
          ref={keys}
          className="key-catcher"
          aria-label={t("clickTest.label")}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          onInput={onTyped}
          onCompositionUpdate={(event) => setComposing(event.data)}
          onCompositionEnd={onComposed}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
        />
        {composing && <div className="composing">{composing}</div>}

        <div className={barHidden ? "float-bar hidden" : "float-bar"} onPointerEnter={wake} onPointerMove={wake}>
          <button type="button" className="bar-button" title={t("grid.back")} aria-label={t("grid.back")} onClick={onBack}>
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
          </button>
          <span className="bar-name">
            <span className={shown ? "state-dot waiting" : "state-dot"} aria-hidden />
            {name}
          </span>
          <span className="bar-sep" />
          <div className="bar-menu-box">
            <button
              type="button"
              className="bar-button wide"
              disabled={displays.length === 0}
              aria-haspopup="menu"
              onClick={() => setMenu(menu === "displays" ? null : "displays")}
            >
              <Monitor size={16} strokeWidth={1.5} aria-hidden />
              <span>
                {all
                  ? t("display.allTitle", { n: displays.length })
                  : display
                    ? displayLabel(display, displays.indexOf(display))
                    : t("display.title")}
              </span>
              <ChevronDown size={12} strokeWidth={1.5} aria-hidden />
            </button>
            {menu === "displays" && (
              <div className="bar-menu" role="menu">
                {displays.length > 1 && (
                  <>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={all}
                      className="bar-menu-item"
                      onClick={() => {
                        setActual(false);
                        setAll(true);
                        setMenu(null);
                      }}
                    >
                      <Check size={14} strokeWidth={2} className={all ? "" : "invisible"} aria-hidden />
                      <span>{t("display.all")}</span>
                      <span className="hint">{t("display.allHint", { n: displays.length })}</span>
                    </button>
                    <div className="bar-menu-sep" />
                  </>
                )}
                {displays.map((d, index) => (
                  <button
                    key={d.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={!all && d.id === chosen}
                    className="bar-menu-item"
                    onClick={() => {
                      showOne(d.id);
                      setMenu(null);
                    }}
                  >
                    <Check size={14} strokeWidth={2} className={!all && d.id === chosen ? "" : "invisible"} aria-hidden />
                    <span>{displayLabel(d, index)}</span>
                    <span className="hint">
                      {d.main ? `${t("display.main")} · ` : ""}
                      {t("display.size", { width: d.width, height: d.height })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="bar-sep" />
          <div className="bar-menu-box">
            <button
              type="button"
              className="bar-button"
              disabled={!sendClicks}
              title={t("session.keys")}
              aria-label={t("session.keys")}
              aria-haspopup="menu"
              onClick={() => setMenu(menu === "keys" ? null : "keys")}
            >
              <Command size={16} strokeWidth={1.5} aria-hidden />
            </button>
            {menu === "keys" && (
              <div className="bar-menu" role="menu">
                {SHORTCUTS[info?.system ?? "mac"].map((s) => (
                  <button key={s.key} type="button" role="menuitem" className="bar-menu-item" onClick={() => sendShortcut(s.code, s.modifiers)}>
                    <span className="invisible" />
                    <span>{t(`session.key.${s.key}`)}</span>
                    <span className="hint keycap">{s.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="bar-menu-box">
            <button
              type="button"
              className="bar-button"
              disabled={!sendClicks}
              title={t("session.typeText")}
              aria-label={t("session.typeText")}
              onClick={() => setMenu(menu === "text" ? null : "text")}
            >
              <Type size={16} strokeWidth={1.5} aria-hidden />
            </button>
            {menu === "text" && (
              <form className="bar-menu text-menu" onSubmit={sendText}>
                <div className="hint">{t("session.typeTextNote")}</div>
                <div className="type-row">
                  <input
                    className="type-box"
                    autoFocus
                    value={text}
                    placeholder={t("peer.textPlaceholder")}
                    onChange={(event) => setText(event.target.value)}
                  />
                  <button className="rw-button default" type="submit" disabled={!text}>
                    {t("peer.textSend")}
                  </button>
                </div>
              </form>
            )}
          </div>
          <span className="bar-sep" />
          <button
            type="button"
            className="bar-button"
            disabled={!shown}
            title={actual ? t("view.fitSize") : t("view.actualSize")}
            aria-label={actual ? t("view.fitSize") : t("view.actualSize")}
            onClick={() => setActual(!actual)}
          >
            {actual ? <Shrink size={16} strokeWidth={1.5} aria-hidden /> : <Scan size={16} strokeWidth={1.5} aria-hidden />}
          </button>
          <button
            type="button"
            className="bar-button"
            disabled={!shown}
            title={fullscreen ? t("view.exitFullscreen") : t("view.fullscreen")}
            aria-label={fullscreen ? t("view.exitFullscreen") : t("view.fullscreen")}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize size={16} strokeWidth={1.5} aria-hidden /> : <Maximize size={16} strokeWidth={1.5} aria-hidden />}
          </button>
          <button
            type="button"
            className={pinned ? "bar-button on" : "bar-button"}
            title={t(pinned ? "session.unpin" : "session.pin")}
            aria-label={t(pinned ? "session.unpin" : "session.pin")}
            aria-pressed={pinned}
            onClick={() => setPinned(!pinned)}
          >
            {pinned ? <PinOff size={16} strokeWidth={1.5} aria-hidden /> : <Pin size={16} strokeWidth={1.5} aria-hidden />}
          </button>
          <span className="bar-sep" />
          <button type="button" className="bar-button end" onClick={onBack}>
            <span>{t("session.end")}</span>
          </button>
        </div>

        {(clickError || note || (shown && !sendClicks)) && (
          <div className={clickError ? "session-note error" : "session-note"}>{clickError ?? note ?? t("peer.noControl")}</div>
        )}
      </div>
    </main>
  );
}

/** Every display of that computer side by side at its own shape, each its own video; the name under one opens it alone
 *  (decision 2A: pressing a small picture does not click there). Displays beyond the video lines are left out. */
function AllScreens(props: { displays: Display[]; streams: MediaStream[]; onPick: (id: number) => void }) {
  return (
    <div className="all-screens">
      {props.displays.slice(0, props.streams.length).map((d, index) => (
        <figure key={d.id} className="all-screen" style={{ flex: d.width / d.height }}>
          <video
            className="screen"
            muted
            playsInline
            autoPlay
            ref={(element) => {
              if (element && element.srcObject !== props.streams[index]) element.srcObject = props.streams[index];
            }}
            onClick={() => props.onPick(d.id)}
          />
          <figcaption>
            <button type="button" className="all-name" onClick={() => props.onPick(d.id)}>
              {displayLabel(d, index)}
            </button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** One line under the title saying how the connection is doing, or why no other computer is listed. */
function LinkNote({ link }: { link: Link | null }) {
  if (!link || link.state === "signedOut") return null;
  if (link.state === "starting") return <div className="hint link-note">{t("link.starting")}</div>;
  if (link.state === "failed" && link.error === "elsewhere") return <div className="hint link-note error">{t("link.elsewhere")}</div>;
  if (link.state === "failed" && link.error === "unreachable") return <div className="hint link-note error">{t("link.unreachable")}</div>;
  if (link.state === "failed") return <div className="hint link-note error">{t("link.failed", { error: link.error ?? "" })}</div>;
  if (link.computers.length === 0) return <div className="hint link-note">{t("link.empty")}</div>;
  return null;
}
