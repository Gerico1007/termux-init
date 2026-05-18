#!/usr/bin/env node
// @gerico1007/termux-init — device bootstrap
// ♠️🌿🎸🧵 Forest of Gerico mesh integration.
// Idempotent: safe to re-run any number of times on the same device.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ── Constants ───────────────────────────────────────────────────────
const PKG_ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const TIER1 = require(path.join(PKG_ROOT, 'lib/tiers/tier1-core.json'));
const TIER3 = require(path.join(PKG_ROOT, 'lib/tiers/tier3-power.json'));
const REGISTRY_URL = process.env.FOREST_REGISTRY_URL
  || 'http://eury.ferret-harmonic.ts.net:8771';
const RETRY_DELAYS_MS = [2000, 8000, 20000]; // 3 attempts, exponential

// ── Logging ────────────────────────────────────────────────────────
const log = {
  step:  (m) => console.log(`\n\x1b[36m══ ${m} ══\x1b[0m`),
  ok:    (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`),
  warn:  (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`),
  err:   (m) => console.error(`\x1b[31m✗\x1b[0m ${m}`),
  info:  (m) => console.log(`  ${m}`),
};

// ── CLI flags ───────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {
  noPower:    argv.includes('--no-power'),
  skipPkg:    argv.includes('--skip-pkg'),
  skipNpm:    argv.includes('--skip-npm'),
  skipSsh:    argv.includes('--skip-ssh'),
  dryRun:     argv.includes('--dry-run'),
  help:       argv.includes('--help') || argv.includes('-h'),
};

if (flags.help) {
  console.log(`
@gerico1007/termux-init — bootstrap a Termux device into the Forest of Gerico

Usage: termux-init [flags]

Flags:
  --no-power     Skip Tier 3 (Power/Media) packages
  --skip-pkg     Skip pkg install steps
  --skip-npm     Skip npm install steps
  --skip-ssh     Skip SSH key generation + mesh registration
  --dry-run      Print what would happen without making changes
  --help, -h     Show this help
`);
  process.exit(0);
}

// ── Helpers ────────────────────────────────────────────────────────
function isTermux() {
  return process.env.PREFIX === '/data/data/com.termux/files/usr'
      || fs.existsSync('/data/data/com.termux/files/usr/bin/pkg');
}

