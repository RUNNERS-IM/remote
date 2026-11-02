// The computer's own Tailscale, which Remote shares instead of joining a network of its own (2026-11-02 decision
// "one network, Tailscale"). Remote asks its command line one thing, `tailscale status`: this computer's network
// address and the other computers in the same network, with their addresses. Who is calling is found there by the
// calling address (2026-11-02 decision 「[REMOTE] 누구에게 화면을 보일까」 1A: every computer of the same network is
// let in, only computers shared in from another network are not).
//
// Why the command line and not the local API socket: the socket's place differs between the Homebrew daemon, the Mac
// App Store app, the standalone Mac app, Windows and Linux, and the command line already knows each of them.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

/** Where each way of installing Tailscale puts its command line. Why a list: an app opened from Finder does not get
 *  the shell's PATH, so /opt/homebrew/bin is not searched by itself. */
const CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ],
  linux: ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/usr/sbin/tailscale"],
  win32: ["C:\\Program Files\\Tailscale\\tailscale.exe"],
};

const TIMEOUT_MS = 5000;

let found: string | null | undefined;

/** The tailscale command on this computer, or null when Tailscale is not installed. Looked up again while missing,
 *  so installing Tailscale while Remote runs is noticed. */
export function binary(): string | null {
  if (found) return found;
  found = (CANDIDATES[process.platform] ?? []).find((path) => existsSync(path)) ?? null;
  return found;
}

function run(args: string[]): Promise<string> {
  const file = binary();
  if (!file) return Promise.reject(new Error("noTailscale"));
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr).trim() || error.message));
      else resolve(stdout);
    });
  });
}

/** The parts of `tailscale status --json` Remote reads. */
type RawNode = {
  HostName: string;
  /** True for a computer another network shared into this one. */
  ShareeNode?: boolean;
  DNSName: string;
  OS: string;
  Online: boolean;
  TailscaleIPs: string[] | null;
};
type RawStatus = {
  BackendState: string;
  AuthURL: string;
  Self: RawNode | null;
  Peer: Record<string, RawNode> | null;
};

/** One computer in the network. `host` is its network name (the first part of its MagicDNS name, `m2-pro-1`). */
export type Node = {
  name: string;
  host: string;
  os: string;
  online: boolean;
  /** The IPv4 address Remote connects to (MagicDNS may be off). */
  address: string | null;
  /** Every Tailscale address of the computer, IPv4 and IPv6, to find a caller by. */
  addresses: string[];
  /** Shared in from another Tailscale network. */
  sharedIn: boolean;
};

/** Who may see and click this computer, and which computers this one lists (2026-11-02 「[REMOTE] 누구에게 화면을
 *  보일까」 1A). Every computer of the same Tailscale network is let in (people's computers, tagged computers and
 *  phones); only a computer shared in from another network is not. Whose account a computer belongs to is not looked
 *  at. Why so wide: the computers people watch are mostly office Macs nobody sits at, so a rule that needs someone at
 *  the Mac would lock them out; the See This and Click and Type switches on each Mac are the next doors. */
export function trusted(peer: Node): boolean {
  return !peer.sharedIn;
}

/** Tailscale hands out 100.64.0.0/10 and fd7a:115c:a1e0::/48. Anything else never came over the network. */
export function isTailnetAddress(address: string): boolean {
  const v4 = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(address);
  if (v4) return Number(v4[1]) >= 64 && Number(v4[1]) <= 127;
  return address.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

/** The computer at `address` among `status`'s peers if it may come in, or null (not from the network, this computer
 *  itself, not in the network, or shared in). */
export function caller(address: string, now: Status): Node | null {
  if (!isTailnetAddress(address)) return null;
  if (now.self?.addresses.includes(address)) return null;
  const peer = now.peers.find((p) => p.addresses.includes(address));
  return peer && trusted(peer) ? peer : null;
}

export type Status = {
  /** NoState, NeedsLogin, NeedsMachineAuth, Stopped, Starting or Running. */
  state: string;
  authUrl: string;
  self: Node | null;
  peers: Node[];
};

/** `m2-pro-1.tail1234.ts.net.` -> `m2-pro-1` */
export function hostOf(dnsName: string): string {
  const name = dnsName.replace(/\.$/, "");
  const dot = name.indexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
}

function node(raw: RawNode): Node {
  return {
    addresses: raw.TailscaleIPs ?? [],
    sharedIn: raw.ShareeNode === true,
    name: raw.HostName,
    host: hostOf(raw.DNSName || raw.HostName),
    os: raw.OS,
    online: raw.Online,
    address: raw.TailscaleIPs?.find((ip) => ip.includes(".")) ?? null,
  };
}

export async function status(): Promise<Status> {
  const raw = JSON.parse(await run(["status", "--json"])) as RawStatus;
  const peers = Object.values(raw.Peer ?? {}).map(node);
  peers.sort((a, b) => a.name.localeCompare(b.name));
  return { state: raw.BackendState, authUrl: raw.AuthURL, self: raw.Self ? node(raw.Self) : null, peers };
}
