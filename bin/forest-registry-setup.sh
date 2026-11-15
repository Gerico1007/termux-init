#!/usr/bin/env bash
# forest-registry-setup — install systemd service + tmux helper on Eury
# Run once on Eury after `npm install -g @gerico1007/termux-init`.
#
# What it does:
#   1. Installs the systemd user service (auto-start on boot, restart on crash)
#   2. Creates a tmux wrapper so you can inspect the live registry with:
#        forest-registry-tmux        — attach to the session (or create it)
#        forest-registry-tmux stop   — kill the tmux session (systemd keeps running)

set -euo pipefail

# ── Locate the package (resolve symlinks so npm global bin works) ───
REAL_SCRIPT="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
PKG_ROOT="$(cd "$(dirname "$REAL_SCRIPT")/.." && pwd)"
SERVICE_SRC="$PKG_ROOT/systemd/forest-registry.service"
SERVICE_DST="$HOME/.config/systemd/user/forest-registry.service"
TMUX_SCRIPT="$HOME/.local/bin/forest-registry-tmux"

log()  { printf '\033[36m══ %s ══\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$1"; }

# ── 1. systemd user service ─────────────────────────────────────────
log "Installing systemd user service"

mkdir -p "$(dirname "$SERVICE_DST")"
cp "$SERVICE_SRC" "$SERVICE_DST"
ok "copied service file to $SERVICE_DST"

systemctl --user daemon-reload
systemctl --user enable forest-registry.service
systemctl --user restart forest-registry.service
ok "forest-registry.service enabled + started"

echo "  Check status:  systemctl --user status forest-registry"
echo "  View logs:     journalctl --user -u forest-registry -f"

# ── 2. tmux helper script ───────────────────────────────────────────
log "Installing tmux helper"

mkdir -p "$(dirname "$TMUX_SCRIPT")"
cat > "$TMUX_SCRIPT" <<'TMUX_EOF'
#!/usr/bin/env bash
# forest-registry-tmux — view the registry in a tmux session named "8773"
#
# Usage:
#   forest-registry-tmux          — attach (creates session if needed)
#   forest-registry-tmux stop     — kill the tmux session
#   forest-registry-tmux logs     — tail journalctl logs in the session
set -euo pipefail

SESSION="8773"

case "${1:-attach}" in
  stop)
    tmux kill-session -t "$SESSION" 2>/dev/null && echo "✓ killed tmux session $SESSION" || echo "⚠ no session $SESSION"
    ;;
  logs)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      tmux attach -t "$SESSION"
    else
      tmux new-session -d -s "$SESSION" "journalctl --user -u forest-registry -f"
      tmux attach -t "$SESSION"
    fi
    ;;
  attach|"")
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      tmux attach -t "$SESSION"
    else
      # Split: top pane = live logs, bottom pane = shell for curl/status checks
      tmux new-session -d -s "$SESSION" "journalctl --user -u forest-registry -f"
      tmux split-window -t "$SESSION" -v -p 30
      tmux send-keys -t "$SESSION" "echo '── forest-registry helper ──'; echo 'curl http://localhost:8773/status | jq .'; echo 'forest-registry status'" Enter
      tmux select-pane -t "$SESSION":0.0
      tmux attach -t "$SESSION"
    fi
    ;;
  *)
    echo "Usage: forest-registry-tmux [attach|stop|logs]"
    exit 1
    ;;
esac
TMUX_EOF
chmod +x "$TMUX_SCRIPT"
ok "wrote $TMUX_SCRIPT"

# ── Done ─────────────────────────────────────────────────────────────
log "Setup complete"
echo ""
echo "  The registry is now managed by systemd (survives reboots + auto-restarts)."
echo "  To inspect it live:  forest-registry-tmux"
echo "  To view logs:        forest-registry-tmux logs"
echo "  To stop tmux only:   forest-registry-tmux stop"
echo "  systemd keeps running regardless of tmux."
echo ""
