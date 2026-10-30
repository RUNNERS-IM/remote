// Packaging for Remote (electron-builder), the same toolchain and shape as Monitor.
//
//   pnpm dist                      unsigned build for this computer, into dist.noindex/
//   REMOTE_RELEASE=1 ...          release build: hardened runtime, Developer ID signing and notarization (CI)
//   REMOTE_TAG=2.6.1030.2 ...     file names use the release tag instead of the in-app version (CI)
//
// Why the tag in file names: the in-app version of a same-day release is 2.6.1030+2 (semver), and a "+" in a
// GitHub release file name is not kept as is; the tag 2.6.1030.2 is what people see anyway.
// The native module (native/remote-native.<os>-<cpu>*.node) must be built for every CPU being packaged first
// (pnpm native, plus --target x86_64-apple-darwin for Intel Macs).
const isRelease = process.env.REMOTE_RELEASE === "1";
const tag = process.env.REMOTE_TAG || "${version}";

// Why: Windows keeps a file version as four numbers of at most 65535 each, so a "+2" cannot go in it. The same-day
// number becomes the fourth number (2.6.1030+2 -> 2.6.1030.2, 2.6.1030 -> 2.6.1030.0), the same split Prompt uses
// for its Windows version. The day part 2.6.MDD stays under 65535 (MDD is at most 1231). The semver version that
// updates compare is not changed.
const version = require("./package.json").version;
const [base, sameDay = "0"] = version.split("+");
const buildVersion = `${base}.${sameDay}`;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // Why: the same app id as the Tauri build, so macOS keeps the Screen Recording and Accessibility permissions
  // already given to it (they are stored per app id and signing team).
  appId: "im.runners.remote",
  productName: "Remote",
  executableName: "remote",
  buildVersion,
  copyright: "© 2026 RUNNERS. All rights reserved.",
  directories: { output: "dist.noindex", buildResources: "build" },
  // Why: React and the icons are bundled into out/renderer by vite; they stay prod dependencies only so the open
  // source notices list them, and are left out of the app's node_modules.
  files: [
    "out/**",
    "resources/menu/**",
    "package.json",
    "!**/*.map",
    "!node_modules/{react,react-dom,scheduler,lucide-react}/**",
  ],
  extraResources: [{ from: "native", to: "native", filter: ["remote-native.${platform}-${arch}*.node"] }],
  // Why: no npm package with native code ships; the one native module is built by cargo above.
  npmRebuild: false,
  mac: {
    category: "public.app-category.utilities",
    icon: "build/icon.icns",
    // Why: screen pictures use ScreenCaptureKit's screenshot call, which macOS 14 added.
    minimumSystemVersion: "14.0",
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    artifactName: `Remote-${tag}-mac-\${arch}.\${ext}`,
    hardenedRuntime: isRelease,
    notarize: isRelease,
    // Why: a local build is not signed with the Developer ID; it is signed ad hoc so it still opens on this Mac.
    ...(isRelease ? {} : { identity: null }),
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    extendInfo: {
      // Remote lives in the menu bar only: no Dock icon, no app menu.
      LSUIElement: true,
    },
  },
  dmg: { artifactName: `Remote-${tag}-mac-\${arch}.\${ext}` },
  forceCodeSigning: isRelease,
  win: {
    icon: "build/icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: `remote-${tag}-windows-x64-setup.\${ext}`,
  },
  nsis: { oneClick: true, perMachine: false },
  linux: {
    icon: "build/icon.icns",
    category: "Utility",
    target: ["AppImage", "deb", "rpm"],
    maintainer: "RUNNERS",
    synopsis: "See and click the screens of other computers",
  },
  appImage: { artifactName: `remote-${tag}-linux-x86_64.AppImage` },
  deb: { artifactName: `remote-${tag}-linux-amd64.deb` },
  rpm: { artifactName: `remote-${tag}-linux-x86_64.rpm` },
  // Read by electron-updater inside the app (app-update.yml). CI uploads the files itself (--publish never).
  publish: { provider: "github", owner: "RUNNERS-IM", repo: "remote" },
};
