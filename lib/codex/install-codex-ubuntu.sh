#!/data/data/com.termux/files/usr/bin/sh
# Install Ubuntu/proot Codex support for Forest Android nodes.
# Safe to re-run.

set -eu
export DEBIAN_FRONTEND=noninteractive

pkg install -y proot-distro

if ! proot-distro list 2>/dev/null | grep -Eq '^ubuntu(\s|$)'; then
  proot-distro install ubuntu
fi

proot-distro login ubuntu -- /usr/bin/bash <<'INNER'
set -eu
export DEBIAN_FRONTEND=noninteractive
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

apt update
apt install -y curl git nodejs npm tmux node-glob node-globby

python3 - <<'PY'
import json, os
p = '/usr/share/nodejs/glob/package.json'
if os.path.exists(p):
    with open(p) as f:
        data = json.load(f)
    changed = False
    for key in ['main', 'bin']:
        if key in data and isinstance(data[key], str):
            new = data[key].replace('/src/', '/')
            if new != data[key]:
                data[key] = new
                changed = True
    req = data.get('exports', {}).get('.', {}).get('require', {})
    for key in ['types', 'default']:
        if key in req and isinstance(req[key], str):
            new = req[key].replace('/src/', '/')
            if new != req[key]:
                req[key] = new
                changed = True
    if changed:
        with open(p, 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
PY

/usr/bin/npm --version
/usr/bin/npm install -g @openai/codex
codex --version
INNER
