// The viewer window ("Open Remote"), decision 「[REMOTE] 모든 컴퓨터 한눈에」 1A 2A:
//   - First, every computer in the same Tailscale network that has Remote open, as a grid. Each tile shows a small
//     picture of that computer's main display, new every two seconds, or why it cannot be seen.
//   - Pressing a tile opens that computer: a tab per display, its screen about five times a second, the Send Clicks
//     switch, and keys and text going there. "All Computers" goes back.
// This computer is not in the window: its permissions, the two Allow switches, Disconnect and the connection log are
// in the menu bar panel (Panel.tsx, Log.tsx). On Windows and Linux it says Remote works on macOS only for now.
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronLeft, Monitor } from "lucide-react";
import { t } from "./i18n";
import { keyInput } from "./keys";
import * as native from "./native";
import type { Computer, Display, Input, Link, PeerInfo, Status } from "./native";
import "./App.css";
import "./runners-window.css";
import "./Viewer.css";

// Why: about five pictures a second is enough to find and press a dialog button, and keeps the CPU quiet.
const FRAME_MS = 200;
const RETRY_MS = 1000;
const STATUS_EVERY_MS = 2000;
/** How often each tile of the grid gets a new picture, and how wide that picture is asked for (twice the tile). */
const TILE_MS = 2000;
const TILE_WIDTH = 480;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const [visible, setVisible] = useState(true);
  /** The computer opened from the grid, or null for the grid. */
  const [computer, setComputer] = useState<string | null>(null);

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

  if (computer !== null) {
    return (
      <Detail
        host={computer}
        name={opened?.name ?? computer}
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
      <LinkNote link={link} />
      {computers.length > 0 && (
        <section className="grid" aria-label={t("grid.title")}>
          {computers.map((c) => (
            <Tile key={c.host} computer={c} visible={visible} onOpen={() => setComputer(c.host)} />
          ))}
        </section>
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
          const now = await native.peerInfo(computer.host);
          if (!running) break;
          setInfo(now);
          const why = peerProblem(now);
          const main = now.displays.find((d) => d.main) ?? now.displays[0];
          if (why || !main) {
            setProblem(why ?? t("view.noDisplay"));
            setPicture(null);
          } else {
            const bytes = await native.peerCapture(computer.host, main.id, TILE_WIDTH);
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

/** One computer opened from the grid: its displays as tabs, the screen, and sending clicks, keys and text. */
function Detail({ host, name, visible, onBack }: { host: string; name: string; visible: boolean; onBack: () => void }) {
  const [peer, setPeer] = useState<PeerInfo | null>(null);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [frame, setFrame] = usePicture();
  const [problem, setProblem] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [sendClicks, setSendClicks] = useState(false);
  const [clickError, setClickError] = useState<string | null>(null);
  const [text, setText] = useState("");
  /** A click is on its way; presses meanwhile are dropped so one press never sends two clicks. */
  const sending = useRef(false);

  const loadDisplays = useCallback(async () => {
    let list: Display[] = [];
    try {
      const info = await native.peerInfo(host);
      setPeer(info);
      list = info.displays;
      setProblem(peerProblem(info));
    } catch (error) {
      setPeer(null);
      setProblem(captureError(error));
    }
    setDisplays(list);
    setChosen((current) => (current !== null && list.some((d) => d.id === current) ? current : (list[0]?.id ?? null)));
  }, [host]);

  useEffect(() => {
    if (!visible) {
      // Why: the main process turns sending off when the window hides; the switch shows the same.
      setSendClicks(false);
      return;
    }
    void loadDisplays();
  }, [visible, loadDisplays]);

  const viewable = peer?.viewing ?? false;

  // The picture loop: one capture at a time, then a short wait, so a slow capture never piles up requests.
  useEffect(() => {
    if (!visible || chosen === null || !viewable) return;
    let running = true;
    const times: number[] = [];
    setFrame(null);
    void (async () => {
      while (running) {
        const started = performance.now();
        try {
          const bytes = await native.peerCapture(host, chosen);
          if (!running) break;
          setFrame(bytes);
          setProblem(null);
          times.push(performance.now());
          while (times.length > 0 && times[0] < performance.now() - 2000) times.shift();
          setFps(Math.round(times.length / 2));
          await wait(Math.max(0, FRAME_MS - (performance.now() - started)));
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
    };
  }, [visible, chosen, host, viewable, setFrame]);

  useEffect(() => setClickError(null), [sendClicks]);

  const send = (input: Input) => native.peerInput(host, input);

  const sendClick = (event: MouseEvent<HTMLImageElement>) => {
    if (!sendClicks || chosen === null || sending.current) return;
    // Why: the picture is drawn at exactly its own box, so the spot inside the box is the spot on the display.
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    sending.current = true;
    send({ kind: "click", display: chosen, x, y, button: "left", count: 1 })
      .then(() => setClickError(null))
      .catch((error) => setClickError(inputError(error)))
      .finally(() => {
        sending.current = false;
      });
  };

  const sendKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!sendClicks) return;
    const input = keyInput(event.nativeEvent);
    if (!input) return;
    event.preventDefault();
    send(input)
      .then(() => setClickError(null))
      .catch((error) => setClickError(inputError(error)));
  };

  const sendText = (event: FormEvent) => {
    event.preventDefault();
    if (!text) return;
    send({ kind: "text", text })
      .then(() => {
        setText("");
        setClickError(null);
      })
      .catch((error) => setClickError(inputError(error)));
  };

  const display = displays.find((d) => d.id === chosen);
  const canClick = peer?.control ?? false;

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

        <div className="screen-box card" tabIndex={0} onKeyDown={sendKey}>
          {frame && !problem ? (
            <img
              className={sendClicks ? "screen clickable" : "screen"}
              src={frame}
              alt={display ? displayLabel(display, displays.indexOf(display)) : ""}
              draggable={false}
              onClick={sendClick}
            />
          ) : (
            <div className="empty">{problem ?? t("view.loading")}</div>
          )}
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
            {display && <span>{t("display.size", { width: display.width, height: display.height })}</span>}
            {frame && !problem && <span>{t("view.rate", { fps })}</span>}
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
function LinkNote({ link }: { link: Link | null }) {
  if (!link) return null;
  if (link.state === "noTailscale") return <div className="hint link-note">{t("link.noTailscale")}</div>;
  if (link.state === "starting") return <div className="hint link-note">{t("link.starting")}</div>;
  if (link.state === "failed") return <div className="hint link-note error">{t("link.failed", { error: link.error ?? "" })}</div>;
  if (link.state === "needsLogin")
    return (
      <div className="hint link-note">
        {t("link.needsLogin")}{" "}
        <button className="button" onClick={() => void native.openLinkLogin()}>
          {t("link.approve")}
        </button>
      </div>
    );
  if (link.computers.length === 0) return <div className="hint link-note">{t("link.empty")}</div>;
  return null;
}
