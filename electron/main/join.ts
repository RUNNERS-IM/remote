// Office links (decision 2C): `remote://join?server=remote.example.com` fills in the connection server, so office
// computers join with one click while the published app carries no server address at all. Whoever hands out the link
// (the office setup, a chat message) decides the server; Remote only asks the person at this computer to confirm it.
//
// Where links arrive: macOS sends `open-url` (also before the app is ready, so it is listened for at once); Windows
// and Linux start a second copy with the link as an argument, which the running copy gets in `second-instance`, or
// the first copy finds in its own arguments.
import { app, dialog } from "electron";
import { t } from "./i18n";
import * as link from "./link";

const SCHEME = "remote";

let ready = false;
let waiting: string | null = null;
let onJoined: () => void = () => undefined;

/** The first `remote://` link among a program's arguments (Windows and Linux). */
export function linkIn(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.toLowerCase().startsWith(`${SCHEME}://`)) ?? null;
}

async function handle(href: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  // Why the host and the path both: `remote://join?…` parses with "join" as the host, and some systems pass it on
  // as `remote:///join?…`.
  if (url.protocol !== `${SCHEME}:` || (url.host || url.pathname.replace(/^\/+/, "")) !== "join") return;
  const given = url.searchParams.get("server") ?? "";
  const server = link.parseServer(given);
  if (!server) {
    await dialog.showMessageBox({ type: "warning", title: "Remote", message: t("join.bad", { server: given }), noLink: true });
    return;
  }
  const current = (await link.current()).server;
  if (current !== server) {
    const host = new URL(server).host;
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: "Remote",
      message: t("join.ask", { server: host }),
      detail: [t("join.detail"), current ? t("join.replace", { current: new URL(current).host }) : ""].filter(Boolean).join("\n\n"),
      buttons: [t("server.connect"), t("server.cancel")],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return;
    link.setServer(server);
  }
  onJoined();
}

/** Takes a link now, or keeps the last one until `startJoin` runs. */
export function openLink(href: string): void {
  if (ready) void handle(href);
  else waiting = href;
}

/** Listens for links before the app is ready (macOS sends the one it was opened with that early). */
export function listenForLinks(): void {
  app.on("open-url", (event, href) => {
    event.preventDefault();
    openLink(href);
  });
  // Why only when packaged: a debug run is Electron itself, and registering it would send the links to that binary.
  // The packaged apps also declare the scheme (electron-builder `protocols`); this covers an AppImage, which installs
  // nothing.
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
}

/** Called once the connection is running; `joined` opens the viewer so the person sees the approval state. */
export function startJoin(joined: () => void): void {
  onJoined = joined;
  ready = true;
  const first = waiting ?? linkIn(process.argv);
  waiting = null;
  if (first) void handle(first);
}
