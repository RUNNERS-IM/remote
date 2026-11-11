// The WebRTC connections (2026-11-03 decision: Remote sends screens as WebRTC video). They live in the Remote window's
// page, which Remote makes at launch and only hides, so this computer can be seen while the window is closed.
//
// One connection per pair of devices and direction:
//   - As the viewer, this page offers a connection to a computer: a data channel "remote" for questions, and
//     VIDEO_LINES video lines. The computer fills the first once asked to `watch` one display, or one line per display
//     once asked to `watchAll` (every monitor side by side, 2026-11-07 decision 1C). A computer before that answers
//     `watchAll` with an unknown method, and the viewer then shows one display at a time.
//   - As the host, it answers other devices' offers. Their questions go to the main process (hostRequest), which
//     checks the See This switch and the permissions.
// Both directions can be up between the same two computers, so every ICE candidate says which side it is for
// (`for: "host"` goes to the connection this device answered, `"viewer"` to the one it offered). The phone app
// (remote-app) speaks the same.
//
// On the data channel, a question is `{id, method, params}` and an answer `{id, result}` or `{id, error}`. An answer
// longer than one message (a full still picture) goes in parts: `{id, part, parts, text}`, joined before reading.
// Still pictures travel as base64 JPEG in `result.jpeg`.
import type { ClientRequest, Signal } from "../electron/preload/api";

const ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const CHANNEL = "remote";
const ASK_TIMEOUT_MS = 15_000;
const OPEN_TIMEOUT_MS = 20_000;
/** Safely under every browser's data channel message limit. */
const PART_CHARS = 60_000;
/** While video goes out, how often the main process hears that the viewer is still watching (status and log). */
const VIEWING_EVERY_MS = 500;
const VIDEO_MAX_FPS = 15;
/** Video lines a viewer offers; a computer with more displays shows the first ones side by side. */
const VIDEO_LINES = 4;
/** Side by side every picture is small, so each display is captured narrower to keep the line light. */
const ALL_MAX_WIDTH = 1600;

type Sdp = { type: RTCSdpType; sdp: string };
type Candidate = RTCIceCandidateInit & { for?: "host" | "viewer" };
type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: string; part?: number; parts?: number; text?: string };

const api = () => window.remote;

/** Sends a reply, cut into parts when it is long. */
function reply(channel: RTCDataChannel, message: Message): void {
  if (channel.readyState !== "open") return;
  const text = JSON.stringify(message);
  if (text.length <= PART_CHARS) {
    channel.send(text);
    return;
  }
  const parts = Math.ceil(text.length / PART_CHARS);
  for (let part = 0; part < parts; part++) {
    channel.send(JSON.stringify({ id: message.id, part, parts, text: text.slice(part * PART_CHARS, (part + 1) * PART_CHARS) }));
  }
}

