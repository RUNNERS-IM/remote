# Remote

**English** · [한국어](README.ko.md)

See the screens of the other computers in your office, one monitor at a time, and click or type on them remotely. Claude sessions will be able to use the same remote screens through MCP tools.

Remote is made by RUNNERS-IM for the computers in our office. It is written with [Tauri 2](https://tauri.app), like Monitor.

**Remote is in early development and has no release yet.** Right now it only works inside one Mac: it does not connect to other computers and does not listen on the network.

## What works now (stage 1: the receiving side on macOS)

- Remote sits in the menu bar without a Dock icon. Its menu has a status line (computer name and **Remote Off**, **Waiting** or **Being Viewed**), Open Remote, About Remote, Check for Updates (not yet), Settings (not yet), Help & Feedback and Quit Remote.
- The Remote window shows this Mac's displays as tabs and a live picture of the chosen display, about five pictures a second. Pictures are taken with ScreenCaptureKit and sent to the window as JPEG.
- The window shows whether Remote has the two macOS permissions it needs, with a button to ask for each:
  - **Screen Recording**, to take pictures of the screen
  - **Accessibility**, to send clicks and keystrokes
- Clicks and keystrokes are posted with CGEvent, at positions mapped to the chosen display. In the window this is behind a switch labelled **Send Clicks (Test)**, which is off at launch and turns off again when the window closes. While it is off, clicking the picture does nothing.
- Screen text in 18 languages: Arabic, Chinese (Simplified), Dutch, English, Finnish, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Polish, Portuguese, Russian, Spanish, Thai and Vietnamese.

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
pnpm tauri dev      # run with live reload
pnpm tauri build    # build the app
node scripts/check-locales.mjs   # check every locale against ko.json
```

When run with `pnpm tauri dev`, macOS asks for permissions on behalf of the terminal app that started Remote, not Remote itself.

Screen text lives in `locales/`, with `ko.json` as the source. The window (`src/`) and the menu (`src-tauri/`) read the same files.

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
