# DESIGN — @gerico1007/termux-init v1

> ♠️🌿🎸🧵 Authoritative architecture doc. Validators read this before reviewing any code.

## Goal

One npm command brings a fresh Termux device from zero to **fully integrated Forest of Gerico mesh member**:
- All tools installed
- Shell config wired (composable, so other packages can extend it)
- Auto-start sshd at boot (so Eury can reach it after reboots)
- Mutual SSH trust with every other Forest node
- Reachable & authenticated

## Hard constraints

- **Idempotent.** Re-running `termux-init` on a configured device must be safe and converge to the same final state.
- **Composable.** Other future packages (`gmusic-assembly`, `gmusic-webportals`) must be able to layer on without editing `termux-init`-owned files.
- **Tailnet-only registry.** The pubkey registry is reachable only via Tailscale; never expose on public internet.
- **Bare minimum prompts.** Bootstrap should be near-silent on success; the only interactive step is Claude Code's `claude login` after install.

## Tier system

| Tier | Default? | Flag | Contents |
|------|----------|------|----------|
| **0 — Prereqs** | Manual | n/a | F-Droid apps (Termux + companions), Tailscale app, `pkg install -y nodejs` |
| **1 — Core** | Always on | n/a | Base packages, shell config, boot script, SSH mesh trust |
| **3 — Power/Media** | On | `--no-power` to skip | ffmpeg, redis, syncthing, ollama, rust, build tools |
| **2 — G.Music Assembly** | Deferred to future package | — | gmusic-assembly npm, EchoThreads clone, gemini-cli |
| **4 — Web Portals** | Deferred to future package | — | gmtermux clone → becomes `@gerico1007/gmusic-webportals` |

## Tier 1 — Core packages

**Termux pkg (explicit; deps auto-pull):**
```
openssh openssh-sftp-server tmux git git-lfs gh curl wget jq fzf
ripgrep htop lsof less nodejs npm python python-pip openssl
openssl-tool ca-certificates termux-api termux-services termux-tools
termux-auth build-essential keychain dnsutils net-tools inetutils
iproute2 rsync nmap sudo
```

**NPM globals:**
- `@anthropic-ai/claude-code` (Claude Code CLI; alias in 00-core.sh uses it)

## Tier 3 — Power/Media packages

```
ffmpeg timidity++ play-audio redis syncthing ollama rust
rust-std-aarch64-linux-android clang cmake make ninja pkg-config
```

## Composable shell config — `~/.bashrc.d/` pattern

`termux-init` writes:
1. `~/.bashrc` — tiny stub that sources `~/.bashrc.d/*.sh` in lexical order
2. `~/.bashrc.d/00-core.sh` — owned by termux-init, idempotent overwrite

Future packages append their own files (e.g., `40-portals.sh`, `20-assembly.sh`). No collisions, each package can be removed independently.

### `00-core.sh` includes

- PATH prepends: `~/.local/bin`, `~/bin`
- `TMPDIR=$HOME/tmp` (Termux quirk for node/claude-code)
- `DISABLE_AUTOUPDATER=1`
- `claude` alias with TMPDIR + `--dangerously-skip-permissions`
- `~/.env` auto-source (with `set -a`)
- `forest-status` helper — pings every known forest node via Tailscale
- **ngrok backup**: `eury-config` and `eury` shell functions kept (Tailscale primary, ngrok fallback if mesh down)
- `gmeury`, `sshnyro` aliases (ngrok-backed)

Explicitly NOT in 00-core.sh (belong to future packages):
- `gmusic`, `gmusic-help` (Assembly)
- `web-portals`, `qr-ritual`, `qr-pixel`, `qr-clipboard`, `qr-abc`, `clipboard-tts` (Portals)
- `PROMPT_COMMAND` log_action_to_abc.sh hook (Assembly)
- `pixelw`, `gmday`, `abcview`, `claude-run` (orphaned helpers)

## Termux:Boot script — `~/.termux/boot/01-tailnet-ready.sh`

Lifted verbatim from Larix. Runs at every Android boot (when Termux:Boot app is installed):
1. Acquire wakelock (`termux-wake-lock`) — without this Android freezes Termux processes
2. Start sshd on :8022 if not already running
3. Log Tailscale backend state

Critical: without this, the device drops off the mesh after every reboot.

## SSH mesh trust flow

**On the device (termux-init):**
1. `ssh-keygen -t ed25519 -N ''` if `~/.ssh/id_ed25519` is missing
2. `GET http://eury.ferret-harmonic.ts.net:8771/keys` — fetch the authorized bundle
   - **Retry**: exponential backoff, 3 attempts over ~30s (delays 2s, 8s, 20s)
   - **On final failure**: skip mesh-trust step with clear error + manual fallback snippet (Jerry pastes the keys by hand). Bootstrap continues so the device is still usable.
3. Append fetched keys to `~/.ssh/authorized_keys` (dedupe by full key string)
4. `POST http://eury:8771/register` with `{hostname, pubkey, tailscale_ip}` to register self
5. Enable `sshd` via `sv-enable sshd` (runit-managed via termux-services)