function run(cmd, opts = {}) {
  if (flags.dryRun) {
    log.info(`[dry-run] ${cmd}`);
    return '';
  }
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function runCapture(cmd) {
  try { return execSync(cmd, { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

function ensureDir(dir) {
  if (flags.dryRun) { log.info(`[dry-run] mkdir -p ${dir}`); return; }
  fs.mkdirSync(dir, { recursive: true });
}

function writeFileIfMissing(dst, src) {
  if (fs.existsSync(dst)) { log.ok(`exists: ${dst}`); return; }
  if (flags.dryRun) { log.info(`[dry-run] cp ${src} ${dst}`); return; }
  fs.copyFileSync(src, dst);
  log.ok(`wrote ${dst}`);
}

function overwriteFile(dst, src, mode) {
  if (flags.dryRun) { log.info(`[dry-run] overwrite ${dst}`); return; }
  fs.copyFileSync(src, dst);
  if (mode != null) fs.chmodSync(dst, mode);
  log.ok(`wrote ${dst}`);
}

function ensureBashrcStub() {
  const bashrcPath = path.join(HOME, '.bashrc');
  const stubSrc = fs.readFileSync(path.join(PKG_ROOT, 'lib/shell/bashrc-stub.sh'), 'utf8');
  const sentinel = '♠️🌿🎸🧵 termux-init — composable shell init';
  let current = '';
  try { current = fs.readFileSync(bashrcPath, 'utf8'); } catch {}
  if (current.includes(sentinel)) { log.ok('~/.bashrc already composable'); return; }

  if (flags.dryRun) {
    log.info(`[dry-run] would back up existing ~/.bashrc and install stub`);
    return;
  }

  if (current.trim().length > 0) {
    const backup = `${bashrcPath}.pre-termux-init.${Date.now()}`;
    fs.copyFileSync(bashrcPath, backup);
    log.warn(`backed up existing ~/.bashrc to ${backup}`);
  }
  fs.writeFileSync(bashrcPath, stubSrc);
  log.ok('installed composable ~/.bashrc stub');
}

// HTTP(S) GET/POST without external deps. Honors both http: and https: URLs.
// Per-attempt socket timeout — without this, a registry process that's up but
// hung (TCP handshake fine, no response body) would never raise an error and
// the exponential-backoff retry chain in withRetry() would stall forever.
const HTTP_TIMEOUT_MS = 8000;
function httpRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: {},
    };
    // For HTTPS to the tailnet-internal registry (typically a self-signed cert
    // since the host is *.ts.net), opt out of cert verification — but only when
    // explicitly requested, never by default. Plain http: ignores this anyway.
    if (u.protocol === 'https:' && process.env.FOREST_REGISTRY_INSECURE === '1') {
      opts.rejectUnauthorized = false;
    }
    let payload;
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = lib.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error(`request timeout after ${HTTP_TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function withRetry(label, fn) {
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === RETRY_DELAYS_MS.length) throw e;
      const delay = RETRY_DELAYS_MS[i];
      log.warn(`${label} attempt ${i + 1} failed (${e.message}); retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ── Steps ──────────────────────────────────────────────────────────

function stepDetectTermux() {
  log.step('Detecting Termux');
  if (!isTermux()) {
    log.err('Not running on Termux — this bootstrap is Termux-only.');
    process.exit(1);
  }
  log.ok(`Termux detected ($PREFIX=${process.env.PREFIX})`);
}

function stepPkgInstall() {
  if (flags.skipPkg) { log.step('Skipping pkg install (--skip-pkg)'); return; }
  log.step('Installing Termux pkg — Tier 1 (core)');
  run('pkg update -y');
  run(`pkg install -y ${TIER1.pkg.join(' ')}`);
  log.ok(`tier1: ${TIER1.pkg.length} packages installed`);

  if (flags.noPower) { log.warn('Skipping Tier 3 (--no-power)'); return; }
  log.step('Installing Termux pkg — Tier 3 (power/media)');
  run(`pkg install -y ${TIER3.pkg.join(' ')}`);
  log.ok(`tier3: ${TIER3.pkg.length} packages installed`);
}

function stepNpmInstall() {
  if (flags.skipNpm) { log.step('Skipping npm install (--skip-npm)'); return; }
  log.step('Installing npm globals');
  for (const pkg of TIER1.npmGlobal) {
    run(`npm install -g ${pkg}`);
    log.ok(`npm global: ${pkg}`);
  }
}

function stepShellAndBoot() {
  log.step('Writing shell + boot config');
  ensureDir(path.join(HOME, '.bashrc.d'));
  ensureDir(path.join(HOME, '.termux/boot'));
  ensureDir(path.join(HOME, 'tmp'));

  overwriteFile(
    path.join(HOME, '.bashrc.d/00-core.sh'),
    path.join(PKG_ROOT, 'lib/shell/00-core.sh'),
  );
  ensureBashrcStub();

  overwriteFile(
    path.join(HOME, '.termux/boot/01-tailnet-ready.sh'),
    path.join(PKG_ROOT, 'lib/boot/01-tailnet-ready.sh'),
    0o755,
  );

  writeFileIfMissing(
    path.join(HOME, '.env'),
    path.join(PKG_ROOT, 'lib/env/env.example'),
  );

  writeFileIfMissing(
    path.join(HOME, '.termux/termux.properties'),
    path.join(PKG_ROOT, 'lib/termux/termux.properties'),
  );
}

function stepEnableSshd() {
  log.step('Enabling sshd via runit (termux-services)');
  if (flags.dryRun) { log.info('[dry-run] sv-enable sshd'); return; }
  // sv-enable is idempotent; ignore failure if sshd already enabled
  const res = spawnSync('sv-enable', ['sshd'], { stdio: 'inherit' });
  if (res.status !== 0) log.warn('sv-enable sshd returned non-zero (may already be enabled)');
  else log.ok('sshd service enabled');
}

async function stepSshMeshTrust() {
  if (flags.skipSsh) { log.step('Skipping SSH mesh trust (--skip-ssh)'); return; }
  log.step('SSH mesh trust');

  const keyPath = path.join(HOME, '.ssh/id_ed25519');
  const pubPath = `${keyPath}.pub`;
  const sshDir = path.join(HOME, '.ssh');
  ensureDir(sshDir);
  // SSH refuses to use ~/.ssh or private keys with loose perms.
  if (!flags.dryRun) {
    try { fs.chmodSync(sshDir, 0o700); } catch {}
  }
  if (!fs.existsSync(keyPath)) {
    if (flags.dryRun) { log.info('[dry-run] ssh-keygen -t ed25519'); }
    else {
      // Use spawnSync with argv to avoid shell interpolation of os.hostname()
      // (a hostname containing $, ;, or backticks would be a code-exec vector).
      const comment = `${os.hostname()}@termux-init`;
      const res = spawnSync(
        'ssh-keygen',
        ['-t', 'ed25519', '-N', '', '-f', keyPath, '-C', comment],
        { stdio: 'inherit' }
      );
      if (res.status !== 0) throw new Error(`ssh-keygen exited ${res.status}`);
      log.ok('generated ed25519 keypair');
    }
  } else {
    log.ok('ssh key already exists');
  }

  if (flags.dryRun) {
    log.info('[dry-run] would GET /keys and POST /register');
    return;
  }

  const myPub = fs.readFileSync(pubPath, 'utf8').trim();
  const hostname = os.hostname();
  let tailscaleIp = '';
  try {
    tailscaleIp = runCapture('tailscale ip -4 2>/dev/null | head -1');
  } catch {}

  // GET /keys with retry
  let bundle = '';
  try {
    const res = await withRetry('GET /keys', async () => {
      const r = await httpRequest('GET', `${REGISTRY_URL}/keys`);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      return r;
    });
    bundle = res.body;
    log.ok(`fetched ${bundle.split('\n').filter(Boolean).length} forest pubkey(s)`);
  } catch (e) {
    log.err(`registry unreachable after retries: ${e.message}`);
    log.warn('Skipping mesh trust step — you can run `termux-init --skip-pkg --skip-npm` again later.');
    log.info(`Your pubkey to register manually:\n  ${myPub}`);
    return;
  }

  // Merge into authorized_keys (dedupe by full key string)
  const authPath = path.join(HOME, '.ssh/authorized_keys');
  let existing = '';
  try { existing = fs.readFileSync(authPath, 'utf8'); } catch {}
  const have = new Set(existing.split('\n').map(l => l.trim()).filter(Boolean));
  let added = 0;
  for (const line of bundle.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (!have.has(line)) { existing += (existing.endsWith('\n') || !existing ? '' : '\n') + line + '\n'; have.add(line); added++; }
  }
  fs.writeFileSync(authPath, existing);
  fs.chmodSync(authPath, 0o600);
  log.ok(`authorized_keys: +${added} new entries (${have.size} total)`);

  // POST /register
  try {
    const r = await withRetry('POST /register', async () => {
      const r = await httpRequest('POST', `${REGISTRY_URL}/register`, {
        hostname, pubkey: myPub, ip: tailscaleIp,
      });
      if (r.status !== 200 && r.status !== 201) throw new Error(`HTTP ${r.status}: ${r.body}`);
      return r;
    });
    log.ok(`registered with forest-registry: ${r.body}`);
  } catch (e) {
    log.warn(`registration POST failed: ${e.message}`);
    log.info(`Manual fallback — on Eury:\n  curl -X POST ${REGISTRY_URL}/register \\\n    -H 'Content-Type: application/json' \\\n    -d '${JSON.stringify({ hostname, pubkey: myPub, ip: tailscaleIp })}'`);
  }
}

function stepSummary() {
  log.step('Bootstrap complete');
  console.log(`
  Next steps on this device:
    1. Launch Termux:Boot once  — opens the app so its boot receiver activates
    2. ${`\x1b[36m`}claude login${`\x1b[0m`}              — authenticate Claude Code CLI
    3. ${`\x1b[36m`}source ~/.bashrc${`\x1b[0m`}          — pick up the new shell config (or reopen Termux)
    4. ${`\x1b[36m`}forest-status${`\x1b[0m`}             — verify mesh connectivity to every Forest node

  Re-run any time with: ${`\x1b[36m`}termux-init${`\x1b[0m`}  (idempotent)
`);
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('\n♠️🌿🎸🧵 termux-init — Forest of Gerico bootstrap');
  console.log(`         Registry: ${REGISTRY_URL}`);
  if (flags.dryRun) console.log('         \x1b[33mDRY RUN — no changes will be made\x1b[0m');

  stepDetectTermux();
  stepPkgInstall();
  stepNpmInstall();
  stepShellAndBoot();
  stepEnableSshd();
  await stepSshMeshTrust();
  stepSummary();
}

main().catch((e) => {
  log.err(e.stack || e.message);
  process.exit(1);
});
