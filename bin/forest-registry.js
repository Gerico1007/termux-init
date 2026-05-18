#!/usr/bin/env node
// @gerico1007/termux-init — forest-registry (Eury-side service)
// ♠️🌿🎸🧵 Tailnet-only HTTP service that owns the Forest of Gerico SSH trust bundle.
//
// Subcommands:
//   forest-registry serve   (default) — run the HTTP server
//   forest-registry seed     — SSH into known Forest nodes, register their pubkeys
//   forest-registry status   — print registered nodes from local store

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let express;
try { express = require('express'); }
catch { console.error('express not installed — run: npm install -g @gerico1007/termux-init (which installs express)'); process.exit(1); }

const STATE_DIR = path.join(os.homedir(), '.forest-registry');
const STATE_FILE = path.join(STATE_DIR, 'nodes.json');
const PORT = Number(process.env.FOREST_REGISTRY_PORT || 8771);
// Default known forest Termux nodes for the seed subcommand.
const KNOWN_TERMUX_NODES = ['larix', 'ilex', 'tilia', 'abies'];

// ── Persistence ────────────────────────────────────────────────────
function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

function loadState() {
  ensureStateDir();
  if (!fs.existsSync(STATE_FILE)) return { nodes: [] };
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { nodes: [] }; }
}

function saveState(state) {
  ensureStateDir();
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function upsertNode(state, { hostname, pubkey, ip }) {
  const existing = state.nodes.find((n) => n.hostname === hostname);
  const entry = {
    hostname,
    pubkey,
    ip: ip || null,
    registered_at: existing?.registered_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, entry);
  else state.nodes.push(entry);
  return entry;
}

function keysBundle(state) {
  return state.nodes
    .filter((n) => n.pubkey && /^ssh-(rsa|ed25519|ecdsa)/.test(n.pubkey))
    .map((n) => {
      // ensure each line ends with a hostname comment for traceability
      const trimmed = n.pubkey.trim();
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) return trimmed;
      return `${trimmed} ${n.hostname}@forest`;
    })
    .join('\n') + '\n';
}

// ── Tailscale interface detection ──────────────────────────────────
function tailscaleIp4() {
  try {
    const out = execSync('tailscale ip -4 2>/dev/null', { encoding: 'utf8' }).trim();
    return out.split('\n')[0] || null;
  } catch {
    return null;
  }
}

// ── Server ─────────────────────────────────────────────────────────
function cmdServe() {
  const state = loadState();
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/keys', (req, res) => {
    res.type('text/plain').send(keysBundle(state));
  });

  app.get('/status', (req, res) => {
    res.json({
      port: PORT,
      registered: state.nodes.length,
      nodes: state.nodes.map(({ hostname, ip, registered_at, updated_at }) => ({
        hostname, ip, registered_at, updated_at,
      })),
    });
  });

  app.post('/register', (req, res) => {
    const { hostname, pubkey, ip } = req.body || {};
    // hostname: lowercase DNS-ish label, capped at 63 chars (RFC 1035)
    if (!hostname || typeof hostname !== 'string'
        || hostname.length > 63
        || !/^[a-z0-9][a-z0-9-]*$/.test(hostname)) {
      return res.status(400).json({ error: 'invalid hostname' });
    }
    // pubkey: full SSH authorized_keys line on a SINGLE line. Reject embedded
    // newlines/control chars — otherwise a malicious payload could inject extra
    // authorized_keys entries when /keys is consumed downstream.
    if (!pubkey || typeof pubkey !== 'string') {
      return res.status(400).json({ error: 'invalid pubkey' });
    }
    const pk = pubkey.trim();
    if (pk.length > 8192 || /[\r\n\0]/.test(pk)
        || !/^ssh-(rsa|ed25519|ecdsa[a-z0-9-]*)\s+[A-Za-z0-9+/=]+(\s+\S.*)?$/.test(pk)) {
      return res.status(400).json({ error: 'invalid pubkey' });
    }
    // ip: optional, but if present must look like an IPv4 dotted-quad. Tailscale
    // CGNAT range is 100.64.0.0/10 but we don't enforce that here — just shape.
    let cleanIp = null;
    if (ip != null && ip !== '') {
      if (typeof ip !== 'string' || ip.length > 45
          || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        return res.status(400).json({ error: 'invalid ip' });
      }
      cleanIp = ip;
    }
    const entry = upsertNode(state, { hostname, pubkey: pk, ip: cleanIp });
    saveState(state);
    res.status(200).json({ ok: true, node: entry, total: state.nodes.length });
  });

  // Bind explicitly to Tailscale IP to avoid exposing on other interfaces.
  // If Tailscale is unavailable, fall back to localhost (safer than 0.0.0.0).
  const bindIp = tailscaleIp4() || '127.0.0.1';
  app.listen(PORT, bindIp, () => {
    console.log(`♠️🌿🎸🧵 forest-registry listening on ${bindIp}:${PORT}`);
    console.log(`         Tailscale-only. State: ${STATE_FILE}`);
    console.log(`         Endpoints: GET /keys, POST /register, GET /status`);
  });
}