/** Joins parts as they come, handing over each whole message. */
function reader(onMessage: (message: Message) => void): (event: MessageEvent) => void {
  const partial = new Map<number, string[]>();
  return (event) => {
    let message: Message;
    try {
      message = JSON.parse(String(event.data)) as Message;
    } catch {
      return;
    }
    if (message.parts === undefined || message.id === undefined) {
      onMessage(message);
      return;
    }
    const got = partial.get(message.id) ?? [];
    got[message.part ?? 0] = message.text ?? "";
    partial.set(message.id, got);
    if (got.filter((p) => p !== undefined).length < message.parts) return;
    partial.delete(message.id);
    try {
      onMessage(JSON.parse(got.join("")) as Message);
    } catch {
      // A broken message is dropped; the asking side times out.
    }
  };
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Candidates that came before the other side's description, added once it is set. */
class Ice {
  private early: RTCIceCandidateInit[] = [];
  constructor(private pc: RTCPeerConnection) {}
  add(candidate: RTCIceCandidateInit): void {
    if (this.pc.remoteDescription) void this.pc.addIceCandidate(candidate).catch(() => undefined);
    else this.early.push(candidate);
  }
  flush(): void {
    for (const candidate of this.early) void this.pc.addIceCandidate(candidate).catch(() => undefined);
    this.early = [];
  }
}

// ---- This page as the viewer ----

let made = 0;

class Outgoing {
  /** Which connection this is, so a page can tell that the one it watched was replaced. */
  readonly serial = ++made;
  readonly pc = new RTCPeerConnection({ iceServers: ICE });
  readonly ice = new Ice(this.pc);
  /** One stream per video line, in the order of the lines; `watch` fills the first. */
  readonly streams = Array.from({ length: VIDEO_LINES }, () => new MediaStream());
  private channel: RTCDataChannel;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  readonly opened: Promise<void>;

  constructor(readonly device: string) {
    for (let line = 0; line < VIDEO_LINES; line++) this.pc.addTransceiver("video", { direction: "recvonly" });
    this.pc.ontrack = (event) => {
      const stream = this.streams[this.pc.getTransceivers().indexOf(event.transceiver)];
      if (!stream) return;
      for (const track of stream.getTracks()) stream.removeTrack(track);
      stream.addTrack(event.track);
    };
    this.channel = this.pc.createDataChannel(CHANNEL, { ordered: true });
    this.channel.onmessage = reader((message) => this.answer(message));
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("unreachable")), OPEN_TIMEOUT_MS);
      this.channel.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.opened.catch(() => this.close());
    this.channel.onclose = () => this.close();
    this.pc.onicecandidate = (event) => {
      if (event.candidate) api().sendSignal(device, { candidate: { ...event.candidate.toJSON(), for: "host" } });
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") this.close();
    };
    void this.offer();
  }

  private async offer(): Promise<void> {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    const local = this.pc.localDescription;
    if (local) api().sendSignal(this.device, { sdp: { type: local.type, sdp: local.sdp } });
  }

  async answered(sdp: Sdp): Promise<void> {
    await this.pc.setRemoteDescription(sdp);
    this.ice.flush();
  }

  private answer(message: Message): void {
    const pending = message.id === undefined ? undefined : this.waiting.get(message.id);
    if (!pending || message.id === undefined) return;
    this.waiting.delete(message.id);
    if (message.error !== undefined) pending.reject(new Error(message.error));
    else pending.resolve(message.result);
  }

  async ask(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.opened;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("unreachable"));
        // Why close: when the other computer's page restarts, this side can still look connected for a long while, and
        // every try would wait on the dead connection again; closing it makes the next try connect afresh.
        this.close();
      }, ASK_TIMEOUT_MS);
      this.waiting.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.channel.send(JSON.stringify({ id, method, params }));
    });
  }

  closed = false;
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.waiting.values()) pending.reject(new Error("unreachable"));
    this.waiting.clear();
    this.pc.close();
    if (outgoing.get(this.device) === this) outgoing.delete(this.device);
  }
}

const outgoing = new Map<string, Outgoing>();

function connection(device: string): Outgoing {
  let found = outgoing.get(device);
  if (!found || found.closed) {
    found = new Outgoing(device);
    outgoing.set(device, found);
  }
  return found;
}

/** Asks a computer one question over the connection to it, connecting first when needed. */
export function ask(device: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return connection(device).ask(method, params);
}

/** The current connection to a device (0 when there is none); it changes when a dropped connection is made again. */
export function serial(device: string): number {
  const found = outgoing.get(device);
  return found && !found.closed ? found.serial : 0;
}

/** A still picture of a display as JPEG bytes; `width` asks for a narrower one. */
export async function frame(device: string, display: number, width?: number): Promise<Uint8Array> {
  const result = (await ask(device, "frame", { display, width })) as { jpeg: string };
  return fromBase64(result.jpeg);
}

/** Starts the video of one display; the returned stream gets the picture once it arrives. */
export async function watch(device: string, display: number): Promise<MediaStream> {
  const link = connection(device);
  await link.ask("watch", { display });
  return link.streams[0];
}

