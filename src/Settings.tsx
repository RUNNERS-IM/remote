// The Settings window: one window for everything about this Mac, in Split's Settings look (tabs in the toolbar at the
// top). Tabs: This Mac (seeing it from other computers, permissions), Connection Log, General, Account, About
// (shared decision 2026-11-07, Remote 1B). The This Mac card in the Remote window, the panel and ⌘, open it.
import { useCallback, useEffect, useState } from "react";
import { CircleUser, History, Info, Laptop, Settings as SettingsIcon, type LucideIcon } from "lucide-react";
import { RunnersAbout, type RunnersT } from "./runners-account/runners-about";
import { SignInSheet, type CodePurpose, type SignMode } from "./runners-account/runners-account";
import { locale, statusText, t } from "./i18n";
import * as native from "./native";
import type { Link, LogEntry, MenuCommand, MenuState, PermissionKind, SettingsTab, Status } from "./native";
import { useAppIcon } from "./appIcon";
import "./App.css";
import "./runners-account/runners-window.css";
import "./runners-account/runners-account.css";
import "./Settings.css";

const EVERY_MS = 2000;
const mac = navigator.userAgent.includes("Macintosh");

const TABS: { id: SettingsTab; label: () => string; Icon: LucideIcon }[] = [
  { id: "mac", label: () => t("thisMac.title"), Icon: Laptop },
  { id: "log", label: () => t("log.title"), Icon: History },
  { id: "general", label: () => t("settings.tabGeneral"), Icon: SettingsIcon },
  { id: "account", label: () => t("settings.tabAccount"), Icon: CircleUser },
  { id: "about", label: () => t("settings.tabAbout"), Icon: Info },
];

const WEBSITE = "https://runners.im/remote";
const GITHUB = "https://github.com/RUNNERS-IM/remote";
const aboutT: RunnersT = (key, args) => t(key as Parameters<typeof t>[0], args);

/** Loads THIRD_PARTY_NOTICES.md only when asked, so the 600 KB of notices does not slow down opening the window. */
const loadNotices = () => import("../THIRD_PARTY_NOTICES.md?raw").then((file) => file.default);

