#!/data/data/com.termux/files/usr/bin/sh
# Forest of Gerico — keep the full fixed-workspace portals profile reachable on Android/Termux nodes.
# Launched from tmux by the Termux:Boot script.

set -u
LOG="$HOME/.termux/boot/boot.log"
LAUNCHER="$HOME/.local/bin/portal-hosted"
SESSION_NAME="portals"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

append_missing() {
  label="$1"
  if [ -n "$missing" ]; then
    missing="$missing, $label"
  else
    missing="$label"
  fi
}

check_https() {
  port="$1"
  path="${2:-/}"
  curl -kfsS "https://127.0.0.1:${port}${path}" >/dev/null 2>&1
}

check_http() {
  port="$1"
  path="${2:-/}"
  curl -fsS "http://127.0.0.1:${port}${path}" >/dev/null 2>&1
}

check_workspace() {
  port="$1"
  expected="$2"
  check_https "$port" "/api/forest/record/status" || return 1
  curl -kfsS "https://127.0.0.1:${port}/" | grep -F "data-current-workspace=\"$expected\"" >/dev/null 2>&1
}

portals_health_report() {
  missing=""

  check_workspace 8768 aureon || append_missing "aureon-8768"
  check_workspace 9768 nyro || append_missing "nyro-9768"
  check_workspace 4768 jamai || append_missing "jamai-4768"
  check_workspace 5768 synth || append_missing "synth-5768"
  check_workspace 3768 episodes || append_missing "episodes-3768"

  check_https 8443 / || append_missing "ritual-8443"
  check_http 8766 / || append_missing "clipboard-8766"
  check_http 8770 / || append_missing "workspace-8770"
  check_http 8776 / || append_missing "movement-8776"

  printf '%s' "$missing"
}

restart_portals() {
  reason="$1"
  echo "$(ts) restarting portals via portal-keeper (missing: $reason)" >> "$LOG"
  tmux kill-session -t "$SESSION_NAME" >/dev/null 2>&1 || true
  "$LAUNCHER" >> "$LOG" 2>&1 || return 1
}

while true; do
  if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock >/dev/null 2>&1 || true
  fi

  if [ ! -x "$LAUNCHER" ]; then
    echo "$(ts) portal-keeper: launcher missing at $LAUNCHER" >> "$LOG"
    sleep 30
    continue
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "$(ts) portal-keeper: curl missing from PATH" >> "$LOG"
    sleep 30
    continue
  fi

  missing="$(portals_health_report)"
  if [ -n "$missing" ]; then
    if restart_portals "$missing"; then
      sleep 5
      missing="$(portals_health_report)"
      if [ -z "$missing" ]; then
        echo "$(ts) portal-keeper confirmed full portals profile up" >> "$LOG"
      else
        echo "$(ts) portal-keeper failed to restore full portals profile (still missing: $missing)" >> "$LOG"
      fi
    else
      echo "$(ts) portal-keeper launcher failed" >> "$LOG"
    fi
  fi

  sleep 30
done
