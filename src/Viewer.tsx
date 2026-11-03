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
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { SignMode } from "../electron/preload/api";
import { ChevronLeft, Eye, Laptop, LogOut, Monitor, MousePointerClick, Power, RefreshCw, type LucideIcon } from "lucide-react";
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
  /** A click is on its way; presses meanwhile are dropped so one press never sends two clicks. */
  const sending = useRef(false);

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

  const send = (input: Input) => peer.ask(host, "input", { input });

  const sendClick = (event: MouseEvent<HTMLVideoElement>) => {
    const element = event.currentTarget;
    if (!sendClicks || chosen === null || sending.current || !element.videoWidth) return;
    // Why: the video may sit letterboxed inside its box, so the spot is measured on the picture itself.
    const box = element.getBoundingClientRect();
    const scale = Math.min(box.width / element.videoWidth, box.height / element.videoHeight);
    const width = element.videoWidth * scale;
    const height = element.videoHeight * scale;
    const x = (event.clientX - box.left - (box.width - width) / 2) / width;
    const y = (event.clientY - box.top - (box.height - height) / 2) / height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
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
  const canClick = info?.control ?? false;

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
          <video
            ref={video}
            className={sendClicks ? "screen clickable" : "screen"}
            hidden={!playing || problem !== null}
            aria-label={display ? displayLabel(display, displays.indexOf(display)) : ""}
            muted
            playsInline
            onClick={sendClick}
          />
          {(!playing || problem !== null) && <div className="empty">{problem ?? t("view.loading")}</div>}
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
            {playing && !problem && <span>{t("view.rate", { fps })}</span>}
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
