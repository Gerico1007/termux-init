#!/data/data/com.termux/files/usr/bin/sh
# Forest of Gerico — keep sshd reachable on long-lived Android/Termux nodes.
# Launched from tmux by the Termux:Boot script.

set -u
LOG="$HOME/.termux/boot/boot.log"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

while true; do
  if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock >/dev/null 2>&1 || true
  fi

  if ! pgrep -x sshd >/dev/null 2>&1; then
    echo "$(ts) restarting sshd via sshd-keeper" >> "$LOG"
    if command -v sv >/dev/null 2>&1; then
      sv up sshd >/dev/null 2>&1 || true
      sleep 2
    fi
    pgrep -x sshd >/dev/null 2>&1 || sshd >/dev/null 2>&1 || true
    sleep 2
    if pgrep -x sshd >/dev/null 2>&1; then
      echo "$(ts) sshd-keeper confirmed sshd up" >> "$LOG"
    else
      echo "$(ts) sshd-keeper failed to start sshd" >> "$LOG"
    fi
  fi

  sleep 30
done
