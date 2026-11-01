// The viewer window ("Open Remote"): a tab per computer (this one first, then the office computers the connection
// knows), a tab per display of the chosen computer, its screen about five times a second, and the Send Clicks switch.
// On this computer it also shows the two permissions and who has looked at it (the connection log); on another
// computer, keys typed while the screen is focused and the text box below it go there too.
// Pictures of this computer taken here never count as "being viewed" (electron/main/status.ts). On Windows and Linux
// it says Remote works on macOS only for now.
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Laptop, Monitor } from "lucide-react";
import { t } from "./i18n";
import { keyInput } from "./keys";
import * as native from "./native";
import type { Display, Input, Link, LogEntry, PeerInfo, PermissionKind, Status } from "./native";
import "./App.css";
import "./runners-window.css";
import "./Viewer.css";

// Why: about five pictures a second is enough to find and press a dialog button, and keeps the CPU quiet.
const FRAME_MS = 200;
const RETRY_MS = 1000;
const STATUS_EVERY_MS = 2000;
const LOG_LINES = 5;

/** The tab for this computer; every other tab is a network name. */
const HERE = "";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns the short error codes from the native module or another computer into a sentence. */
function captureError(error: unknown, here: boolean): string {
  const code = native.errorCode(error);
  if (code === "permission") return here ? t("view.noPermission") : t("peer.noPermission");
  if (code === "display") return t("view.noDisplay");
  if (code === "unsupported") return t("status.note.platform");
  if (code === "off") return t("peer.off");
  if (code === "unreachable") return t("peer.unreachable");
  return t("view.failed", { error: code });
}

function inputError(error: unknown, here: boolean): string {
  const code = native.errorCode(error);
  if (code === "accessibility") return here ? t("clickTest.needAccessibility") : t("peer.noAccessibility");
  if (code === "control") return t("peer.noControl");
  if (code === "off") return t("peer.off");
  if (code === "unreachable") return t("peer.unreachable");
  return t("clickTest.failed", { error: code });
}

function displayLabel(display: Display, index: number): string {
  return display.name || t("display.fallback", { n: index + 1 });
}