Note: transport is plain HTTP because Tailscale already provides E2E encryption across the tailnet, and the registry binds **only** to the Tailscale interface (not 0.0.0.0). HTTPS can be added in a later version if defense-in-depth is desired.

**On Eury (forest-registry):**
1. Persists registered nodes in `~/.forest-registry/nodes.json`:
   ```json
   {
     "nodes": [
       { "hostname": "larix", "pubkey": "ssh-ed25519 …", "ip": "100.124.130.110", "registered_at": "2026-05-17T…" }
     ]
   }
   ```
2. `GET /keys` returns concatenated `ssh-ed25519 … hostname` lines for every registered node, suitable for direct append into authorized_keys
3. `POST /register` is idempotent — same hostname re-registers, updates pubkey/ip if changed
4. Atomic writes (temp file + rename) to avoid corruption
5. **Bind**: only on Tailscale interface (detect Tailscale IP at boot, bind explicitly to it — no `0.0.0.0`)

## Registry seeding

First-time setup: `forest-registry seed` SSHs into each known Termux node (larix, ilex, tilia, abies), reads its `~/.ssh/id_ed25519.pub` (generating if missing), and registers it. Bootstraps the bundle so subsequent `termux-init` runs on new devices get the full forest.

Eury's own pubkey is also seeded (so Termux devices trust Eury).

## Idempotency rules

| Operation | Idempotent how |
|-----------|----------------|
| `pkg install -y X` | Termux's pkg is naturally idempotent |
| `npm install -g X` | npm is naturally idempotent |
| Shell snippet write | Overwrite `~/.bashrc.d/00-core.sh` every run; stub `~/.bashrc` written only if missing or doesn't start with our sentinel comment |
| Boot script | Overwrite `~/.termux/boot/01-tailnet-ready.sh`, chmod +x |
| `.env` | Only write if missing (don't clobber user secrets) |
| `termux.properties` | Only write if missing (user may have customized) |
| SSH key | Only generate if `~/.ssh/id_ed25519` missing |
| `authorized_keys` | Append fetched keys, dedupe by full match |
| Registry POST | Server upserts by hostname |

## Failure modes & user feedback

- Not running on Termux → abort early with clear message
- No Tailscale connectivity to eury → abort, print "ensure Tailscale Always-On is enabled and you're signed in to ferret-harmonic.ts.net"
- Registry unreachable after retries → abort SSH step (continue rest), print manual fallback snippet with the known forest pubkeys (cached in package)
- `pkg install` failure → abort with the failing package name + suggested troubleshooting
- Termux:Boot app not installed → print warning but don't fail (boot script still gets written; will activate when user installs the app)

## Scope cuts (explicit)

- ❌ iOS nodes (iroko, ginkgo, itea) — no sshd; one-way connections only
- ❌ Tailscale install/config — relies on Android app
- ❌ Key rotation tooling — manual for now
- ❌ kiro-cli (~500MB binaries) — separate concern
- ❌ Web portals — separate package `gmusic-webportals`
- ❌ G.Music Assembly layer — separate package `gmusic-assembly`

## Security model

The package contains **no secrets**. All sensitive data (SSH private keys, OAuth tokens, etc.) is generated or fetched at runtime. The actual security boundaries are:

| Layer | What it protects | Who controls it |
|-------|------------------|------------------|
| **Tailscale tailnet** (`ferret-harmonic.ts.net`) | The registry endpoint + all node SSH access — none of these are reachable from public internet | Jerry, via Tailscale admin console (approves devices) |
| **SSH `authorized_keys`** on each node | Inbound SSH; the bundle from `forest-registry /keys` populates this | Each device's local file; populated via mesh-trust step |
| **OAuth refresh token lifetime** | If the credentials are exfiltrated, they auto-expire (~weeks) | Anthropic-side |

**`--seed-claude-auth=<host>` flag** (opt-in, never automatic): SCPs `~/.claude/.credentials.json` from the named host. Subject to all three layers above. Logs the transfer on the source host (`~/.forest-claude-sync.log`) for audit.

**Known soft spots (acceptable for v1):**
- `POST /register` on the registry has no auth — any device on the tailnet can register any pubkey. Mitigation: tailnet membership IS the gate.
- Eury's `authorized_keys` is updated via the registry's bundle; if a hostile device gets on the tailnet, registering pushes its key into Eury's trust. Mitigation: Tailscale approval is manual.

## Open questions (post-v1)

- Shared secret for `POST /register` (defense in depth even within tailnet)
- Eury-side approval gate for new registrations (interactive prompt / Tasker notification)
- Hostname allowlist for `--seed-claude-auth` destinations
- Should the registry auto-patch Eury's `~/.ssh/authorized_keys` (currently manual)
- Should the registry auto-patch CLAUDE.md / SKILL.md files on Eury when a node registers
- Key rotation strategy when a device is lost/wiped
