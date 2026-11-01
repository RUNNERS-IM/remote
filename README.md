# Remote

**English** · [한국어](README.ko.md)

See the screens of the other computers in your office, one monitor at a time, and click or type on them remotely. Claude sessions can use the same remote screens through MCP tools.

Remote is made by RUNNERS-IM for the computers in our office. It is written with [Electron](https://www.electronjs.org) and one Rust native module, like Monitor.

**Remote is in early development and has no release yet.** Connecting computers needs our own coordination server (Headscale), which is not set up yet; until it is, Remote shows only the computer it runs on.

## What works now

- Remote sits in the menu bar without a Dock icon. The menu-bar picture shows the state: a frame only when **Remote Off**, an arrow when **Waiting**, and a moving arrow while **Being Viewed**. When Remote is off, the status line says why (**macOS Only** or **Screen Recording Needed**).
- Clicking the menu-bar icon opens a panel; right-clicking opens a menu with the same lines in the same groups as Monitor: the status line, Open Remote, Open at login, Check for Updates Automatically, About Remote, Check for Updates…, Help & Feedback and Quit Remote. The panel also shows whether the Screen Recording and Accessibility permissions are on, with an **Allow…** button for each.
- The Remote window shows this Mac's displays as tabs and a live picture of the chosen display, about five pictures a second. Pictures are taken with ScreenCaptureKit and sent to the window as JPEG.
- Remote needs two macOS permissions:
  - **Screen Recording**, to take pictures of the screen
  - **Accessibility**, to send clicks and keystrokes
- Clicks are posted with CGEvent, at positions mapped to the chosen display. In the window this is behind a switch labelled **Send Clicks**, which is off at launch and turns off again when the window closes. While it is off, clicking the picture does nothing.
- **Other computers** (stages 2 and 3): every Remote joins our own private network through `remote-link` (`link/`, Go, the tsnet library from Tailscale) and our coordination server. The Remote window then has a tab per computer; choosing one shows its monitors and screen the same way, and with **Send Clicks** on, clicking the picture clicks there and keys typed after clicking go there (a text box sends Korean and other composed text). Remote listens only on that network address, and every request carries the asking computer's name as the network vouches for it.
- On the computer being looked at: **Let Other Computers See This** (on by default) and **Let Other Computers Click and Type** (off by default) in the panel and the menu, the yellow **Being Viewed** state with who is looking, **Disconnect Now**, which turns seeing off at once, and a connection log in the Remote window (who started viewing, clicked, pressed keys or typed; never what was typed).
- **Claude** (stage 4): `resources/mcp/remote-mcp.mjs` is an MCP server with six tools: `remote_computers`, `remote_displays`, `remote_screenshot`, `remote_click`, `remote_type`, `remote_key`. Looking needs no approval (the other computer's switch decides). Clicking and typing follow the allow list: in an app on it Claude acts at once; in any other app a person at the computer Claude runs on approves first and can add the app to the list; in a macOS security window (password prompts, System Settings) a person approves every time. Claude cannot click a computer whose **Click and Type** switch is off, and nobody is asked in that case.
- Remote checks for updates once a day (see [PRIVACY.md](PRIVACY.md)) and opens at login unless that line is turned off.
- Screen text in 20 languages: Arabic, Chinese (Simplified), Chinese (Traditional), Dutch, English, Finnish, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Polish, Portuguese, Russian, Spanish, Thai, Turkish and Vietnamese.

## Roadmap

1. Receiving side on macOS: capture each monitor and accept clicks and key presses (done)
2. Viewing side: a list of computers, a tab per monitor, view, click and type (done)
3. Connection: our own private network (tsnet with our own Headscale server), a connection log, the "being viewed" sign and a one-click disconnect (done, tested with a Headscale on one Mac; the office server is not set up yet)
4. MCP tools for Claude sessions with approval (done)
5. Windows and Linux receiving side, phone apps for the viewing side (not started; Windows and Linux builds can view other computers but cannot be viewed)

## Using Remote with Claude

```sh
claude mcp add remote -- env ELECTRON_RUN_AS_NODE=1 /Applications/Remote.app/Contents/MacOS/Remote \
  /Applications/Remote.app/Contents/Resources/mcp/remote-mcp.mjs
```

Remote must be running. The script talks to it over a socket only your user can open (`claude.sock` in Remote's
folder under Application Support).

## Building from source

Requires macOS 14 or later, [Rust](https://rustup.rs), Node.js 20 or later and pnpm.

```sh
pnpm install
pnpm native         # build the native module (native/) for this computer
pnpm link:build     # build remote-link (link/, needs Go) for this computer
pnpm dev            # run with live reload
pnpm dist           # build the app for this OS into dist.noindex/
pnpm check:locales  # check every locale against ko.json
```

For an Intel Mac build on Apple silicon, also run `pnpm native --target x86_64-apple-darwin` (after `rustup target add x86_64-apple-darwin`).

- `electron/main/` is the main process (tray, panel, viewer and About windows, status, updates), `electron/preload/` the bridge the page talks through, `src/` the panel, viewer and About pages.
- `native/` is the one native module (napi-rs): display capture, posted clicks, the app in front, permission checks and the tray picture.
- `link/` is `remote-link`, the connection program Remote starts (see [link/README.md](link/README.md) for a test network on one Mac). `electron/main/link.ts` starts it and serves other computers; `electron/main/claude.ts` serves the MCP script.
- Screen text lives in `locales/`, with `ko.json` as the source; the page and the main process read the same files.
- Debug runs take `REMOTE_OPEN=panel|viewer|about` and `REMOTE_THEME=dark|light`. A packaged app ignores them.

When run with `pnpm dev`, macOS asks for permissions on behalf of the terminal app that started Remote, not Remote itself.

So far Remote has been built and checked on macOS (Apple silicon) only. On Windows and Linux it only says that Remote works on macOS for now.

## Releasing

Merging into the `release` branch builds and publishes a release (`.github/workflows/release.yml`). Before that, write
this release's changes in `RELEASE_NOTES.md`. It becomes the GitHub release text, and the update window shows its list
under "What's new":

```md
## 한국어

- 한 줄에 바뀐 점 하나씩, 합니다체로 씁니다.

## English

- One change per line.
```

Korean screens read the `## 한국어` list, every other language the `## English` one. The version bump
(`scripts/bump-release.sh`) stops when either list is empty or the file is the same as the last release's.

## Uninstall

1. Choose **Quit Remote** from the menu bar.
2. Move Remote from Applications to the Trash.
3. Remove the permissions in System Settings → Privacy & Security → Screen & System Audio Recording and Accessibility, or run:

```sh
tccutil reset ScreenCapture im.runners.remote
tccutil reset Accessibility im.runners.remote
```

## Privacy

Remote collects nothing for Runners. Screens travel only between computers in the same private network. See [PRIVACY.md](PRIVACY.md).

## License

Copyright (c) 2026 Runners Co., Ltd. All rights reserved. The source is published for reading only; see [LICENSE.md](LICENSE.md).