function logLine(entry: LogEntry): string {
  const time = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${time}  ${t(`log.${entry.what}`, { peer: entry.peer })}`;
}

export default function Viewer() {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [computer, setComputer] = useState(HERE);
  const [peer, setPeer] = useState<PeerInfo | null>(null);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [visible, setVisible] = useState(true);
  const [sendClicks, setSendClicks] = useState(false);
  const [clickError, setClickError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const frameUrl = useRef<string | null>(null);
  /** A click is on its way; presses meanwhile are dropped so one press never sends two clicks. */
  const sending = useRef(false);
  const here = computer === HERE;

  const loadDisplays = useCallback(async () => {
    let list: Display[] = [];
    if (here) {
      list = await native.displays();
      setPeer(null);
    } else {
      try {
        const info = await native.peerInfo(computer);
        setPeer(info);
        list = info.displays;
        setProblem(info.viewing ? null : t("peer.off"));
      } catch (error) {
        setPeer(null);
        setProblem(captureError(error, false));
      }
    }
    setDisplays(list);
    setChosen((current) => (current !== null && list.some((d) => d.id === current) ? current : (list[0]?.id ?? null)));
  }, [here, computer]);

  useEffect(() => {
    setDisplays([]);
    setChosen(null);
    setSendClicks(false);
    void loadDisplays();
  }, [loadDisplays]);

  // Why: closing the window only hides it, so these events stop and restart the pictures.
  useEffect(
    () =>
      native.onViewerVisible((shown) => {
        setVisible(shown);
        if (shown) void loadDisplays();
        // Why: the main process turns sending off when the window hides; the switch shows the same.
        else setSendClicks(false);
      }),
    [loadDisplays],
  );

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
  const peerViewable = here || (peer?.viewing ?? false);

  // The picture loop: one capture at a time, then a short wait, so a slow capture never piles up requests.
  useEffect(() => {
    if (!visible || !supported || chosen === null || !peerViewable) return;
    let running = true;
    const times: number[] = [];
    setFrame(null);
    setProblem(null);
    void (async () => {
      while (running) {
        const started = performance.now();
        try {
          const bytes = here ? await native.capture(chosen) : await native.peerCapture(computer, chosen);
          if (!running) break;
          const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }));
          if (frameUrl.current) URL.revokeObjectURL(frameUrl.current);
          frameUrl.current = url;
          setFrame(url);
          setProblem(null);
          times.push(performance.now());
          while (times.length > 0 && times[0] < performance.now() - 2000) times.shift();
          setFps(Math.round(times.length / 2));
          await wait(Math.max(0, FRAME_MS - (performance.now() - started)));
        } catch (error) {
          if (!running) break;
          setProblem(captureError(error, here));
          setFps(0);
          await wait(RETRY_MS);
        }
      }
    })();
    return () => {
      running = false;
    };
  }, [visible, supported, chosen, here, computer, peerViewable]);

  useEffect(() => {
    // Why: the switch on this computer guards clicks into this computer; clicks to another one are guarded there.
    if (here) void native.setSendClicks(sendClicks);
    else void native.setSendClicks(false);
    setClickError(null);
  }, [sendClicks, here]);

  const send = (input: Input) => {
    if (here) return Promise.reject(new Error("off"));
    return native.peerInput(computer, input);
  };

  const sendClick = (event: MouseEvent<HTMLImageElement>) => {
    if (!sendClicks || chosen === null || sending.current) return;
    // Why: the picture is drawn at exactly its own box, so the spot inside the box is the spot on the display.
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    const click: Input = { kind: "click", display: chosen, x, y, button: "left", count: 1 };
    sending.current = true;
    (here
      ? // Why: where the press was on the screen, so the app can tell its own click landing on this picture again.
        native.sendInput(click, { x: event.screenX, y: event.screenY }).then(() => undefined)
      : send(click)
    )
      .then(() => setClickError(null))
      .catch((error) => setClickError(inputError(error, here)))
      .finally(() => {
        sending.current = false;
      });
  };

  // Why: keys typed on this computer's own picture would land in this window again, so typing goes to others only.
  const sendKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (here || !sendClicks) return;
    const input = keyInput(event.nativeEvent);
    if (!input) return;
    event.preventDefault();
    send(input)
      .then(() => setClickError(null))
      .catch((error) => setClickError(inputError(error, false)));
  };

  const sendText = (event: FormEvent) => {
    event.preventDefault();
    if (!text) return;
    send({ kind: "text", text })
      .then(() => {
        setText("");
        setClickError(null);
      })
      .catch((error) => setClickError(inputError(error, false)));
  };

  const display = displays.find((d) => d.id === chosen);
  const canClick = here ? (status?.permissions.accessibility ?? false) : (peer?.control ?? false);
  const others = link?.computers ?? [];
  const title = here ? status?.computer : (others.find((c) => c.host === computer)?.name ?? computer);

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

  return (
    <main className="viewer-window">
      <header>
        <div className="title">{title}</div>
        <div className="subtitle">{here ? t("window.subtitle") : t("window.subtitlePeer")}</div>
      </header>

      <section>
        <h2 className="section-head">{t("computer.title")}</h2>
        <div className="tabs" role="tablist" aria-label={t("computer.title")}>
          <button
            role="tab"
            aria-selected={here}
            className={here ? "tab chosen" : "tab"}
            onClick={() => setComputer(HERE)}
          >
            <Laptop size={14} strokeWidth={1.5} />
            <span>{t("computer.this")}</span>
          </button>
          {others.map((c) => (
            <button
              key={c.host}
              role="tab"
              aria-selected={c.host === computer}
              className={c.host === computer ? "tab chosen" : "tab"}
              disabled={!c.online}
              onClick={() => setComputer(c.host)}
            >
              <Laptop size={14} strokeWidth={1.5} />
              <span>{c.name}</span>
              {!c.online && <span className="tab-badge">{t("computer.offline")}</span>}
            </button>
          ))}
        </div>
        <LinkNote link={link} />
        {here && link && <ServerField server={link.server} onChange={setLink} />}
      </section>

      {here && (
        <section>
          <h2 className="section-head">{t("permission.title")}</h2>
          <div className="card">
            <PermissionRow
              kind="screenRecording"
              note={t("permission.screenRecordingNote")}
              on={status?.permissions.screenRecording}
            />
            <PermissionRow kind="accessibility" note={t("permission.accessibilityNote")} on={status?.permissions.accessibility} />
            {status && !status.permissions.screenRecording && <div className="hint">{t("permission.restartNote")}</div>}
          </div>
        </section>
      )}

      {here && link && link.state !== "noServer" && <ConnectionLog link={link} />}

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

        <div className="screen-box card" tabIndex={here ? undefined : 0} onKeyDown={sendKey}>
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
              <span className="hint">
                {here
                  ? canClick
                    ? t("clickTest.note")
                    : t("clickTest.needAccessibility")
                  : canClick
                    ? t("peer.typeNote")
                    : t("peer.noControl")}
              </span>
            </span>
          </label>
          <div className="meta">
            {clickError && <span className="error">{clickError}</span>}
            {display && <span>{t("display.size", { width: display.width, height: display.height })}</span>}
            {frame && !problem && <span>{t("view.rate", { fps })}</span>}
          </div>
        </div>

        {!here && sendClicks && (
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

/** One line under the computer tabs saying why only this computer is listed, or how the connection is doing. */
function LinkNote({ link }: { link: Link | null }) {
  if (!link) return null;
  if (link.state === "noServer") return <div className="hint link-note">{t("link.noServer")}</div>;
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
  return (
    <div className="hint link-note">
      {link.computers.length === 0 ? t("link.empty") : t("link.running", { self: link.self ?? "" })}
    </div>
  );
}

/** The connection server: its address with Change, or a box to type one. An office link fills it in too
 *  (electron/main/join.ts), so most people never type here. */
function ServerField({ server, onChange }: { server: string | null; onChange: (link: Link) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const save = (event: FormEvent) => {
    event.preventDefault();
    native.setLinkServer(text).then(
      (next) => {
        onChange(next);
        setEditing(false);
        setBad(false);
      },
      () => setBad(true),
    );
  };
  if (server && !editing) {
    return (
      <div className="server-row">
        <span className="server-label">{t("server.title")}</span>
        <span className="server-address">{new URL(server).host}</span>
        <button
          className="button"
          onClick={() => {
            setText(server);
            setEditing(true);
          }}
        >
          {t("server.change")}
        </button>
      </div>
    );
  }
  return (
    <form className="server-row" onSubmit={save}>
      <span className="server-label">{t("server.title")}</span>
      <input
        className="type-box"
        value={text}
        placeholder="remote.example.com"
        spellCheck={false}
        autoCapitalize="off"
        onChange={(event) => {
          setText(event.target.value);
          setBad(false);
        }}
      />
      <button className="button" type="submit" disabled={!text.trim() && !server}>
        {server && !text.trim() ? t("server.remove") : t("server.connect")}
      </button>
      {editing && (
        <button className="button" type="button" onClick={() => setEditing(false)}>
          {t("server.cancel")}
        </button>
      )}
      <div className={bad ? "hint error server-note" : "hint server-note"}>{bad ? t("server.bad") : t("server.hint")}</div>
    </form>
  );
}

/** Who looked at or clicked this computer lately, newest first, with the two switches and Disconnect. */
function ConnectionLog({ link }: { link: Link }) {
  const [now, setNow] = useState(link);
  useEffect(() => setNow(link), [link]);
  const lines = now.log.slice(0, LOG_LINES);
  return (
    <section>
      <h2 className="section-head">{t("log.title")}</h2>
      <div className="card">
        <div className="log-switches">
          <label className="switch">
            <input
              type="checkbox"
              checked={now.allowViewing}
              onChange={(event) => void native.setAllow("allowViewing", event.target.checked).then(setNow)}
            />
            <span className="knob" aria-hidden />
            <span className="switch-label">{t("menu.allowViewing")}</span>
          </label>
          <label className={now.allowViewing ? "switch" : "switch disabled"}>
            <input
              type="checkbox"
              checked={now.allowControl}
              disabled={!now.allowViewing}
              onChange={(event) => void native.setAllow("allowControl", event.target.checked).then(setNow)}
            />
            <span className="knob" aria-hidden />
            <span className="switch-label">{t("menu.allowControl")}</span>
          </label>
          <button className="button" disabled={!now.allowViewing} onClick={() => void native.disconnect().then(setNow)}>
            {t("menu.disconnect")}
          </button>
        </div>
        {lines.length === 0 ? (
          <div className="hint">{t("log.empty")}</div>
        ) : (
          lines.map((entry) => (
            <div className="log-line" key={`${entry.at}-${entry.peer}-${entry.what}`}>
              {logLine(entry)}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function PermissionRow(props: { kind: PermissionKind; note: string; on: boolean | undefined }) {
  return (
    <div className="permission">
      <span className={props.on ? "dot on" : "dot off"} aria-hidden />
      <div className="permission-text">
        <div>{t(`permission.${props.kind}`)}</div>
        <div className="hint">{props.note}</div>
      </div>
      <span className="state">{props.on ? t("permission.on") : t("permission.off")}</span>
      {props.on === false && (
        <button className="button" onClick={() => void native.requestPermission(props.kind)}>
          {t("permission.allow")}
        </button>
      )}
    </div>
  );
}
