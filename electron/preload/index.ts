// The page's only door to the main process: `window.remote`. Types are in ./api.ts, which the page imports.
import { contextBridge, ipcRenderer } from "electron";
import type { RemoteApi } from "./api";

const api: RemoteApi = {
  status: () => ipcRenderer.invoke("remote:status"),
  displays: () => ipcRenderer.invoke("remote:displays"),
  capture: (display) => ipcRenderer.invoke("remote:capture", display),
  requestPermission: (kind) => ipcRenderer.invoke("remote:requestPermission", kind),
  setSendClicks: (on) => ipcRenderer.invoke("remote:setSendClicks", on),
  sendInput: (input, pressAt) => ipcRenderer.invoke("remote:sendInput", input, pressAt),
  onViewerVisible: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean) => listener(visible);
    ipcRenderer.on("remote:viewerVisible", handler);
    return () => ipcRenderer.removeListener("remote:viewerVisible", handler);
  },
  translucent: () => ipcRenderer.invoke("remote:translucent"),
  fitHeight: (height) => ipcRenderer.send("remote:fitHeight", height),
  version: () => ipcRenderer.invoke("remote:version"),
  openExternal: (url) => ipcRenderer.invoke("remote:openExternal", url),
  accentColor: () => ipcRenderer.invoke("remote:accentColor"),
  menuState: () => ipcRenderer.invoke("remote:menuState"),
  command: (command) => ipcRenderer.invoke("remote:command", command),
  closeWindow: () => ipcRenderer.send("remote:closeWindow"),
};

contextBridge.exposeInMainWorld("remote", api);
