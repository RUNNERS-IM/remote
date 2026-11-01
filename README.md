# Remote

**English** · [한국어](README.ko.md)

See the screens of the other computers in your office, one monitor at a time, and click or type on them remotely. Claude sessions will be able to use the same remote screens through MCP tools.

Remote is made by RUNNERS-IM for the computers in our office. It is written with [Electron](https://www.electronjs.org) and one Rust native module, like Monitor.

**Remote is in early development and has no release yet.** Right now it only works inside one Mac: it does not connect to other computers and does not listen on the network.

## What works now (stage 1: the receiving side on macOS)

- Remote sits in the menu bar without a Dock icon. The menu-bar picture shows the state: a frame only when **Remote Off**, an arrow when **Waiting**, and a moving arrow while **Being Viewed**. When Remote is off, the status line says why (**macOS Only** or **Screen Recording Needed**).
- Clicking the menu-bar icon opens a panel; right-clicking opens a menu with the same lines in the same groups as Monitor: the status line, Open Remote, Open at login, Check for Updates Automatically, About Remote, Check for Updates…, Help & Feedback and Quit Remote. The panel also shows whether the Screen Recording and Accessibility permissions are on, with an **Allow…** button for each.
- The Remote window shows this Mac's displays as tabs and a live picture of the chosen display, about five pictures a second. Pictures are taken with ScreenCaptureKit and sent to the window as JPEG.
- Remote needs two macOS permissions:
  - **Screen Recording**, to take pictures of the screen
  - **Accessibility**, to send clicks and keystrokes
- Clicks are posted with CGEvent, at positions mapped to the chosen display. In the window this is behind a switch labelled **Send Clicks**, which is off at launch and turns off again when the window closes. While it is off, clicking the picture does nothing.
- Remote checks for updates once a day (see [PRIVACY.md](PRIVACY.md)) and opens at login unless that line is turned off.
- Screen text in 20 languages: Arabic, Chinese (Simplified), Chinese (Traditional), Dutch, English, Finnish, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Polish, Portuguese, Russian, Spanish, Thai, Turkish and Vietnamese.

## Roadmap

1. Receiving side on macOS: capture each monitor and accept clicks and key presses (in progress)
2. Viewing side: a list of computers, a tab per monitor, view, click and type
3. Connection: computers join our own private network (libtailscale with our own Headscale server) and Remote accepts connections only from that network, with a connection log, a "being viewed" sign and a one-click disconnect
4. MCP tools for Claude sessions, with approval for apps not on an allow list and for macOS security dialogs
5. Windows and Linux receiving side, phone apps for the viewing side

## Building from source

Requires macOS 14 or later, [Rust](https://rustup.rs), Node.js 20 or later and pnpm.

```sh
pnpm install
pnpm native         # build the native module (native/) for this computer
pnpm dev            # run with live reload
pnpm dist           # build the app for this OS into dist.noindex/
pnpm check:locales  # check every locale against ko.json
```

For an Intel Mac build on Apple silicon, also run `pnpm native --target x86_64-apple-darwin` (after `rustup target add x86_64-apple-darwin`).

- `electron/main/` is the main process (tray, panel, viewer and About windows, status, updates), `electron/preload/` the bridge the page talks through, `src/` the panel, viewer and About pages.
- `native/` is the one native module (napi-rs): display capture, posted clicks, permission checks and the tray picture.
- Screen text lives in `locales/`, with `ko.json` as the source; the page and the main process read the same files.
- Debug runs take `REMOTE_OPEN=panel|viewer|about` and `REMOTE_THEME=dark|light`. A packaged app ignores them.

When run with `pnpm dev`, macOS asks for permissions on behalf of the terminal app that started Remote, not Remote itself.

So far Remote has been built and checked on macOS (Apple silicon) only. On Windows and Linux it only says that Remote works on macOS for now.

## Uninstall

1. Choose **Quit Remote** from the menu bar.
2. Move Remote from Applications to the Trash.
3. Remove the permissions in System Settings → Privacy & Security → Screen & System Audio Recording and Accessibility, or run:

```sh
tccutil reset ScreenCapture im.runners.remote
tccutil reset Accessibility im.runners.remote
```

## Privacy

Remote collects nothing and sends nothing. See [PRIVACY.md](PRIVACY.md).

## License

Copyright (c) 2026 Runners Co., Ltd. All rights reserved. The source is published for reading only; see [LICENSE.md](LICENSE.md).
