// Usage statistics through runners-app-kit: whether the person agreed and, only if they did, how many times each
// feature was used per day. Asking is the Remote window's sheet and Settings' General tab; keeping and sending the
// counts is runners/usage-stats.ts.
import { app } from "electron";
import { join } from "node:path";
import { accessToken, accessTokenExpiry, API_URL, refresh } from "./account";
import { createUsageStats, type UsageConsent, type UsageStats } from "./runners/usage-stats";
import { displayVersion } from "./updates";

const DAY_MS = 24 * 60 * 60 * 1000;

let stats: UsageStats | null = null;

// Why not an expired token: a computer that was asleep starts with one, and the server would refuse the day's counts.
async function freshToken(): Promise<string | null> {
  const expiry = accessTokenExpiry();
  if (expiry !== null && expiry <= Date.now()) await refresh();
  return accessToken();
}

/** Why made on first use: index.ts moves debug runs to their own data folder after this file is loaded. */
function usage(): UsageStats {
  stats ??= createUsageStats({
    version: displayVersion(),
    filePath: join(app.getPath("userData"), "usage-stats.json"),
    token: freshToken,
    // Why: a debug run sends only to the test server it was pointed at (null sends nothing), never to the real one.
    endpoint: app.isPackaged ? undefined : process.env.REMOTE_API_URL ? `${API_URL}/api/mobile/usage` : null,
  });
  return stats;
}

export function consent(): UsageConsent {
  return usage().consent();
}

export function setConsent(granted: boolean): void {
  usage().setConsent(granted);
}

export function count(feature: string): void {
  usage().count(feature);
}

/** Keeps counts made since the last save; called as the app quits. */
export function save(): void {
  usage().save();
}

/** Sends the finished days now and once a day after, since Remote can stay open for weeks. */
export function startSending(): void {
  void usage().flush();
  setInterval(() => void usage().flush(), DAY_MS);
}
