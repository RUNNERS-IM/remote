// The viewer window ("Open Remote"), decision 「[REMOTE] 모든 컴퓨터 한눈에」 1A 2A:
//   - Signed out, it asks for the RUNNERS account first: computers and phones of the same account see each other.
//   - Then every computer of the account that has Remote open, as a grid. Each tile shows a small still picture of
//     that computer's main display, new every two seconds, or why it cannot be seen.
//   - Pressing a tile opens that computer: a tab per display, its screen as WebRTC video, the Send Clicks switch, and
//     keys and text going there. "All Computers" goes back.
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
import type { SignMode } from "../electron/preload/api";
import {
  ChevronLeft,
  Eye,
  Laptop,
  LogOut,
  Maximize,
  Minimize,
  Monitor,
  MousePointerClick,
  Power,
  RefreshCw,
  Scan,
  Shrink,
  type LucideIcon,
} from "lucide-react";
import { statusText, t } from "./i18n";
import { keyInput } from "./keys";
import * as native from "./native";
import * as peer from "./peer";
import type { Computer, Display, Input, Link, LogEntry, MenuState, PeerInfo, PermissionKind, Status } from "./native";
import "./App.css";
import "./runners-window.css";
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (native.page === "viewer") peer.startPeers();

/** Why another computer cannot be seen right now, from what it says about itself, or null when it can. */
function peerProblem(info: PeerInfo): string | null {
  if (info.viewing) return null;
  if (info.reason === "screenRecording") return t("peer.noPermission");
  if (info.reason === "platform") return t("status.note.platform");
  return t("peer.off");
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
  // Why false: the window is made hidden at launch (it holds the connections) and says when it is first shown.
  const [visible, setVisible] = useState(false);
  /** The computer opened from the grid, or null for the grid. */
  const [computer, setComputer] = useState<string | null>(null);
  const [thisMac, setThisMac] = useState(false);

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

  if (thisMac && status && link) {
    return <ThisMac status={status} link={link} onChange={setLink} onBack={() => setThisMac(false)} />;
  }

  if (computer !== null) {
    return (
      <Detail
        host={computer}
        name={opened?.name ?? computer}
        online={opened !== undefined}
        visible={visible}
        onBack={() => setComputer(null)}
      />
    );
  }

  return (
    <main className="viewer-window">
      <header>
        <div className="title">{t("grid.title")}</div>
        <div className="subtitle">{t("grid.subtitle", { count: computers.length })}</div>
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
      <LinkNote link={link} onChange={setLink} />
      {computers.length > 0 && (
        <section className="grid" aria-label={t("grid.title")}>
          {computers.map((c) => (
            <Tile key={c.host} computer={c} visible={visible} onOpen={() => setComputer(c.host)} />
          ))}
        </section>
      )}
      {status && (
        <button type="button" className="card this-mac" onClick={() => setThisMac(true)}>
          <Laptop size={16} strokeWidth={1.5} aria-hidden />
          <span className="this-mac-text">
            <span className="switch-label">
              {t("thisMac.title")} · {status.computer}
            </span>
            <span className="hint">
              <span className={`state-dot ${status.state}`} aria-hidden /> {statusText(status.state, status.reason)}
            </span>
          </span>
          <span className="hint">{t("thisMac.summary")}</span>
          <ChevronLeft className="flip" size={14} strokeWidth={1.5} aria-hidden />
        </button>
      )}
    </main>
  );
}

