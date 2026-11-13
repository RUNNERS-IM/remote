// The menu-bar panel, in the shared menu look (runners-menu.css): the other computers on top, because seeing one is what
// Remote is for, then this Mac's state, then Settings… · Help · Quit like every RUNNERS app (shared decision 2026-11-07,
// Remote 2B). Both clicks on the tray picture open it.
import { useEffect, useRef, useState } from "react";
import { AppWindow, CircleHelp, Eye, EyeOff, LogIn, Monitor, Settings, SquareX, Unplug, type LucideIcon } from "lucide-react";
import { MenuHead, MenuItem, MenuSeparator } from "./runners-account/runners-menu";
import { statusText, t } from "./i18n";
import * as native from "./native";
import type { Link, Status } from "./native";
import "./App.css";
import "./runners-account/runners-menu.css";

const EVERY_MS = 2000;
const mac = navigator.userAgent.includes("Macintosh");
const icon = (Glyph: LucideIcon) => <Glyph size={16} strokeWidth={1.5} aria-hidden />;

export default function Panel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => {
      // Why: the panel is made at launch and mostly hidden, so it asks only while it is on screen.
      if (document.hidden) return;
      void native.status().then(setStatus);
      void native.link().then(setLink);
    };
    check();
    const timer = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(() => native.fitHeight(Math.ceil(node.getBoundingClientRect().height)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={root} className="rm-panel" style={{ padding: "var(--rm-pad-y) 0" }}>
      {status && link && (
        <>
          <MenuHead name="Remotrol" sub={`${status.computer} · ${statusText(status.state, status.reason)}`} />
          <MenuSeparator />
          {link.account ? (
            <>
              <div className="rm-heading">{t("panel.others")}</div>
              {link.computers.length === 0 && <div className="rm-note">{t("link.empty")}</div>}
              {link.computers.map((computer) => (
                <MenuItem
                  key={computer.host}
                  icon={icon(Monitor)}
                  label={
                    <>
                      {computer.name}
                      <span className="rm-sub">{t(computer.online ? "computer.online" : "computer.offline")}</span>
                    </>
                  }
                  onSelect={() => native.openComputer(computer.host)}
                />
              ))}
              <MenuItem icon={icon(AppWindow)} label={t("panel.openAll")} onSelect={() => void native.command("open")} />
            </>
          ) : (
            <MenuItem icon={icon(LogIn)} label={t("account.signIn")} onSelect={() => void native.command("open")} />
          )}
          <MenuSeparator />
          <div className="rm-heading">
            {t("thisMac.title")}
          </div>
          {status.supported ? (
            <MenuItem
              icon={icon(link.allowViewing && link.account ? Eye : EyeOff)}
              // Why: signed out, no other computer can reach this one, so it is not visible even with seeing on.
              label={t(!link.allowViewing ? "panel.hidden" : link.account ? "panel.visible" : "panel.signedOut")}
              onSelect={() => native.openSettings("mac")}
            />
          ) : (
            // Why: Windows and Linux cannot share their screen yet, so the line reads hidden and cannot be pressed
            // (the kit's MenuItem is always a button, hence a plain line here).
            <div className="rm-item panel-off" aria-disabled="true">
              {icon(EyeOff)}
              <span className="rm-label">{t("panel.hidden")}</span>
            </div>
          )}
          {status.viewers.length > 0 && (
            <>
              <div className="rm-note">{t("status.viewers", { names: status.viewers.join(", ") })}</div>
              <MenuItem icon={icon(Unplug)} label={t("menu.disconnect")} onSelect={() => void native.disconnect().then(setLink)} />
            </>
          )}
          <MenuSeparator />
          <MenuItem icon={icon(Settings)} label={t("menu.settings")} trailing={mac ? "⌘," : undefined} onSelect={() => void native.command("settings")} />
          <MenuItem icon={icon(CircleHelp)} label={t("menu.help")} onSelect={() => void native.command("help")} />
          <MenuItem icon={icon(SquareX)} label={t("menu.quit")} trailing={mac ? "⌘Q" : undefined} onSelect={() => void native.command("quit")} />
        </>
      )}
    </div>
  );
}
