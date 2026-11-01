// The tray panel, laid out like Split's macOS menu (src/runners-menu.css) and in the same groups as Monitor's panel:
// the status block (this computer, whether it can be seen, who is looking, and why not, the two permissions),
// Disconnect while someone is looking, Open Remote, the two Allow switches once connected, the two settings,
// About / Check for Updates… / Help & Feedback, then Quit. The right-click native menu holds the same lines.
import { useEffect, useRef, useState } from "react";
import { AppWindow, CircleHelp, Info, RefreshCw, Square, SquareCheck, SquareX, Unplug, type LucideIcon } from "lucide-react";
import { statusText, t } from "./i18n";
import * as native from "./native";
import type { MenuCommand, MenuState, PermissionKind, Status } from "./native";
import "./runners-menu.css";
import "./App.css";

const REFRESH_MS = 2000;
// Why: the same stroke as Prompt, Split and Monitor so the apps' icons look equally light.
const ICON_STROKE = 1.5;
const ICON_SIZE = 16;

function Icon({ icon: Glyph }: { icon: LucideIcon }) {
  return <Glyph size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />;
}

/** One permission: its name, and "On" or an Allow… button. */
function PermissionRow({ kind, on }: { kind: PermissionKind; on: boolean }) {
  return (
    <div className="row">
      <span className="row-text">{t(`permission.${kind}`)}</span>
      <span className="row-right">
        {on ? (
          <span className="row-state">{t("permission.on")}</span>
        ) : (
          <button type="button" className="row-button" onClick={() => void native.requestPermission(kind)}>
            {t("permission.allow")}
          </button>
        )}
      </span>
    </div>
  );
}

function StatusBlock({ status }: { status: Status }) {
  return (
    <>
      <header className="head">
        <span className={`state-dot ${status.state}`} aria-hidden />
        <span className="host">{status.computer}</span>
        <span className="os">{statusText(status.state, status.reason)}</span>
      </header>
      {status.viewers.length > 0 && <div className="rm-note">{t("status.viewers", { names: status.viewers.join(", ") })}</div>}
      {!status.supported && <div className="rm-note">{t("status.note.platform")}</div>}
      {status.supported && (
        <div className="rm-group">
          <div className="rm-heading">{t("permission.title")}</div>
          <PermissionRow kind="screenRecording" on={status.permissions.screenRecording} />
          <PermissionRow kind="accessibility" on={status.permissions.accessibility} />
          {!status.permissions.screenRecording && <div className="rm-note">{t("permission.restartNote")}</div>}
        </div>
      )}
    </>
  );
}

/** The menu commands, the same lines as the right-click menu. */
function Commands({ viewing }: { viewing: boolean }) {
  const [state, setState] = useState<MenuState | null>(null);
  useEffect(() => {
    void native.menuState().then(setState);
    // Why: the right-click menu can change the same settings while the panel stays loaded.
    const again = () => void native.menuState().then(setState);
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, []);
  const run = (name: MenuCommand) => void native.command(name).then(setState);
  const line = (name: MenuCommand, icon: LucideIcon, label: string) => (
    <button type="button" className="rm-item" onClick={() => run(name)}>
      <Icon icon={icon} />
      <span className="rm-label">{label}</span>
    </button>
  );
  return (
    <>
      {viewing && line("disconnect", Unplug, t("menu.disconnect"))}
      {line("open", AppWindow, t("menu.open"))}
      <div className="rm-separator" />
      {state?.linked && (
        <>
          {line("allowViewing", state.allowViewing ? SquareCheck : Square, t("menu.allowViewing"))}
          {line("allowControl", state.allowControl ? SquareCheck : Square, t("menu.allowControl"))}
          <div className="rm-separator" />
        </>
      )}
      {line("login", state?.openAtLogin ? SquareCheck : Square, t("menu.openAtLogin"))}
      {line("autoUpdate", state?.autoUpdate ? SquareCheck : Square, t("menu.autoUpdate"))}
      <div className="rm-separator" />
      {line("about", Info, t("menu.about"))}
      {line("updates", RefreshCw, t("menu.checkUpdates"))}
      {line("help", CircleHelp, t("menu.help"))}
      <div className="rm-separator" />
      {line("quit", SquareX, t("menu.quit"))}
    </>
  );
}

export default function Panel() {
  const [status, setStatus] = useState<Status | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const read = () => void native.status().then(setStatus);
    read();
    const timer = setInterval(read, REFRESH_MS);
    // Why: a permission turned on in System Settings should show the moment the panel opens again.
    window.addEventListener("focus", read);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, []);

  // Why: a fixed window height left empty space under the last row, so the window follows the panel's height.
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => native.fitHeight(Math.ceil(node.getBoundingClientRect().height)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <main ref={panelRef} className="panel">
      {status ? <StatusBlock status={status} /> : <div className="head" />}
      <div className="rm-separator" />
      <Commands viewing={status?.state === "viewing"} />
    </main>
  );
}
