// The connection log window ("Connection Log…" in the menu bar panel): who looked at this computer, clicked, pressed
// keys or typed, newest first. The text typed is never written down, and the log is gone when Remote quits
// (electron/main/link.ts keeps it in memory only).
import { useEffect, useState } from "react";
import { t } from "./i18n";
import * as native from "./native";
import type { LogEntry } from "./native";
import "./App.css";
import "./runners-window.css";
import "./Viewer.css";

const REFRESH_MS = 2000;

function logLine(entry: LogEntry): string {
  const time = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${time}  ${t(`log.${entry.what}`, { peer: entry.peer })}`;
}

export default function Log() {
  const [lines, setLines] = useState<LogEntry[] | null>(null);

  useEffect(() => {
    const read = () => void native.link().then((link) => setLines(link.log));
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <main className="viewer-window">
      <header>
        <div className="title">{t("log.title")}</div>
        <div className="subtitle">{t("log.subtitle")}</div>
      </header>
      <section className="card log-list">
        {lines === null ? null : lines.length === 0 ? (
          <div className="hint">{t("log.empty")}</div>
        ) : (
          lines.map((entry) => (
            <div className="log-line" key={`${entry.at}-${entry.peer}-${entry.what}`}>
              {logLine(entry)}
            </div>
          ))
        )}
      </section>
    </main>
  );
}
