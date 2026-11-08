// The page's only door to the main process: `window.remote`. Types are in ./api.ts, which the page imports.
import { contextBridge, ipcRenderer } from "electron";
import type { RemoteApi, UpdateOffer } from "./api";

/** Subscribes to one message from the main process; returns the way to stop. */
function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: RemoteApi = {
  status: () => ipcRenderer.invoke("remote:status"),
  displays: () => ipcRenderer.invoke("remote:displays"),
  capture: (display) => ipcRenderer.invoke("remote:capture", display),
  requestPermission: (kind) => ipcRenderer.invoke("remote:requestPermission", kind),
  setSendClicks: (on) => ipcRenderer.invoke("remote:setSendClicks", on),
  sendInput: (input, pressAt) => ipcRenderer.invoke("remote:sendInput", input, pressAt),
  link: () => ipcRenderer.invoke("remote:link"),
  signIn: (mode, email, password, code) => ipcRenderer.invoke("remote:signIn", mode, email, password, code),
  sendCode: (purpose, email) => ipcRenderer.invoke("remote:sendCode", purpose, email),
  resetPassword: (email, code, password) => ipcRenderer.invoke("remote:resetPassword", email, code, password),
  signOut: () => ipcRenderer.invoke("remote:signOut"),
  setAllow: (what, on) => ipcRenderer.invoke("remote:setAllow", what, on),
  disconnect: () => ipcRenderer.invoke("remote:disconnect"),
  deviceId: () => ipcRenderer.invoke("remote:deviceId"),
  sendSignal: (to, payload) => ipcRenderer.send("remote:sendSignal", to, payload),
  onSignal: (listener) => listen("remote:signal", listener),
  onPeerLeft: (listener) => listen("remote:peerLeft", listener),
  hostRequest: (peer, method, params) => ipcRenderer.invoke("remote:hostRequest", peer, method, params),
  onDropHosted: (listener) => listen("remote:dropHosted", listener),
  onDropAll: (listener) => listen("remote:dropAll", listener),
  onClientRequest: (listener) => listen("remote:clientRequest", listener),
  clientReply: (rid, ok, value) => ipcRenderer.send("remote:clientReply", rid, ok, value),
  onViewerVisible: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean) => listener(visible);
    ipcRenderer.on("remote:viewerVisible", handler);
    return () => ipcRenderer.removeListener("remote:viewerVisible", handler);
  },
  readClipboard: () => ipcRenderer.invoke("remote:readClipboard"),
  writeClipboard: (text) => ipcRenderer.invoke("remote:writeClipboard", text),
  keysToPeer: (on) => ipcRenderer.send("remote:keysToPeer", on),
  translucent: () => ipcRenderer.invoke("remote:translucent"),
  fitHeight: (height) => ipcRenderer.send("remote:fitHeight", height),
  version: () => ipcRenderer.invoke("remote:version"),
  openExternal: (url) => ipcRenderer.invoke("remote:openExternal", url),
  menuState: () => ipcRenderer.invoke("remote:menuState"),
  command: (command) => ipcRenderer.invoke("remote:command", command),
  openSettings: (tab) => ipcRenderer.send("remote:openSettings", tab),
  onSettingsTab: (listener) => listen("remote:settingsTab", listener),
  openComputer: (host) => ipcRenderer.send("remote:openComputer", host),
  onOpenComputer: (listener) => listen("remote:openComputer", listener),
  closeWindow: () => ipcRenderer.send("remote:closeWindow"),
  usageConsent: () => ipcRenderer.invoke("remote:usageConsent"),
  setUsageConsent: (granted) => ipcRenderer.invoke("remote:setUsageConsent", granted),
  countUsage: (feature) => ipcRenderer.send("remote:countUsage", feature),
  updateOffer: () => ipcRenderer.invoke("remote:updateOffer"),
  onUpdateOffer: (listener) => {
    const relay = (_event: Electron.IpcRendererEvent, offer: UpdateOffer) => listener(offer);
    ipcRenderer.on("remote:updateOffer", relay);
    return () => ipcRenderer.off("remote:updateOffer", relay);
  },
  answerUpdate: (answer) => ipcRenderer.send("remote:answerUpdate", answer),
};

contextBridge.exposeInMainWorld("remote", api);
