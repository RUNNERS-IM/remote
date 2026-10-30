# Remote

See the screens of the other computers in your office, one monitor at a time, and click or type on them remotely. Claude sessions can use the same remote screens through MCP tools.

Remote is made by RUNNERS-IM. It is in early development and has no release yet.

## Plan

1. Receiving side on macOS: capture each monitor and accept clicks and key presses
2. Viewing side: a list of computers, a tab per monitor, view, click and type
3. Connection: computers join our own private network (libtailscale with our own Headscale server) and Remote accepts connections only from that network
4. MCP tools for Claude sessions, with approval for apps not on an allow list and for macOS security dialogs
5. Windows and Linux receiving side, phone apps for the viewing side

## License

Remote is distributed under the MIT License. See [LICENSE.md](LICENSE.md).