/** One computer in the grid: a small picture of its main display, its name, and a word when it cannot be seen. */
function Tile({ computer, visible, onOpen }: { computer: Computer; visible: boolean; onOpen: () => void }) {
  const [info, setInfo] = useState<PeerInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picture, setPicture] = usePicture();

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
        } catch (error) {
          if (!running) break;
          setProblem(captureError(error));
          setPicture(null);
        }
        await wait(TILE_MS);
      }
    })();
    return () => {
      running = false;
    };
  }, [visible, computer.host, computer.online, setPicture]);

  const shown = computer.online ? problem : t("computer.offline");
  const monitors = info?.displays.length ?? 0;
  return (
    <button type="button" className="tile" disabled={!computer.online} onClick={onOpen}>
      <div className="tile-screen">
        {picture && !shown ? (
          <img src={picture} alt="" draggable={false} />
        ) : (
          <div className="empty">{shown ?? t("view.loading")}</div>
        )}
      </div>
      <div className="tile-label">
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
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [sendClicks, setSendClicks] = useState(false);
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
    if (!visible) {
      // Why: the main process turns sending off when the window hides; the switch shows the same.
      setSendClicks(false);
      return;
    }
    if (!online) {
      // Why: the relay already said it left, so nobody waits for a connection that cannot come.
      setInfo(null);
      setProblem(t("computer.offline"));
      return;
    }
    const check = () => void loadDisplays().then(() => setSerial(peer.serial(host)));
    check();
    const timer = setInterval(check, STATUS_EVERY_MS);
    return () => clearInterval(timer);
  }, [visible, online, loadDisplays, host]);

  const viewable = online && (info?.viewing ?? false);

  // The video: asked for once per display; the other computer sends only what changes. Pictures a second are counted
  // as they are drawn. A failed start is tried again after a moment.
  useEffect(() => {
    if (!visible || chosen === null || !viewable) return;
    let running = true;
    let counter = 0;
    const times: number[] = [];
    setPlaying(false);
    const count = () => {
      const element = video.current;
      if (!running || !element) return;
      times.push(performance.now());
      while (times.length > 0 && times[0] < performance.now() - 2000) times.shift();
      setFps(Math.round(times.length / 2));
      setPlaying(true);
      counter = element.requestVideoFrameCallback(count);
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
            counter = element.requestVideoFrameCallback(count);
          }
          setProblem(null);
          break;
        } catch (error) {
          if (!running) break;
          setProblem(captureError(error));
          setFps(0);
          await wait(RETRY_MS);
        }
      }
    })();
    return () => {
      running = false;
      video.current?.cancelVideoFrameCallback(counter);
      void peer.unwatch(host);
    };
  }, [visible, chosen, host, viewable, serial]);

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
  const canClick = info?.control ?? false;
  const shown = playing && problem === null;

  return (
    <main className="viewer-window">
      <header>
        <button type="button" className="button back" onClick={onBack}>
          <ChevronLeft size={14} strokeWidth={1.5} aria-hidden />
          <span>{t("grid.back")}</span>
        </button>
        <div className="title">{name}</div>
        <div className="subtitle">{t("window.subtitlePeer")}</div>
      </header>

      <section className="viewer-section">
        <h2 className="section-head">{t("display.title")}</h2>
        <div className="tabs" role="tablist" aria-label={t("display.title")}>
          {displays.map((d, index) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={d.id === chosen}
              className={d.id === chosen ? "tab chosen" : "tab"}
              onClick={() => setChosen(d.id)}
            >
              <Monitor size={14} strokeWidth={1.5} />
              <span>{displayLabel(d, index)}</span>
              {d.main && <span className="tab-badge">{t("display.main")}</span>}
            </button>
          ))}
        </div>

        <div ref={screenBox} className={actual ? "screen-box card actual" : "screen-box card"}>
          <video
            ref={video}
            className={sendClicks ? "screen clickable" : "screen"}
            style={actual && display ? { width: display.width } : undefined}
            hidden={!shown}
            aria-label={display ? displayLabel(display, displays.indexOf(display)) : ""}
            muted
            playsInline
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(event) => event.preventDefault()}
          />
          {!shown && <div className="empty">{problem ?? t("view.loading")}</div>}
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
        </div>

        <div className="toolbar">
          <label className={canClick ? "switch" : "switch disabled"}>
            <input
              type="checkbox"
              checked={sendClicks}
              disabled={!canClick}
              onChange={(event) => setSendClicks(event.target.checked)}
            />
            <span className="knob" aria-hidden />
            <span className="switch-text">
              <span className="switch-label">{t("clickTest.label")}</span>
              <span className="hint">{canClick ? t("peer.typeNote") : t("peer.noControl")}</span>
            </span>
          </label>
          <div className="meta">
            {clickError && <span className="error">{clickError}</span>}
            {!clickError && note && <span>{note}</span>}
            {display && <span>{t("display.size", { width: display.width, height: display.height })}</span>}
            {shown && <span>{t("view.rate", { fps })}</span>}
          </div>
          <div className="view-buttons">
            <button type="button" className="button" disabled={!shown} onClick={() => setActual(!actual)}>
              {actual ? <Shrink size={14} strokeWidth={1.5} aria-hidden /> : <Scan size={14} strokeWidth={1.5} aria-hidden />}
              <span>{actual ? t("view.fitSize") : t("view.actualSize")}</span>
            </button>
            <button type="button" className="button" disabled={!shown} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize size={14} strokeWidth={1.5} aria-hidden /> : <Maximize size={14} strokeWidth={1.5} aria-hidden />}
              <span>{fullscreen ? t("view.exitFullscreen") : t("view.fullscreen")}</span>
            </button>
          </div>
        </div>

        {sendClicks && (
          <form className="type-row" onSubmit={sendText}>
            <input
              className="type-box"
              value={text}
              placeholder={t("peer.textPlaceholder")}
              onChange={(event) => setText(event.target.value)}
            />
            <button className="button" type="submit" disabled={!text}>
              {t("peer.textSend")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

/** One line under the title saying how the connection is doing, or why no other computer is listed. */
function LinkNote({ link, onChange }: { link: Link | null; onChange: (link: Link) => void }) {
  if (!link) return null;
  if (link.state === "signedOut") return <SignIn onChange={onChange} />;
  if (link.state === "starting") return <div className="hint link-note">{t("link.starting")}</div>;
  if (link.state === "failed") return <div className="hint link-note error">{t("link.failed", { error: link.error ?? "" })}</div>;
  if (link.computers.length === 0) return <div className="hint link-note">{t("link.empty")}</div>;
  return null;
}

/** The RUNNERS account form: email and password, signing in or making the account. */
function SignIn({ onChange }: { onChange: (link: Link) => void }) {
  const [mode, setMode] = useState<SignMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email || !password || busy) return;
    setBusy(true);
    setProblem(null);
    native
      .signIn(mode, email, password)
      .then((link) => {
        setPassword("");
        onChange(link);
      })
      .catch((error) => {
        const code = native.errorCode(error);
        setProblem(t(code === "bad" || code === "exists" ? `account.${code}` : "account.network"));
      })
      .finally(() => setBusy(false));
  };

  return (
    <form className="card sign-in" onSubmit={submit}>
      <div className="switch-label">{t("account.title")}</div>
      <div className="hint">{t("account.intro")}</div>
      <input
        className="type-box"
        type="email"
        autoComplete="email"
        placeholder={t("account.email")}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <input
        className="type-box"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        placeholder={t("account.password")}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {problem && <div className="hint error">{problem}</div>}
      <div className="sign-in-row">
        <button className="button" type="submit" disabled={!email || !password || busy}>
          {t(mode === "login" ? "account.signIn" : "account.signUp")}
        </button>
        <button className="link-button" type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {t(mode === "login" ? "account.toSignUp" : "account.toSignIn")}
        </button>
      </div>
    </form>
  );
}

/** One on/off line: what it is for (a Lucide icon and a name) on the left, the shared toggle on the right
 *  (decision 「[PROGRAM] 켬 끔 토글」 1B). */
function ToggleRow(props: { icon: LucideIcon; label: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  const Glyph = props.icon;
  return (
    <label className={props.disabled ? "switch toggle-row disabled" : "switch toggle-row"}>
      <Glyph size={16} strokeWidth={1.5} aria-hidden />
      <span className="toggle-name">{props.label}</span>
      <input
        type="checkbox"
        checked={props.on}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="knob" aria-hidden />
    </label>
  );
}

function PermissionRow({ kind, on }: { kind: PermissionKind; on: boolean }) {
  return (
    <div className="permission">
      <span className={on ? "dot on" : "dot off"} aria-hidden />
      <div className="permission-text">
        <div>{t(`permission.${kind}`)}</div>
        <div className="hint">{t(`permission.${kind}Note`)}</div>
      </div>
      {on ? (
        <span className="state">{t("permission.on")}</span>
      ) : (
        <button className="button" onClick={() => void native.requestPermission(kind)}>
          {t("permission.allow")}
        </button>
      )}
    </div>
  );
}

function logLine(entry: LogEntry): string {
  const time = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${time}  ${t(`log.${entry.what}`, { peer: entry.peer })}`;
}

/** This Mac's page: permissions, whether other computers may see and click it, the connection log, and the two
 *  general settings. Everything the tray panel used to hold. */
function ThisMac(props: { status: Status; link: Link; onChange: (link: Link) => void; onBack: () => void }) {
  const { status, link } = props;
  const [menu, setMenu] = useState<MenuState | null>(null);
  useEffect(() => {
    void native.menuState().then(setMenu);
  }, []);
  const toggle = (name: "login" | "autoUpdate") => void native.command(name).then(setMenu);
  const allow = (what: "allowViewing" | "allowControl", on: boolean) => void native.setAllow(what, on).then(props.onChange);

  return (
    <main className="viewer-window scroll">
      <header>
        <button type="button" className="button back" onClick={props.onBack}>
          <ChevronLeft size={14} strokeWidth={1.5} aria-hidden />
          <span>{t("grid.back")}</span>
        </button>
        <div className="title">
          {t("thisMac.title")} · {status.computer}
        </div>
        <div className="subtitle">
          <span className={`state-dot ${status.state}`} aria-hidden /> {statusText(status.state, status.reason)}
        </div>
      </header>

      <section>
        <h2 className="section-head">{t("permission.title")}</h2>
        <div className="card">
          <PermissionRow kind="screenRecording" on={status.permissions.screenRecording} />
          <PermissionRow kind="accessibility" on={status.permissions.accessibility} />
          {!status.permissions.screenRecording && <div className="hint">{t("permission.restartNote")}</div>}
        </div>
      </section>

      {link.account && (
        <section>
          <h2 className="section-head">{t("account.title")}</h2>
          <div className="card account-row">
            <span>{t("account.signedInAs", { email: link.account })}</span>
            <button className="button" onClick={() => void native.signOut().then(props.onChange)}>
              <LogOut size={14} strokeWidth={1.5} aria-hidden />
              <span>{t("account.signOut")}</span>
            </button>
          </div>
        </section>
      )}

      <section>
        <h2 className="section-head">{t("thisMac.sharing")}</h2>
        <div className="card">
          <ToggleRow icon={Eye} label={t("menu.allowViewing")} on={link.allowViewing} onChange={(on) => allow("allowViewing", on)} />
          <ToggleRow
            icon={MousePointerClick}
            label={t("menu.allowControl")}
            on={link.allowControl}
            disabled={!link.allowViewing}
            onChange={(on) => allow("allowControl", on)}
          />
          {status.viewers.length > 0 && (
            <div className="hint">{t("status.viewers", { names: status.viewers.join(", ") })}</div>
          )}
          <div>
            <button className="button" disabled={!link.allowViewing} onClick={() => void native.disconnect().then(props.onChange)}>
              {t("menu.disconnect")}
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-head">{t("log.title")}</h2>
        <div className="card">
          <div className="hint">{t("log.subtitle")}</div>
          {link.log.length === 0 ? (
            <div className="hint">{t("log.empty")}</div>
          ) : (
            link.log.slice(0, 20).map((entry) => (
              <div className="log-line" key={`${entry.at}-${entry.peer}-${entry.what}`}>
                {logLine(entry)}
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="section-head">{t("thisMac.general")}</h2>
        <div className="card">
          <ToggleRow icon={Power} label={t("menu.openAtLogin")} on={menu?.openAtLogin ?? false} onChange={() => toggle("login")} />
          <ToggleRow icon={RefreshCw} label={t("menu.autoUpdate")} on={menu?.autoUpdate ?? false} onChange={() => toggle("autoUpdate")} />
        </div>
      </section>
    </main>
  );
}
