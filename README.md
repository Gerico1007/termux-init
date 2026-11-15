# @gerico1007/termux-init

> ♠️🌿🎸🧵 Bootstrap a new Termux device into the **Forest of Gerico** mesh — one command from fresh phone to fully integrated team node.

## Install (on a fresh Termux device)

**Prereqs (manual, before npm):**

1. Install **Termux** from F-Droid (NOT Google Play)
2. Install F-Droid companion apps:
   - **Termux:API** (`com.termux.api`)
   - **Termux:Boot** (`com.termux.boot`) — critical for auto-start of sshd at boot
   - **Termux:Widget** (`com.termux.widget`) — for home-screen `.shortcuts/` launchers
   - **Termux:Window** (`com.termux.window`)
   - **Termux:Tasker** (`com.termux.tasker`)
3. Install **Tailscale** (F-Droid or Play Store) and sign in to the `ferret-harmonic.ts.net` tailnet
4. Launch Termux:Boot once after install (so its boot receiver is registered with Android)
5. Inside Termux:

```bash
pkg install -y nodejs
curl -LO https://github.com/Gerico1007/termux-init/releases/download/v0.3.0/gerico1007-termux-init-0.3.0.tgz
npm install -g ./gerico1007-termux-init-0.3.0.tgz
termux-init
```

On a phone without gmtermux, add `--packages --shell` to also install the full package lists and write `~/.bashrc`.

That's it. The bootstrap is idempotent — safe to re-run.

The package is released on GitHub, not on npm. Each [release](https://github.com/Gerico1007/termux-init/releases) carries the `npm pack` tarball; install the newest one. Download it first and install the file: npm 12 refuses to install from a URL by default (`allow-remote = none`) and accepts a local file (`allow-file = all`).

To activate portal persistence on devices that already have `~/web/pixel-recorder.js` present:

```bash
termux-init --restore-portals-on-boot
```

## What it does

Since 0.3.0 termux-init does by default only what no other tool on the phones does ([Gerico1007/termux-init#4](https://github.com/Gerico1007/termux-init/issues/4)). On the forest phones, gmtermux (`miadisabelle/gmtermux`, checked out as the home folder) owns `~/.bashrc` and installs its own packages; termux-init leaves both alone.

| Run | Contents |
|-----|----------|
| **Default** | `~/.termux/boot/01-tailnet-ready.sh` (wakelock + sshd at phone start, sshd-keeper, optional portal watchdog/restore), SSH key generation, mesh trust join with the forest-registry, `~/.ssh/config` Host blocks, the `forest-status` command. Installs openssh, termux-services, jq and curl only when missing. Does not touch `~/.bashrc`. |
| **`--packages`** | Also Tier 1: openssh, tmux, git, gh, curl, jq, fzf, ripgrep, nodejs, npm, python, termux-api/services/tools, @anthropic-ai/claude-code. And Tier 3 (unless `--no-power`): ffmpeg, redis, syncthing, ollama, rust + build-essential, timidity++, play-audio. |
| **`--shell`** | Also writes `~/.bashrc.d/00-core.sh` and a `~/.bashrc` stub that loads `~/.bashrc.d/*.sh`. Use only on a phone whose `~/.bashrc` is not managed by gmtermux; a gmtermux pull replaces it. |

Out of scope for v1: G.Music Assembly layer (see `@gerico1007/gmusic-assembly`, coming). Note: `termux-init` can optionally keep an already-present Pixel Recorder + Clipboard Gallery portal stack alive, but it does not install the portal app itself.

## Architecture

See [DESIGN.md](DESIGN.md) for the full architecture: tier system, registry API, `.bashrc.d` composability, SSH trust flow, idempotency story.

## The three bins

### `termux-init` — runs on the device

Bootstraps the device. Detects Termux, writes the boot config, generates SSH key, fetches the forest pubkey bundle from Eury's `forest-registry`, posts its own key to register the device in the mesh. Packages and the shell file are opt-in (see above).

### `forest-status` — runs on any node

Asks the registry for the node roster and tries SSH to each node. A command on PATH since 0.3.0, so it works whatever owns `~/.bashrc`. `FOREST_REGISTRY_URL` (environment or `~/.env`) overrides the registry address.

### `forest-registry` — runs on Eury (systemd user service)

Tailnet-only HTTP service on port 8773 (Tailscale provides E2E encryption already; HTTP keeps bootstrap cert-free). Owns the pubkey bundle for every Termux node in the forest. Binds to the Tailscale address, or to `127.0.0.1` when Tailscale has no address yet at start.

```
GET  /keys      → concatenated authorized_keys bundle
POST /register  → {hostname, pubkey, ip} → joins mesh
GET  /status    → JSON list of registered nodes
```

### Registry port: 8773 since 0.2.0

Up to 0.1.5 the registry used 8771. On Eury, Miadi's phone-capture also uses 8771, and whichever service started first took it. 8771 stays with Miadi, so from 0.2.0 the registry and every client default use 8773 ([Gerico1007/termux-init#3](https://github.com/Gerico1007/termux-init/issues/3)). `FOREST_REGISTRY_PORT` on Eury and `FOREST_REGISTRY_URL` on a node still override it.

Upgrading from 0.1.x:

- **Eury:** download the 0.2.0 tarball, `npm install -g ./gerico1007-termux-init-0.2.0.tgz`, then `systemctl --user restart forest-registry`. Check with `curl http://eury.ferret-harmonic.ts.net:8773/status`.
- **A Termux node:** download and install the tarball the same way. From 0.3.0 `forest-status` is a command and reads 8773 with no shell file; run it to check.

### Upgrading to 0.3.0

Install the 0.3.0 tarball. That alone gives the `forest-status` command and changes nothing else on the phone. Re-running `termux-init` afterwards rewrites `~/.termux/boot/01-tailnet-ready.sh` with the boot script of #1 and the portal-keeper work (the one Larix already runs), re-registers the node, and leaves `~/.bashrc` alone unless `--shell` is given. Keep the flags the phone was set up with, for example `--restore-portals-on-boot`.

## Forest of Gerico — current mesh

| Node | Role | Tailscale | Platform |
|------|------|-----------|----------|
| Eury | Linux hub (runs forest-registry) | 100.88.23.103 | Linux |
| Iroko | iPhone controller | 100.74.76.22 | iOS |
| Ginkgo | iPad Pro | 100.78.108.48 | iOS |
| Itea | iOS node | 100.124.206.58 | iOS |
| Larix | Android capture (Termux) | 100.124.130.110 | Android |
| Ilex | Sold to William (no longer a forest node) | 100.119.147.78 | Android |
| Tilia | Samsung Android (Termux) | 100.101.211.92 | Android |
| Abies | Lost (no longer a forest node) | 100.73.226.72 | Android |

## License

MIT © Jerry (Gerico1007)
