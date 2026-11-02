// The computer's own Tailscale, which Remote shares instead of joining a network of its own (2026-11-02 decision
// "one network, Tailscale"). Remote only asks it two things through its command line:
//   - status: this computer's network address and the other computers in the same network
//   - whois: which computer an incoming connection comes from, as the network itself vouches for it
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
  UserID: number;
  Tags?: string[] | null;
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
  User: Record<string, { LoginName: string }> | null;
};

/** One computer in the network. `host` is its network name (the first part of its MagicDNS name, `m2-pro-1`), the
 *  same name whois gives, and `address` is the IPv4 address Remote connects to (MagicDNS may be off). */
export type Node = {
  name: string;
  host: string;
  os: string;
  online: boolean;
  address: string | null;
  /** The Tailscale account the computer belongs to (`sun@runners.im`); empty for a tagged computer. */
  login: string;
  tags: string[];
};

/** Who may see and click this computer, and which computers this one lists: the one rule Prompt and Remote share
 *  (2026-11-02). Today it is "the same Tailscale account as this computer". When the tag question
 *  (「[PROMPT] 태그 기기 허락 규칙」) is answered, the tag goes here and nowhere else. */
export function trusted(peer: { login: string; tags: string[] }, self: { login: string } | null): boolean {
  return Boolean(self?.login) && peer.login === self!.login;
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

function node(raw: RawNode, users: RawStatus["User"]): Node {
  return {
    login: users?.[String(raw.UserID)]?.LoginName ?? "",
    tags: raw.Tags ?? [],
    name: raw.HostName,
    host: hostOf(raw.DNSName || raw.HostName),
    os: raw.OS,
    online: raw.Online,
    address: raw.TailscaleIPs?.find((ip) => ip.includes(".")) ?? null,
  };
}

export async function status(): Promise<Status> {
  const raw = JSON.parse(await run(["status", "--json"])) as RawStatus;
  const peers = Object.values(raw.Peer ?? {}).map((p) => node(p, raw.User));
  peers.sort((a, b) => a.name.localeCompare(b.name));
  return { state: raw.BackendState, authUrl: raw.AuthURL, self: raw.Self ? node(raw.Self, raw.User) : null, peers };
}

/** The computer behind `address:port` (a connection's far end), or null when the network does not know it. Why the
 *  network and never the request: a request could claim any name. */
export async function whois(address: string, port: number): Promise<{ host: string; login: string; tags: string[] } | null> {
  try {
    const raw = JSON.parse(await run(["whois", "--json", `${address}:${port}`])) as {
      Node?: { Name?: string; Tags?: string[] | null };
      UserProfile?: { LoginName?: string };
    };
    if (!raw.Node?.Name) return null;
    const tags = raw.Node.Tags ?? [];
    // Why: Tailscale shows a tagged computer's owner as "tagged-devices", which is no one's account.
    const login = tags.length ? "" : (raw.UserProfile?.LoginName ?? "");
    return { host: hostOf(raw.Node.Name), login, tags };
  } catch {
    return null;
  }
}