/** Starts the video of several displays at once, one stream each in the same order. Rejects when the computer's Remote
 *  is older than side by side viewing ("unknown method watchAll"). */
export async function watchAll(device: string, displays: number[]): Promise<MediaStream[]> {
  const link = connection(device);
  const shown = displays.slice(0, VIDEO_LINES);
  await link.ask("watchAll", { displays: shown });
  return link.streams.slice(0, shown.length);
}

export async function unwatch(device: string): Promise<void> {
  const link = outgoing.get(device);
  if (link && !link.closed) await link.ask("unwatch").catch(() => undefined);
}

// ---- This page as the host ----

class Incoming {
  readonly pc = new RTCPeerConnection({ iceServers: ICE });
  readonly ice = new Ice(this.pc);
  private videos: MediaStreamTrack[] = [];
  private ticking: number | null = null;

  constructor(readonly device: string) {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) api().sendSignal(device, { candidate: { ...event.candidate.toJSON(), for: "viewer" } });
    };
    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label !== CHANNEL) return;
      channel.onmessage = reader((message) => void this.question(channel, message));
      channel.onclose = () => this.close();
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") this.close();
    };
  }

  async offered(sdp: Sdp): Promise<void> {
    await this.pc.setRemoteDescription(sdp);
    this.ice.flush();
    for (const transceiver of this.pc.getTransceivers()) transceiver.direction = "sendonly";
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    const local = this.pc.localDescription;
    if (local) api().sendSignal(this.device, { sdp: { type: local.type, sdp: local.sdp } });
  }

  private async question(channel: RTCDataChannel, message: Message): Promise<void> {
    if (message.id === undefined || !message.method) return;
    try {
      let result: unknown;
      if (message.method === "watch") result = await this.watch([Number(message.params?.display)]);
      else if (message.method === "watchAll") result = await this.watch((message.params?.displays as unknown[]).map(Number), ALL_MAX_WIDTH);
      else if (message.method === "unwatch") result = this.stopVideo();
      else {
        result = await api().hostRequest(this.device, message.method, message.params ?? {});
        if (result instanceof Uint8Array) result = { jpeg: toBase64(result) };
      }
      reply(channel, { id: message.id, result });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      reply(channel, { id: message.id, error: text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") });
    }
  }

  /** Video lines in the order the viewer offered them; an older viewer or the phone offers one. */
  private senders(): RTCRtpSender[] {
    return this.pc.getTransceivers().filter((t) => t.receiver.track.kind === "video").map((t) => t.sender);
  }

  /** Sends each display on its own line, the first on the first line. */
  private async watch(displays: number[], maxWidth?: number): Promise<string> {
    const senders = this.senders();
    if (senders.length === 0) throw new Error("no video line");
    const tracks: MediaStreamTrack[] = [];
    try {
      for (const display of displays.slice(0, senders.length)) {
        const answer = (await api().hostRequest(this.device, "watch", { display })) as { sourceId?: string; fake?: boolean };
        tracks.push(answer.fake ? fakeTrack(display) : await screenTrack(String(answer.sourceId), maxWidth));
      }
    } catch (error) {
      for (const track of tracks) track.stop();
      throw error;
    }
    this.stopVideo();
    this.videos = tracks;
    for (const [line, track] of tracks.entries()) {
      const sender = senders[line];
      // Why: a screen is mostly text, so sharp edges matter more than smooth motion; when the line is slow, fewer
      // pictures a second are sent rather than blurrier ones.
      track.contentHint = "detail";
      await sender.replaceTrack(track);
      const parameters = sender.getParameters();
      parameters.degradationPreference = "maintain-resolution";
      await sender.setParameters(parameters).catch(() => undefined);
    }
    this.ticking = window.setInterval(() => {
      void api()
        .hostRequest(this.device, "viewing", {})
        // Why: seeing turned off meanwhile ends the video at once, not at the next question.
        .catch(() => this.stopVideo());
    }, VIEWING_EVERY_MS);
    return "watching";
  }

  stopVideo(): string {
    if (this.ticking !== null) window.clearInterval(this.ticking);
    this.ticking = null;
    for (const track of this.videos) track.stop();
    this.videos = [];
    for (const sender of this.senders()) void sender.replaceTrack(null).catch(() => undefined);
    return "stopped";
  }

  closed = false;
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopVideo();
    this.pc.close();
    if (incoming.get(this.device) === this) incoming.delete(this.device);
  }
}

