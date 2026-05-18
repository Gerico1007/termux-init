#!/data/data/com.termux/files/usr/bin/sh
# ♠️🌿🎸🧵 Forest of Gerico — Termux:Boot script
# Owned by @gerico1007/termux-init. Reinstalls overwrite this file.
#
# Keeps this phone reachable on the tailnet at boot:
#   1. Acquires a wakelock so Termux stays alive
#   2. Starts sshd on :8022 if not running
#   3. Logs tailscale state for visibility
#
# Deploy location:  ~/.termux/boot/01-tailnet-ready.sh   (chmod +x)
# Requires:         Termux:Boot app from F-Droid, launched once after install.

set -u
LOG="$HOME/.termux/boot/boot.log"
mkdir -p "$(dirname "$LOG")"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

echo "$(ts) ━━━ boot script start ━━━" >> "$LOG"

# 1. Wakelock — without this, Android may freeze Termux processes
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  echo "$(ts) ⚡ wakelock acquired" >> "$LOG"
else
  echo "$(ts) ⚠️  termux-wake-lock not found (pkg install termux-api)" >> "$LOG"
fi

# 2. sshd on port 8022
if pgrep -x sshd >/dev/null 2>&1; then
  echo "$(ts) ✅ sshd already running" >> "$LOG"
else
  sshd
  sleep 2
  if pgrep -x sshd >/dev/null 2>&1; then
    echo "$(ts) ✅ sshd started, listening on :8022" >> "$LOG"
  else
    echo "$(ts) ❌ sshd FAILED to start — check $PREFIX/var/log/sshd.log" >> "$LOG"
  fi
fi

# 3. Tailscale state report (Tailscale Android app handles the actual connection)
if command -v tailscale >/dev/null 2>&1; then
  state=$(tailscale status --json 2>/dev/null | grep -m1 '"BackendState"' | tr -d ' ",' || echo 'unknown')
  echo "$(ts) tailscale: $state" >> "$LOG"
else
  echo "$(ts) tailscale CLI not in Termux PATH (Android app handles it)" >> "$LOG"
fi

echo "$(ts) ━━━ boot script complete ━━━" >> "$LOG"
