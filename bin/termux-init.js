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
function flagValue(name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
  return null;
}
const flags = {
  noPower:    argv.includes('--no-power'),
  skipPkg:    argv.includes('--skip-pkg'),
  skipNpm:    argv.includes('--skip-npm'),
  skipSsh:    argv.includes('--skip-ssh'),
  skipSshCfg: argv.includes('--skip-ssh-config'),
  dryRun:     argv.includes('--dry-run'),
  help:       argv.includes('--help') || argv.includes('-h'),
  hostname:   flagValue('--hostname'),
};

if (flags.help) {
  console.log(`
@gerico1007/termux-init — bootstrap a Termux device into the Forest of Gerico

Usage: termux-init [flags]

Flags:
  --hostname=<name>    Override detected hostname (default: parsed from SSH
                       key comment, then os.hostname()). Use this on Termux
                       where os.hostname() returns 'localhost'.
  --no-power           Skip Tier 3 (Power/Media) packages
  --skip-pkg           Skip pkg install steps
  --skip-npm           Skip npm install steps
  --skip-ssh           Skip SSH key generation + mesh registration
  --skip-ssh-config    Skip writing ~/.ssh/config Host blocks
  --dry-run            Print what would happen without making changes
  --help, -h           Show this help
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

// Non-throwing variant — returns { ok, error }.
// Use for steps where a failure should be reported but not abort the bootstrap.
function tryRun(cmd, opts = {}) {
  if (flags.dryRun) { log.info(`[dry-run] ${cmd}`); return { ok: true }; }
  try { execSync(cmd, { stdio: 'inherit', ...opts }); return { ok: true }; }
  catch (e) { return { ok: false, error: e }; }
}

// Run `pkg install` with one recovery pass: if it fails (often because a
// previously-installed package is in `dpkg` half-configured state — e.g. a
// libplacebo/ffmpeg ABI break on outdated systems), try `apt --fix-broken
// install -y` to repair the state, then retry the install once.
function installWithRecovery(label, pkgs) {
  const cmd = `pkg install -y ${pkgs.join(' ')}`;
  const first = tryRun(cmd);
  if (first.ok) return { ok: true };

  log.warn(`${label} install failed; attempting apt --fix-broken install`);
  const fix = tryRun('apt --fix-broken install -y');
  if (!fix.ok) {
    log.err(`apt --fix-broken install also failed — manual recovery needed.`);
    log.info(`Try on the device:`);
    log.info(`  pkg upgrade -y`);
    log.info(`  # if a specific package keeps failing (e.g. ffmpeg):`);
    log.info(`  dpkg --remove --force-remove-reinstreq <pkg-name>`);
    log.info(`  pkg upgrade -y && pkg install -y <pkg-name>`);
    return { ok: false };
  }

  log.info(`broken state repaired; retrying ${label} install`);
  const second = tryRun(cmd);
  if (!second.ok) {
    log.err(`${label} install still failing after recovery.`);
    return { ok: false };
  }
  return { ok: true };
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
  if (flags.skipPkg) { log.step('Skipping pkg install (--skip-pkg)'); return { tier1: 'skipped', tier3: 'skipped' }; }

  log.step('Refreshing + upgrading Termux pkg index');
  // pkg update is the index refresh — fatal if it fails (no network or repo broken).
  run('pkg update -y');
  // pkg upgrade keeps installed packages in sync; prevents ABI skew bugs (the
  // ffmpeg/libplacebo dynamic-link failure seen on long-lived devices). Non-fatal
  // because a single broken package shouldn't block the whole bootstrap — the
  // subsequent install step has its own recovery.
  const up = tryRun('pkg upgrade -y');
  if (!up.ok) log.warn('pkg upgrade hit a snag; continuing into installs');

  log.step('Installing Termux pkg — Tier 1 (core)');
  const t1 = installWithRecovery('Tier 1', TIER1.pkg);
  if (!t1.ok) {
    // Tier 1 is "must-have"; failing here means subsequent steps (shell/boot/ssh)
    // would run on an unprepared base. Abort with the clearest message we can.
    log.err('Tier 1 install failed — bootstrap cannot continue.');
    log.info('Repair the device, then re-run `termux-init` (it is idempotent).');
    process.exit(1);
  }
  log.ok(`tier1: ${TIER1.pkg.length} packages installed`);

  let tier3Status = 'skipped';
  if (flags.noPower) {
    log.warn('Skipping Tier 3 (--no-power)');
  } else {
    log.step('Installing Termux pkg — Tier 3 (power/media)');
    const t3 = installWithRecovery('Tier 3', TIER3.pkg);
    if (!t3.ok) {
      // Tier 3 is optional/nice-to-have; warn but DO NOT abort — the device
      // still gets shell/boot/ssh wired up so it can join the mesh.
      log.warn('Tier 3 install failed — continuing without it. Fix manually later.');
      tier3Status = 'failed';
    } else {
      log.ok(`tier3: ${TIER3.pkg.length} packages installed`);
      tier3Status = 'ok';
    }
  }

  return { tier1: 'ok', tier3: tier3Status };
}

function stepNpmInstall() {
  if (flags.skipNpm) { log.step('Skipping npm install (--skip-npm)'); return; }
  log.step('Installing npm globals');
  for (const spec of TIER1.npmGlobal) {
    // Strip @version to get the bare package name for uninstall.
    // '@anthropic-ai/claude-code@2.1.37' → '@anthropic-ai/claude-code'
    const pkgName = spec.startsWith('@')
      ? '@' + spec.slice(1).split('@')[0]
      : spec.split('@')[0];

    // Defensive uninstall: claude-code 2.1.143+ ships a native binary that has
    // no android-arm64 variant — Termux installs end up with a broken stub
    // (`claude` errors with "native binary not installed"). If a prior version
    // is around, remove it before installing the pinned version below so we
    // never serve a broken claude alongside our shell alias.
    if (pkgName === '@anthropic-ai/claude-code') {
      tryRun(`npm uninstall -g ${pkgName}`);
    }

    run(`npm install -g ${spec}`);
    log.ok(`npm global: ${spec}`);
  }
}

// (removed) runClaudeCodePostinstall — claude-code 2.1.37 is pure-JS and
// doesn't need a postinstall to fetch native binaries. Newer 2.1.143+ ships
// a Bun-compiled native binary with no android-arm64 variant published, so
// we pin to 2.1.37 in tier1-core.json rather than chase a workaround.

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
  const hostname = detectHostname(myPub);
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

  // POST /register — send platform so the registry can attach correct ssh_port
  // metadata (consumers of GET /nodes use this to build ~/.ssh/config).
  const registerBody = { hostname, pubkey: myPub, ip: tailscaleIp, platform: 'termux' };
  try {
    const r = await withRetry('POST /register', async () => {
      const r = await httpRequest('POST', `${REGISTRY_URL}/register`, registerBody);
      if (r.status !== 200 && r.status !== 201) throw new Error(`HTTP ${r.status}: ${r.body}`);
      return r;
    });
    log.ok(`registered as '${hostname}' (termux): ${r.body}`);
  } catch (e) {
    log.warn(`registration POST failed: ${e.message}`);
    log.info(`Manual fallback — on Eury:\n  curl -X POST ${REGISTRY_URL}/register \\\n    -H 'Content-Type: application/json' \\\n    -d '${JSON.stringify(registerBody)}'`);
  }
}

// Detect the hostname this device should register under. Priority:
//   1. --hostname flag (explicit override)
//   2. SSH key comment (we wrote `<host>@termux-init` during seed/keygen)
//   3. os.hostname() — last resort, warned if it's 'localhost'
function detectHostname(myPub) {
  if (flags.hostname) {
    log.info(`hostname from --hostname flag: ${flags.hostname}`);
    return flags.hostname;
  }
  const parts = myPub.trim().split(/\s+/);
  if (parts.length >= 3) {
    const comment = parts.slice(2).join(' ');
    const m = comment.match(/^([a-z0-9][a-z0-9-]*)@/);
    if (m) {
      log.info(`hostname from ssh key comment: ${m[1]}`);
      return m[1];
    }
  }
  const sys = os.hostname();
  if (sys === 'localhost' || sys === 'localhost.localdomain' || !sys) {
    log.warn(`os.hostname() returned '${sys}' — registry needs a stable name.`);
    log.warn(`Re-run with --hostname=<name> (e.g., --hostname=abies).`);
    log.warn(`Continuing with 'localhost' would create a bogus registry entry.`);
    process.exit(1);
  }
  log.info(`hostname from os.hostname(): ${sys}`);
  return sys;
}

// ── stepWriteSshConfig — generate ~/.ssh/config Host blocks for every forest
//    node so `ssh larix` (et al.) just works with the correct port per platform.
async function stepWriteSshConfig() {
  if (flags.skipSshCfg) { log.step('Skipping SSH config (--skip-ssh-config)'); return; }
  log.step('Writing ~/.ssh/config Host blocks');

  if (flags.dryRun) { log.info('[dry-run] would GET /nodes and rewrite ~/.ssh/config block'); return; }

  let nodes;
  try {
    const r = await httpRequest('GET', `${REGISTRY_URL}/nodes`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    nodes = JSON.parse(r.body).nodes;
  } catch (e) {
    log.warn(`couldn't fetch /nodes (${e.message}); skipping ssh config write`);
    return;
  }

  const begin = '# >>> forest-of-gerico (managed by termux-init) >>>';
  const end   = '# <<< forest-of-gerico <<<';

  const blocks = nodes
    .filter((n) => n.ssh_port != null)  // skip iOS / unknown — they have no sshd
    .map((n) => {
      // Use Tailscale magic DNS as HostName so it survives IP changes.
      const fqdn = `${n.hostname}.ferret-harmonic.ts.net`;
      return [
        `Host ${n.hostname}`,
        `    HostName ${fqdn}`,
        `    Port ${n.ssh_port}`,
        `    User gmusic`,
        `    IdentityFile ~/.ssh/id_ed25519`,
        ``,
      ].join('\n');
    })
    .join('');

  const fenced = `${begin}\n${blocks}${end}\n`;
  const cfgPath = path.join(HOME, '.ssh/config');
  let current = '';
  try { current = fs.readFileSync(cfgPath, 'utf8'); } catch {}

  // Replace existing block if sentinel present, else append.
  const fenceRe = new RegExp(
    `${begin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n?`,
    'm'
  );
  const next = fenceRe.test(current)
    ? current.replace(fenceRe, fenced)
    : (current + (current.endsWith('\n') || !current ? '' : '\n') + '\n' + fenced);

  fs.writeFileSync(cfgPath, next);
  fs.chmodSync(cfgPath, 0o600);
  log.ok(`wrote ${nodes.filter((n) => n.ssh_port != null).length} Host block(s) to ~/.ssh/config`);
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
  await stepWriteSshConfig();
  stepSummary();
}

main().catch((e) => {
  log.err(e.stack || e.message);
  process.exit(1);
});