const incoming = new Map<string, Incoming>();

/** The screen as a video track, through Chromium's own capture (the same Screen Recording permission). */
async function screenTrack(sourceId: string, maxWidth?: number): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: VIDEO_MAX_FPS,
        ...(maxWidth ? { maxWidth } : {}),
      },
    } as unknown as MediaTrackConstraints,
  });
  return stream.getVideoTracks()[0];
}

/** Debug runs with REMOTE_FAKE_SCREEN=1: a drawn picture with a moving bar, the display and the time, instead of the
 *  screen. */
function fakeTrack(display: number): MediaStreamTrack {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 800;
  const draw = canvas.getContext("2d");
  const paint = () => {
    if (!draw) return;
    const now = Date.now();
    draw.fillStyle = "#24476b";
    draw.fillRect(0, 0, canvas.width, canvas.height);
    draw.fillStyle = "#f5b300";
    draw.fillRect(((now / 4) % (canvas.width + 200)) - 200, 360, 200, 80);
    draw.fillStyle = "#ffffff";
    draw.font = "64px -apple-system, sans-serif";
    draw.fillText(`Remote test ${display} · ${new Date(now).toLocaleTimeString()}`, 80, 160);
  };
  paint();
  const timer = window.setInterval(paint, 1000 / VIDEO_MAX_FPS);
  const track = canvas.captureStream(VIDEO_MAX_FPS).getVideoTracks()[0];
  track.addEventListener("ended", () => window.clearInterval(timer));
  const stop = track.stop.bind(track);
  track.stop = () => {
    window.clearInterval(timer);
    stop();
  };
  return track;
}

// ---- Signals and the main process ----

function signal(message: Signal): void {
  const sdp = message.sdp as Sdp | undefined;
  const candidate = message.candidate as Candidate | undefined;
  if (sdp?.type === "offer") {
    incoming.get(message.from)?.close();
    const link = new Incoming(message.from);
    incoming.set(message.from, link);
    void link.offered(sdp).catch(() => link.close());
  } else if (sdp?.type === "answer") {
    void outgoing.get(message.from)?.answered(sdp).catch(() => outgoing.get(message.from)?.close());
  } else if (candidate) {
    const { for: side, ...init } = candidate;
    if (side === "host") incoming.get(message.from)?.ice.add(init);
    else outgoing.get(message.from)?.ice.add(init);
  }
}

/** Claude asking another computer, through this page (link.ts askPage). Still pictures go back as bytes. */
async function clientRequest(request: ClientRequest): Promise<void> {
  try {
    const result =
      request.method === "frame"
        ? await frame(request.device, Number(request.params.display), request.params.width as number | undefined)
        : await ask(request.device, request.method, request.params);
    api().clientReply(request.rid, true, result);
  } catch (error) {
    api().clientReply(request.rid, false, error instanceof Error ? error.message : String(error));
  }
}

let started = false;

/** Listens for signals and Claude's questions. Called once by the Remote window's page. */
export function startPeers(): void {
  if (started) return;
  started = true;
  api().onSignal(signal);
  api().onPeerLeft((device) => {
    incoming.get(device)?.close();
    outgoing.get(device)?.close();
  });
  api().onDropHosted(() => {
    for (const link of [...incoming.values()]) link.close();
  });
  api().onDropAll(() => {
    for (const link of [...incoming.values(), ...outgoing.values()]) link.close();
  });
  api().onClientRequest((request) => void clientRequest(request));
}