// ── Seed subcommand ─────────────────────────────────────────────────
function cmdSeed() {
  console.log('♠️🌿🎸🧵 forest-registry seed — collecting pubkeys from known Termux nodes');
  const state = loadState();

  // Seed Eury (self)
  const euryPub = path.join(os.homedir(), '.ssh/id_ed25519.pub');
  if (fs.existsSync(euryPub)) {
    const pub = fs.readFileSync(euryPub, 'utf8').trim();
    const entry = upsertNode(state, { hostname: os.hostname(), pubkey: pub, ip: tailscaleIp4() });
    console.log(`  ✓ seeded self: ${entry.hostname}`);
  } else {
    console.log('  ⚠ no ed25519 key for Eury at ~/.ssh/id_ed25519.pub — generating one');
    const keyFile = euryPub.replace(/\.pub$/, '');
    const res = spawnSync(
      'ssh-keygen',
      ['-t', 'ed25519', '-N', '', '-f', keyFile, '-C', `${os.hostname()}@eury`],
      { stdio: 'inherit' }
    );
    if (res.status !== 0) throw new Error(`ssh-keygen exited ${res.status}`);
    const pub = fs.readFileSync(euryPub, 'utf8').trim();
    upsertNode(state, { hostname: os.hostname(), pubkey: pub, ip: tailscaleIp4() });
  }

  for (const node of KNOWN_TERMUX_NODES) {
    process.stdout.write(`  ${node}: `);
    try {
      // Ensure remote has a key, then pull pubkey.
      execSync(
        `ssh -p 8022 -o ConnectTimeout=8 -o BatchMode=yes ${node}.ferret-harmonic.ts.net ` +
        `'[ -f ~/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C ${node}@termux-init >/dev/null'`,
        { stdio: 'pipe' }
      );
      const pub = execSync(
        `ssh -p 8022 -o ConnectTimeout=8 -o BatchMode=yes ${node}.ferret-harmonic.ts.net cat ~/.ssh/id_ed25519.pub`,
        { encoding: 'utf8' }
      ).trim();
      const ip = execSync(`tailscale ip -4 ${node} 2>/dev/null || echo`, { encoding: 'utf8' }).trim();
      const entry = upsertNode(state, { hostname: node, pubkey: pub, ip });
      console.log(`✓ ${entry.pubkey.split(/\s+/)[1].slice(0, 16)}…`);
    } catch (e) {
      console.log(`✗ ${e.message.split('\n')[0]}`);
    }
  }
  saveState(state);
  console.log(`\n✓ seed complete — ${state.nodes.length} nodes in registry`);
  console.log(`  State: ${STATE_FILE}`);
}

// ── Status subcommand ───────────────────────────────────────────────
function cmdStatus() {
  const state = loadState();
  console.log(`♠️🌿🎸🧵 forest-registry — ${state.nodes.length} node(s)`);
  console.log(`State file: ${STATE_FILE}\n`);
  for (const n of state.nodes) {
    console.log(`  ${n.hostname.padEnd(10)} ${(n.ip || '?').padEnd(18)} registered=${n.registered_at}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────
const sub = process.argv[2] || 'serve';
switch (sub) {
  case 'serve':  cmdServe();  break;
  case 'seed':   cmdSeed();   break;
  case 'status': cmdStatus(); break;
  case '-h':
  case '--help':
    console.log(`
forest-registry — Forest of Gerico SSH trust registry

Usage:
  forest-registry [serve]   Run HTTP server on port ${PORT} (tailnet-only bind)
  forest-registry seed       Collect pubkeys from known Termux nodes (larix, ilex, tilia, abies)
  forest-registry status     Print registered nodes

Env:
  FOREST_REGISTRY_PORT       Override port (default: 8771)
`);
    break;
  default:
    console.error(`unknown subcommand: ${sub}. Try --help`);
    process.exit(2);
}
