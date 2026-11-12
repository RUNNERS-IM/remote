// The window the selftest types into, run as its own program: `electron scripts/selftest-probe.cjs`.
// Why a separate program: on Linux, Hangul sent from the app did not show up in a window inside the same app, while a
// separate Electron app received it (2026-11-12 run 43214831011), so the test window must be someone else's, as it is
// for a real user. It writes where it sits and what reached it to $REMOTE_PROBE_OUT on every change.
const { app, BrowserWindow, ipcMain } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const out = process.env.REMOTE_PROBE_OUT;
const page =
  '<textarea id="t" style="width:100%;height:100%"></textarea><script>' +
  "const got=[];const send=()=>window.probe.report({events:got,text:t.value});" +
  'addEventListener("mousedown",(e)=>{got.push("mousedown "+e.clientX+","+e.clientY);send()});' +
  'addEventListener("wheel",()=>{got.push("wheel");send()});' +
  'addEventListener("keydown",(e)=>{got.push("keydown "+e.key);send()});' +
  't.addEventListener("input",send);t.focus();send();</script>';

app.whenReady().then(() => {
  const preload = join(tmpdir(), `remote-probe-preload-${process.pid}.cjs`);
  writeFileSync(
    preload,
    'const { contextBridge, ipcRenderer } = require("electron");' +
      'contextBridge.exposeInMainWorld("probe", { report: (state) => ipcRenderer.send("probe", state) });',
  );
  const window = new BrowserWindow({
    x: 100,
    y: 100,
    width: 600,
    height: 400,
    useContentSize: true,
    title: "Remote selftest",
    webPreferences: { preload, sandbox: false },
  });
  ipcMain.on("probe", (_event, state) => {
    writeFileSync(out, JSON.stringify({ window: window.getContentBounds(), ...state }));
  });
  window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page));
  window.focus();
});
