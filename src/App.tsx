import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Monitor } from "lucide-react";
import { t } from "./i18n";
import "./App.css";

type Display = {
  id: number;
  name: string;
  main: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
};

type Permissions = { screenRecording: boolean; accessibility: boolean };
type PermissionKind = keyof Permissions;

// Why: about five pictures a second is enough to find and press a dialog button, and keeps the CPU quiet.
const FRAME_MS = 200;
const RETRY_MS = 1000;
const PERMISSION_EVERY_MS = 2000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns the short error codes from Rust into a sentence. */
function captureError(error: unknown): string {
  const code = String(error);
  if (code === "permission") return t("view.noPermission");
  if (code === "display") return t("view.noDisplay");
  return t("view.failed", { error: code });
}

function displayLabel(display: Display, index: number): string {
  return display.name || t("display.fallback", { n: index + 1 });
}

export default function App() {
  const [computer, setComputer] = useState("");
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [visible, setVisible] = useState(true);
  const [clickTest, setClickTest] = useState(false);
  const [clickError, setClickError] = useState<string | null>(null);
  const frameUrl = useRef<string | null>(null);

  const loadDisplays = useCallback(async () => {
    const list = await invoke<Display[]>("displays");
    setDisplays(list);
    setChosen((current) => (current !== null && list.some((d) => d.id === current) ? current : (list[0]?.id ?? null)));
  }, []);

  useEffect(() => {
    invoke<string>("computer").then(setComputer);
    loadDisplays();
  }, [loadDisplays]);

  // Why: the window is hidden, not closed, so it keeps running; these events stop and restart the pictures.
  useEffect(() => {
    const window = getCurrentWindow();
    const hidden = window.listen("window-hidden", () => {
      setVisible(false);
      setClickTest(false);
    });
    const shown = window.listen("window-shown", () => {
      setVisible(true);
      loadDisplays();
    });
    return () => {
      hidden.then((stop) => stop());
      shown.then((stop) => stop());
    };
  }, [loadDisplays]);

  useEffect(() => {
    if (!visible) return;
    const check = () => invoke<Permissions>("permissions").then(setPermissions);
    check();
    const timer = setInterval(check, PERMISSION_EVERY_MS);
    return () => clearInterval(timer);
  }, [visible]);

  // The picture loop: one capture at a time, then a short wait, so a slow capture never piles up requests.
  useEffect(() => {
    if (!visible || chosen === null) return;
    let running = true;
    const times: number[] = [];
    setFrame(null);
    setProblem(null);
    (async () => {
      while (running) {
        const started = performance.now();
        try {
          const bytes = await invoke<ArrayBuffer>("capture", { display: chosen });
          if (!running) break;
          const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
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
  }, [visible, chosen]);

  useEffect(() => {
    invoke("set_input_test", { on: clickTest });
    setClickError(null);
  }, [clickTest]);

  const allow = (kind: PermissionKind) => {
    invoke<boolean>("request_permission", { kind }).then(() => invoke<Permissions>("permissions").then(setPermissions));
  };

  const sendClick = (event: MouseEvent<HTMLImageElement>) => {
    if (!clickTest || chosen === null) return;
    // Why: the picture is drawn at exactly its own box, so the spot inside the box is the spot on the display.
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    invoke("send_input", { input: { kind: "click", display: chosen, x, y, button: "left", count: 1 } })
      .then(() => setClickError(null))
      .catch((error) =>
        setClickError(String(error) === "accessibility" ? t("clickTest.needAccessibility") : t("clickTest.failed", { error: String(error) })),
      );
  };

  const display = displays.find((d) => d.id === chosen);
  const canClick = permissions?.accessibility ?? false;

  return (
    <main className="window">
      <header>
        <div className="title">{computer}</div>
        <div className="subtitle">{t("window.subtitle")}</div>
      </header>

      <section>
        <h2 className="section-head">{t("permission.title")}</h2>
        <div className="card">
          <PermissionRow
            name={t("permission.screenRecording")}
            note={t("permission.screenRecordingNote")}
            on={permissions?.screenRecording}
            onAllow={() => allow("screenRecording")}
          />
          <PermissionRow
            name={t("permission.accessibility")}
            note={t("permission.accessibilityNote")}
            on={permissions?.accessibility}
            onAllow={() => allow("accessibility")}
          />
          {permissions && !permissions.screenRecording && <div className="hint">{t("permission.restartNote")}</div>}
        </div>
      </section>

      <section className="viewer-section">
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
              {d.main && <span className="badge">{t("display.main")}</span>}
            </button>
          ))}
        </div>

        <div className="viewer card">
          {frame && !problem ? (
            <img
              className={clickTest ? "screen clickable" : "screen"}
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
              checked={clickTest}
              disabled={!canClick}
              onChange={(event) => setClickTest(event.target.checked)}
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

function PermissionRow(props: { name: string; note: string; on: boolean | undefined; onAllow: () => void }) {
  return (
    <div className="permission">
      <span className={props.on ? "dot on" : "dot off"} aria-hidden />
      <div className="permission-text">
        <div>{props.name}</div>
        <div className="hint">{props.note}</div>
      </div>
      <span className="state">{props.on ? t("permission.on") : t("permission.off")}</span>
      {props.on === false && (
        <button className="button" onClick={props.onAllow}>
          {t("permission.allow")}
        </button>
      )}
    </div>
  );
}