function logLine(entry: LogEntry): string {
  const time = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${time}  ${t(`log.${entry.what}`, { peer: entry.peer })}`;
}

// The sign-in sheet reads the failure's short code (bad, exists) from the error's message.
function rethrowCode(error: unknown): never {
  throw new Error(native.errorCode(error));
}

function Switch({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      className={on ? "switch on" : "switch"}
      disabled={disabled}
      onClick={onChange}
    >
      <span className="switch-knob" />
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="s-row">
      <div className="s-row-line">
        <div className="s-row-text">
          <span className="s-row-title">{title}</span>
          {hint && <span className="s-row-hint">{hint}</span>}
        </div>
        <div className="s-row-space" />
        <div className="s-row-control">{children}</div>
      </div>
    </div>
  );
}

const Separator = () => <div className="s-card-separator" />;

function Permission({ kind, on }: { kind: PermissionKind; on: boolean }) {
  return (
    <Row title={t(`permission.${kind}`)} hint={t(`permission.${kind}Note`)}>
      {on ? (
        <span className="s-row-hint">{t("permission.on")}</span>
      ) : (
        <button type="button" className="rw-button" onClick={() => void native.requestPermission(kind)}>
          {t("permission.allow")}
        </button>
      )}
    </Row>
  );
}

function ThisMac({ status, link, onLink }: { status: Status; link: Link; onLink: (link: Link) => void }) {
  return (
    <main className="s-content">
      <section className="s-card s-status">
        <div className="s-status-text">
          <div className="s-status-name">{status.computer}</div>
          <div className="s-status-line">
            <span className={`s-status-dot${status.viewers.length > 0 ? " on" : ""}`} />
            {status.viewers.length > 0 ? t("status.viewers", { names: status.viewers.join(", ") }) : statusText(status.state, status.reason)}
          </div>
        </div>
        {status.viewers.length > 0 && (
          <button type="button" className="rw-button danger" onClick={() => void native.disconnect().then(onLink)}>
            {t("menu.disconnect")}
          </button>
        )}
      </section>
      <section className="s-section">
        <div className="s-card">
          {/* Why: Windows and Linux cannot share their screen yet, so the switch reads off there and cannot be pressed. */}
          <Row title={t("menu.allowViewing")} hint={t(status.supported ? "thisMac.allowHint" : "thisMac.allowHintUnsupported")}>
            <Switch
              label={t("menu.allowViewing")}
              on={status.supported && link.allowViewing}
              disabled={!status.supported}
              onChange={() => void native.setAllow("allowViewing", !link.allowViewing).then(onLink)}
            />
          </Row>
        </div>
      </section>
      {/* Why: Screen Recording and Accessibility are macOS permissions; Windows and Linux have nothing to turn on. */}
      {status.supported && (
        <section className="s-section">
          <h2 className="s-section-title">{t("permission.title")}</h2>
          <div className="s-card">
            <Permission kind="screenRecording" on={status.permissions.screenRecording} />
            <Separator />
            <Permission kind="accessibility" on={status.permissions.accessibility} />
          </div>
          {!status.permissions.screenRecording && <p className="s-section-hint">{t("permission.restartNote")}</p>}
        </section>
      )}
    </main>
  );
}

function Log({ link }: { link: Link }) {
  return (
    <main className="s-content">
      <section className="s-section">
        <h2 className="s-section-title">{t("log.title")}</h2>
        <div className="s-card">
          {link.log.length === 0 ? (
            <Row title={t("log.empty")} />
          ) : (
            link.log.slice(0, 30).map((entry, index) => (
              <div key={`${entry.at}-${entry.peer}-${entry.what}`}>
                {index > 0 && <Separator />}
                <Row title={logLine(entry)} />
              </div>
            ))
          )}
        </div>
        <p className="s-section-hint">{t("log.subtitle")}</p>
      </section>
    </main>
  );
}

/** Split's question before the icon goes: hiding it leaves only the Applications folder as a way back. */
function HideAsk({ onCancel, onHide }: { onCancel: () => void; onHide: () => void }) {
  const appIcon = useAppIcon();
  return (
    <div className="ra-cover" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="ra-sheet s-ask" role="alertdialog" aria-label={t("general.hideAsk")}>
        <img className="s-ask-icon" src={appIcon} alt="" draggable={false} />
        <div className="ra-title">{t("general.hideAsk")}</div>
        <div className="ra-hint">{t("general.trayIconHint")}</div>
        <div className="s-ask-buttons">
          <button type="button" className="rw-button" autoFocus onClick={onCancel}>
            {t("general.cancel")}
          </button>
          <button type="button" className="rw-button default" onClick={onHide}>
            {t("general.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}

function General() {
  const [state, setState] = useState<MenuState | null>(null);
  const [asking, setAsking] = useState(false);
  const [version, setVersion] = useState("");
  useEffect(() => {
    void native.menuState().then(setState);
    void native.version().then(setVersion);
  }, []);
  const run = (name: MenuCommand) => void native.command(name).then(setState);
  return (
    <main className="s-content">
      <section className="s-section">
        <h2 className="s-section-title">{t("general.section")}</h2>
        <div className="s-card">
          <Row title={t("menu.openAtLogin")} hint={t("general.openAtLoginHint")}>
            <Switch label={t("menu.openAtLogin")} on={!!state?.openAtLogin} onChange={() => run("login")} />
          </Row>
          <Separator />
          <Row title={t("menu.autoUpdate")} hint={t("general.autoUpdateHint")}>
            <Switch label={t("menu.autoUpdate")} on={!!state?.autoUpdate} onChange={() => run("autoUpdate")} />
          </Row>
          {state?.canHideIcon && (
            <>
              <Separator />
              <Row title={t("general.trayIcon")} hint={t("general.trayIconHint")}>
                <Switch label={t("general.trayIcon")} on={state.trayIcon} onChange={() => (state.trayIcon ? setAsking(true) : run("trayIcon"))} />
              </Row>
            </>
          )}
          <Separator />
          <Row title={`Remote ${version}`}>
            <button type="button" className="rw-button" onClick={() => run("updates")}>
              {t("menu.checkUpdates")}
            </button>
          </Row>
        </div>
      </section>
      {asking && (
        <HideAsk
          onCancel={() => setAsking(false)}
          onHide={() => {
            setAsking(false);
            run("trayIcon");
          }}
        />
      )}
    </main>
  );
}

function Account({ link, onLink }: { link: Link; onLink: (link: Link) => void }) {
  const [signingIn, setSigningIn] = useState(false);
  const closeSignIn = useCallback(() => setSigningIn(false), []);
  const signIn = useCallback(
    (mode: SignMode, email: string, password: string, code?: string) => native.signIn(mode, email, password, code).then(onLink, rethrowCode),
    [onLink],
  );
  const sendCode = useCallback((purpose: CodePurpose, email: string) => native.sendCode(purpose, email).catch(rethrowCode), []);
  const resetPassword = useCallback(
    (email: string, code: string, password: string) => native.resetPassword(email, code, password).then(onLink, rethrowCode),
    [onLink],
  );
  return (
    <main className="s-content">
      <section className="s-section">
        <h2 className="s-section-title">{t("account.title")}</h2>
        <div className="s-card">
          {link.account ? (
            <div className="s-row">
              <div className="s-row-line">
                <span className="ra-badge ra-large" aria-hidden>
                  {(link.account.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase()}
                </span>
                <div className="s-row-text">
                  <span className="s-row-title">{link.account}</span>
                </div>
                <div className="s-row-space" />
                <button type="button" className="rw-button" onClick={() => void native.signOut().then(onLink)}>
                  {t("account.signOut")}
                </button>
              </div>
            </div>
          ) : (
            <Row title={t("account.intro")}>
              <button type="button" className="rw-button default" onClick={() => setSigningIn(true)}>
                {t("account.signIn")}
              </button>
            </Row>
          )}
        </div>
        {link.account && <p className="s-section-hint">{t("account.intro")}</p>}
      </section>
      {signingIn && <SignInSheet lang={locale} signIn={signIn} sendCode={sendCode} resetPassword={resetPassword} onClose={closeSignIn} />}
    </main>
  );
}

export default function Settings() {
  const appIcon = useAppIcon();
  const first = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState<SettingsTab>(TABS.find((x) => x.id === first)?.id ?? TABS[0].id);
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<Link | null>(null);

  useEffect(() => native.onSettingsTab(setTab), []);
  useEffect(() => {
    const check = () => {
      void native.status().then(setStatus);
      void native.link().then(setLink);
    };
    check();
    const timer = setInterval(check, EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="window">
      {mac && <header className="titlebar">{t("settings.title")}</header>}
      <nav className="toolbar" role="tablist" aria-label={t("settings.title")}>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "toolbar-item selected" : "toolbar-item"}
            onClick={() => setTab(id)}
          >
            <Icon size={22} strokeWidth={1.5} aria-hidden />
            <span>{label()}</span>
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {tab === "mac" && status && link && <ThisMac status={status} link={link} onLink={setLink} />}
        {tab === "log" && link && <Log link={link} />}
        {tab === "general" && <General />}
        {tab === "account" && link && <Account link={link} onLink={setLink} />}
        {tab === "about" && (
          <div className="settings-about">
            <RunnersAbout
              embedded
              appId="remote"
              appName="Remote"
              appIcon={appIcon}
              website={WEBSITE}
              github={GITHUB}
              locale={locale}
              t={aboutT}
              version={native.version}
              openExternal={native.openExternal}
              loadNotices={loadNotices}
            />
          </div>
        )}
      </div>
    </div>
  );
}
