# remote-link

The connection program Remote starts (`electron/main/link.ts`). It joins our private network with
[tsnet](https://tailscale.com/kb/1244/tsnet) and our own coordination server ([Headscale](https://headscale.net)),
listens on port 7787 of the network address only, and passes each request to Remote with the asking computer's name.
Remote reaches other computers through its local API on 127.0.0.1 (`/status`, `/peer/<name>/…`), guarded by a token
Remote makes at every start.

```sh
pnpm link:build                      # link/bin.noindex/remote-link-<os>-<cpu>
bash scripts/build-link.sh win32 x64 # another OS and CPU
```

## A test network on one Mac

Two copies of Remote on one Mac, joined through a Headscale running on the same Mac. Nothing leaves the Mac except
the relay map Headscale reads from Tailscale.

```sh
cd link
GOBIN=$PWD/dev.noindex go install github.com/juanfont/headscale/cmd/headscale@v0.29.7
mkdir -p dev.noindex/hs
# Copy Headscale's config-example.yaml to dev.noindex/hs/config.yaml, point every /var/lib/headscale and
# /var/run/headscale path into dev.noindex/hs, and set server_url and listen_addr to 127.0.0.1:8787.
dev.noindex/headscale -c dev.noindex/hs/config.yaml serve &
dev.noindex/headscale -c dev.noindex/hs/config.yaml users create office
dev.noindex/headscale -c dev.noindex/hs/config.yaml preauthkeys create --user 1 --reusable --expiration 24h

cd ..
pnpm build && pnpm link:build
for n in a b; do
  REMOTE_LINK_SERVER=http://127.0.0.1:8787 REMOTE_LINK_KEY=<key> REMOTE_LINK_NAME=dev-$n \
    ./node_modules/.bin/electron . --user-data-dir=/tmp/remote-dev-$n &
done
```

`dev-b`'s Remote window then lists `dev-a`. The `REMOTE_LINK_*` values work in debug runs only; an installed Remote
takes the server typed under the computer tabs or from an office link, `remote://join?server=…`
(`electron/main/join.ts`), and keeps it as `linkServer` in `settings.json` in its user data folder. Each server gets its own
identity folder (`link/<host>`), so switching back to a server finds its earlier approval. A computer that joins without a
key waits on the server until an administrator approves it: `headscale auth register --auth-id <id> --user <user>`, with
the id from the end of the approval address.
