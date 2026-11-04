#!/usr/bin/env node
// HustleLife on your own network. Run this on the computer that hosts the game:
//
//   node lan.mjs              install what is missing, build the game if the code changed, start the server
//   node lan.mjs --build      rebuild the game first even if nothing changed
//   node lan.mjs --no-build   start with the game as last built
//   node lan.mjs --port 9000  another port (default 8787)
//   node lan.mjs --fresh      start with an empty world (moves the old database aside, nothing is deleted)
//
// Everyone on the same Wi-Fi opens the address it prints, on a phone or a laptop, and plays online on this machine.
// Their money, land, shops and phones live in server/data/hustlelife.db here. Ctrl+C stops it.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import { networkInterfaces, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const GAME = join(ROOT, 'v2'), SERVER = join(ROOT, 'server'), DIST = join(GAME, 'dist');
const args = process.argv.slice(2); const has = (f) => args.includes(f);
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 8787;
const say = (s = '') => console.log(s); const bold = (s) => `\x1b[1m${s}\x1b[0m`, teal = (s) => `\x1b[36m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const fail = (s) => { console.error(`\n\x1b[31m${s}\x1b[0m\n`); process.exit(1); };
const npm = platform() === 'win32' ? 'npm.cmd' : 'npm', npx = platform() === 'win32' ? 'npx.cmd' : 'npx';
const run = (cmd, a, cwd) => { const r = spawnSync(cmd, a, { cwd, stdio: 'inherit', shell: platform() === 'win32' }); if (r.status !== 0) fail(`"${cmd} ${a.join(' ')}" failed in ${cwd}`); };

// 1. Node 22 or newer (the server uses it)
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) fail(`HustleLife needs Node 22 or newer. This machine has ${process.version}. Get the LTS from https://nodejs.org and run this again.`);

// 2. packages, once (and again when package-lock.json changes)
for (const dir of [SERVER, GAME]) {
  const nm = join(dir, 'node_modules'), lock = join(dir, 'package-lock.json');
  if (!existsSync(nm) || (existsSync(lock) && statSync(lock).mtimeMs > statSync(nm).mtimeMs)) { say(bold(`Installing packages in ${dir.slice(ROOT.length + 1)} (first run takes a few minutes)`)); run(npm, ['install'], dir); }
}

// 3. build the game when the code or assets are newer than the last build
function newest(dir, skip = new Set(['node_modules', 'dist', 'devm'])) {
  let t = 0; if (!existsSync(dir)) return 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name) || e.name.startsWith('.')) continue; const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p, skip) : statSync(p).mtimeMs);
  }
  return t;
}
const built = existsSync(join(DIST, 'index.html')) ? statSync(join(DIST, 'index.html')).mtimeMs : 0;
const stale = !built || Math.max(newest(join(GAME, 'src')), newest(join(GAME, 'public')), statSync(join(GAME, 'index.html')).mtimeMs) > built;
if (!has('--no-build') && (has('--build') || stale)) { say(bold('Building the game (a minute or two on an older machine)')); run(npx, ['vite', 'build'], GAME); }
else if (!built) fail('There is no built game yet. Run "node lan.mjs --build".');

// 4. an empty world on request; the old database is kept beside it
if (has('--fresh')) {
  const db = join(SERVER, 'data', 'hustlelife.db');
  if (existsSync(db)) { const keep = `${db}.${new Date().toISOString().replace(/[:.]/g, '-')}`; for (const ext of ['', '-wal', '-shm']) if (existsSync(db + ext)) renameSync(db + ext, keep + ext); say(dim(`Old world kept as ${keep.slice(ROOT.length + 1)}`)); }
}

// 5. this machine's addresses on the network
const ips = [];
for (const [name, list] of Object.entries(networkInterfaces())) for (const a of list ?? []) {
  if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
  const lan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
  const virtual = /^(utun|awdl|llw|bridge|vmnet|vbox|docker|veth|br-|tailscale|zt)/i.test(name);
  ips.push({ name, address: a.address, rank: (lan ? 0 : 2) + (virtual ? 1 : 0) + (/^(en0|wlan0|wi-?fi|wlp)/i.test(name) ? -1 : 0) });
}
ips.sort((a, b) => a.rank - b.rank);

// 6. start the server, serving the game at / and joining everyone who opens it to this world
const env = { ...process.env, HOST: '0.0.0.0', PORT: String(port), STATIC_DIR: DIST, GUEST_ACCOUNTS: process.env.GUEST_ACCOUNTS ?? 'true' };
const server = spawn(npx, ['tsx', 'src/main.ts'], { cwd: SERVER, env, stdio: 'inherit', shell: platform() === 'win32' });
// keep a Mac awake while it hosts, or everyone drops when the lid timer runs out
if (platform() === 'darwin' && server.pid) { try { spawn('caffeinate', ['-i', '-w', String(server.pid)], { stdio: 'ignore' }).unref(); } catch { /* not on this Mac */ } }

setTimeout(() => {
  say(); say(bold('HustleLife is running on your network'));
  say(`  On this computer:   ${teal(`http://localhost:${port}`)}`);
  if (ips.length) { say(`  Everyone on your Wi-Fi: ${teal(bold(`http://${ips[0].address}:${port}`))}`); for (const ip of ips.slice(1, 3)) say(dim(`    or http://${ip.address}:${port}  (${ip.name})`)); }
  else say('  No network address found. Join a Wi-Fi network and run this again.');
  say();
  say(dim('  Open that address in Chrome or Safari on a phone or laptop on the same Wi-Fi. Each device gets its own guest player.'));
  say(dim('  If a Mac asks whether node may accept incoming connections, click Allow.'));
  say(dim('  Voice chat needs https, so it only works on this computer for now. Everything else works for everyone.'));
  say(dim('  Ctrl+C stops the server. Your world is saved in server/data.'));
  say();
}, 1500);

const stop = () => { server.kill('SIGINT'); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
