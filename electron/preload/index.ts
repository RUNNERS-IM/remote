// The page's only door to the main process: `window.remote`. Types are in ./api.ts, which the page imports.
import { contextBridge, ipcRenderer } from "electron";
import type { RemoteApi, UpdateOffer } from "./api";

const api: RemoteApi = {
  status: () => ipcRenderer.invoke("remote:status"),
  displays: () => ipcRenderer.invoke("remote:displays"),
  capture: (display) => ipcRenderer.invoke("remote:capture", display),
  requestPermission: (kind) => ipcRenderer.invoke("remote:requestPermission", kind),
  setSendClicks: (on) => ipcRenderer.invoke("remote:setSendClicks", on),
  sendInput: (input, pressAt) => ipcRenderer.invoke("remote:sendInput", input, pressAt),
  link: () => ipcRenderer.invoke("remote:link"),
  openLinkLogin: () => ipcRenderer.invoke("remote:openLinkLogin"),
  setLinkServer: (text) => ipcRenderer.invoke("remote:setLinkServer", text),
  setAllow: (what, on) => ipcRenderer.invoke("remote:setAllow", what, on),
  disconnect: () => ipcRenderer.invoke("remote:disconnect"),
  peerInfo: (host) => ipcRenderer.invoke("remote:peerInfo", host),
  peerCapture: (host, display) => ipcRenderer.invoke("remote:peerCapture", host, display),
  peerInput: (host, input) => ipcRenderer.invoke("remote:peerInput", host, input),
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
  updateOffer: () => ipcRenderer.invoke("remote:updateOffer"),
  onUpdateOffer: (listener) => {
    const relay = (_event: Electron.IpcRendererEvent, offer: UpdateOffer) => listener(offer);
    ipcRenderer.on("remote:updateOffer", relay);
    return () => ipcRenderer.off("remote:updateOffer", relay);
  },
  answerUpdate: (answer) => ipcRenderer.send("remote:answerUpdate", answer),
};

contextBridge.exposeInMainWorld("remote", api);
