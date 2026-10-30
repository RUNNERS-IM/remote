// The viewer window ("Open Remote"): this computer's permissions, a tab per display, the chosen display's screen about
// five times a second, and the Send Clicks switch. On Windows and Linux it says Remote works on macOS only for now.
// Why the screen of this same computer: it is the receiving side's own check that capture and clicks work; viewing
// other computers comes with the link stage. Pictures taken here never count as "being viewed" (electron/main/status.ts).
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Monitor } from "lucide-react";
import { t } from "./i18n";
import * as native from "./native";
import type { Display, PermissionKind, Status } from "./native";
import "./App.css";
import "./Viewer.css";

// Why: about five pictures a second is enough to find and press a dialog button, and keeps the CPU quiet.
const FRAME_MS = 200;
const RETRY_MS = 1000;
const STATUS_EVERY_MS = 2000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns the short error codes from the native module into a sentence. */
function captureError(error: unknown): string {
  const code = native.errorCode(error);
  if (code === "permission") return t("view.noPermission");
  if (code === "display") return t("view.noDisplay");
  if (code === "unsupported") return t("status.note.platform");
  return t("view.failed", { error: code });
}

function displayLabel(display: Display, index: number): string {
  return display.name || t("display.fallback", { n: index + 1 });
}

export default function Viewer() {
  const [status, setStatus] = useState<Status | null>(null);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [visible, setVisible] = useState(true);
  const [sendClicks, setSendClicks] = useState(false);
  const [clickError, setClickError] = useState<string | null>(null);
  const frameUrl = useRef<string | null>(null);
  /** A click is on its way; presses meanwhile are dropped so one press never sends two clicks. */
  const sending = useRef(false);

  const loadDisplays = useCallback(async () => {
    const list = await native.displays();
    setDisplays(list);
    setChosen((current) => (current !== null && list.some((d) => d.id === current) ? current : (list[0]?.id ?? null)));
  }, []);

  useEffect(() => {
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
    const check = () => void native.status().then(setStatus);
    check();
    const timer = setInterval(check, STATUS_EVERY_MS);
    return () => clearInterval(timer);
  }, [visible]);

  const supported = status?.supported ?? true;

  // The picture loop: one capture at a time, then a short wait, so a slow capture never piles up requests.
  useEffect(() => {
    if (!visible || !supported || chosen === null) return;
    let running = true;
    const times: number[] = [];
    setFrame(null);
    setProblem(null);
    void (async () => {
      while (running) {
        const started = performance.now();
        try {
          const bytes = await native.capture(chosen);
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
          setProblem(captureError(error));
          setFps(0);
          await wait(RETRY_MS);
        }
      }
    })();
    return () => {
      running = false;
    };
  }, [visible, supported, chosen]);

  useEffect(() => {
    void native.setSendClicks(sendClicks);
    setClickError(null);
  }, [sendClicks]);

  const sendClick = (event: MouseEvent<HTMLImageElement>) => {
    if (!sendClicks || chosen === null || sending.current) return;
    // Why: the picture is drawn at exactly its own box, so the spot inside the box is the spot on the display.
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    sending.current = true;
    native
      .sendInput(
        { kind: "click", display: chosen, x, y, button: "left", count: 1 },
        // Why: where the press was on the screen, so the app can tell its own click landing on this picture again.
        { x: event.screenX, y: event.screenY },
      )
      .then(() => setClickError(null))
      .catch((error) => {
        const code = native.errorCode(error);
        setClickError(code === "accessibility" ? t("clickTest.needAccessibility") : t("clickTest.failed", { error: code }));
      })
      .finally(() => {
        sending.current = false;
      });
  };

  const display = displays.find((d) => d.id === chosen);
  const canClick = status?.permissions.accessibility ?? false;

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
        <div className="title">{status?.computer}</div>
        <div className="subtitle">{t("window.subtitle")}</div>
      </header>

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

        <div className="screen-box card">
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
              <span className="hint">{canClick ? t("clickTest.note") : t("clickTest.needAccessibility")}</span>
            </span>
          </label>
          <div className="meta">
            {clickError && <span className="error">{clickError}</span>}
            {display && <span>{t("display.size", { width: display.width, height: display.height })}</span>}
            {frame && !problem && <span>{t("view.rate", { fps })}</span>}
          </div>
        </div>
      </section>
    </main>
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
