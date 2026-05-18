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
npm install -g @gerico1007/termux-init
termux-init
```

That's it. The bootstrap is idempotent — safe to re-run.

## What it does

| Tier | Contents |
|------|----------|
| **Tier 1 — Core** | openssh, tmux, git, gh, curl, jq, fzf, ripgrep, nodejs, npm, python, termux-api/services/tools, @anthropic-ai/claude-code, the canonical `~/.bashrc.d/00-core.sh`, `~/.termux/boot/01-tailnet-ready.sh` (wakelock + sshd autostart), SSH key generation, mesh trust join |
| **Tier 3 — Power/Media** | ffmpeg, redis, syncthing, ollama, rust + build-essential, timidity++, play-audio |

Out of scope for v1: G.Music Assembly layer (see `@gerico1007/gmusic-assembly`, coming), web portals (see `@gerico1007/gmusic-webportals`, coming).

## Architecture

See [DESIGN.md](DESIGN.md) for the full architecture: tier system, registry API, `.bashrc.d` composability, SSH trust flow, idempotency story.

## The two bins

### `termux-init` — runs on the device

Bootstraps the device. Detects Termux, installs tier packages, writes shell + boot config, generates SSH key, fetches the forest pubkey bundle from Eury's `forest-registry`, posts its own key to register the device in the mesh.

### `forest-registry` — runs on Eury (systemd user service)

Tailnet-only HTTP service on port 8771 (Tailscale provides E2E encryption already; HTTP keeps bootstrap cert-free). Owns the pubkey bundle for every Termux node in the forest. Binds explicitly to the Tailscale interface.

```
GET  /keys      → concatenated authorized_keys bundle
POST /register  → {hostname, pubkey, ip} → joins mesh
GET  /status    → JSON list of registered nodes
```

## Forest of Gerico — current mesh

| Node | Role | Tailscale | Platform |
|------|------|-----------|----------|
| Eury | Linux hub (runs forest-registry) | 100.88.23.103 | Linux |
| Iroko | iPhone controller | 100.74.76.22 | iOS |
| Ginkgo | iPad Pro | 100.78.108.48 | iOS |
| Itea | iOS node | 100.124.206.58 | iOS |
| Larix | Android capture (Termux) | 100.124.130.110 | Android |
| Ilex | Android capture (Termux) | 100.119.147.78 | Android |
| Tilia | Samsung Android (Termux) | 100.101.211.92 | Android |
| Abies | Android capture (Termux) | 100.73.226.72 | Android |

## License

MIT © Jerry (Gerico1007)
