#!/data/data/com.termux/files/usr/bin/sh
# ♠️🌿🎸🧵 Forest of Gerico — Termux:Boot script
# Owned by @gerico1007/termux-init. Reinstalls overwrite this file.
#
# Keeps this phone reachable and optionally restores standard tmux sessions:
#   1. Acquires a wakelock so Termux stays alive
#   2. Ensures sshd on :8022 is running
#   3. Launches sshd-keeper watchdog in tmux
#   4. Optionally restores Codex tmux sessions
#   5. Logs everything to ~/.termux/boot/boot.log
#
# Requires: Termux:Boot app from F-Droid, launched once after install.

set -u
LOG="$HOME/.termux/boot/boot.log"
CONFIG="$HOME/.config/forest/persistence.env"
mkdir -p "$(dirname "$LOG")"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

if [ -f "$CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG"
fi
ENABLE_SSHD_KEEPER="${ENABLE_SSHD_KEEPER:-1}"
RESTORE_CODEX_TERMUX="${RESTORE_CODEX_TERMUX:-0}"
RESTORE_CODEX_UBUNTU_BRIDGE="${RESTORE_CODEX_UBUNTU_BRIDGE:-0}"

echo "$(ts) ━━━ boot script start ━━━" >> "$LOG"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  echo "$(ts) ⚡ wakelock acquired" >> "$LOG"
else
  echo "$(ts) ⚠️ termux-wake-lock not found (pkg install termux-api)" >> "$LOG"
fi

if pgrep -x sshd >/dev/null 2>&1; then
  echo "$(ts) ✅ sshd already running" >> "$LOG"
else
  if command -v sv >/dev/null 2>&1; then
    sv up sshd >/dev/null 2>&1 || true
    sleep 2
  fi
  pgrep -x sshd >/dev/null 2>&1 || sshd >/dev/null 2>&1 || true
  sleep 2
  if pgrep -x sshd >/dev/null 2>&1; then
    echo "$(ts) ✅ sshd started, listening on :8022" >> "$LOG"
  else
    echo "$(ts) ❌ sshd FAILED to start — check $PREFIX/var/log/sshd.log" >> "$LOG"
  fi
fi

if [ "$ENABLE_SSHD_KEEPER" = "1" ] && [ -x "$HOME/.local/bin/sshd-keeper.sh" ]; then
  if pgrep -af "[s]shd-keeper.sh" >/dev/null 2>&1; then
    echo "$(ts) ✅ sshd-keeper already running" >> "$LOG"
  else
    tmux kill-session -t sshd-keeper >/dev/null 2>&1 || true
    tmux new-session -d -s sshd-keeper "$HOME/.local/bin/sshd-keeper.sh"
    sleep 1
    if pgrep -af "[s]shd-keeper.sh" >/dev/null 2>&1; then
      echo "$(ts) ✅ sshd-keeper launched" >> "$LOG"
    else
      echo "$(ts) ❌ sshd-keeper failed to launch" >> "$LOG"
    fi
  fi
fi

restore_tmux_session() {
  name="$1"
  cmd="$2"
  if tmux has-session -t "$name" 2>/dev/null; then
    echo "$(ts) ✅ tmux session $name already exists" >> "$LOG"
  else
    tmux new-session -d -s "$name" -c "$HOME" "$cmd"
    sleep 2
    if tmux has-session -t "$name" 2>/dev/null; then
      echo "$(ts) ✅ tmux session $name restored" >> "$LOG"
    else
      echo "$(ts) ❌ tmux session $name failed to restore" >> "$LOG"
    fi
  fi
}

if [ "$RESTORE_CODEX_TERMUX" = "1" ] && [ -x "$HOME/.local/bin/codex-termux-hosted" ]; then
  restore_tmux_session codex-termux "$HOME/.local/bin/codex-termux-hosted"
fi

if [ "$RESTORE_CODEX_UBUNTU_BRIDGE" = "1" ] && [ -x "$HOME/.local/bin/codex-ubuntu-bridge" ]; then
  restore_tmux_session codex-ubuntu-bridge "$HOME/.local/bin/codex-ubuntu-bridge"
fi

if command -v tailscale >/dev/null 2>&1; then
  state=$(tailscale status --json 2>/dev/null | grep -m1 '"BackendState"' | tr -d ' ",' || echo 'unknown')
  echo "$(ts) tailscale: $state" >> "$LOG"
else
  echo "$(ts) tailscale CLI not in Termux PATH (Android app handles it)" >> "$LOG"
fi

echo "$(ts) ━━━ boot script complete ━━━" >> "$LOG"
