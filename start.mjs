#!/usr/bin/env node
// Starts HustleLife on this computer and opens it in your browser. Friends on the same Wi-Fi join with the address it
// prints. Keep this window open while you play; closing it stops the game.
//
//   node start.mjs              play
//   node start.mjs --port 9000  use another port (default 8787)
//   node start.mjs --no-open    do not open the browser
//   node start.mjs --fresh      start a new world (the old one is kept in data/, renamed)
//   node start.mjs --logs       show everything the server says
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2); const has = (f) => args.includes(f);
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 8787;
const win = platform() === 'win32', mac = platform() === 'darwin';
const bold = (s) => `\x1b[1m${s}\x1b[0m`, teal = (s) => `\x1b[36m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const fail = (s) => { console.error(`\n\x1b[31m${s}\x1b[0m\n`); process.exit(1); };

if (Number(process.versions.node.split('.')[0]) < 22) fail(`HustleLife needs Node 22 or newer and this computer has ${process.version}.\nGet the LTS from https://nodejs.org, then start it again.`);

// first run: two small packages (the database and the network socket)
if (!existsSync(join(ROOT, 'node_modules', 'better-sqlite3')) || !existsSync(join(ROOT, 'node_modules', 'ws'))) {
  console.log(bold('Getting ready (first time only, about a minute)'));
  const r = spawnSync(win ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: ROOT, stdio: 'inherit', shell: win });
  if (r.status !== 0) fail('Could not install the packages. Check the internet connection and try again.');
}

if (has('--fresh')) {
  const db = join(ROOT, 'data', 'hustlelife.db');
  if (existsSync(db)) { const keep = `${db}.${new Date().toISOString().replace(/[:.]/g, '-')}`; for (const x of ['', '-wal', '-shm']) if (existsSync(db + x)) renameSync(db + x, keep + x); console.log(dim('Old world kept in data/.')); }
}

// is the port free? (a second copy already running is the usual reason it is not)
const free = await new Promise((res) => { const s = createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))); s.listen(port, '0.0.0.0'); });
if (!free) fail(`Port ${port} is busy. HustleLife may already be running in another window (use that one), or start with: node start.mjs --port ${port + 1}`);

const env = {
  ...process.env, HOST: '0.0.0.0', PORT: String(port), NODE_ENV: process.env.NODE_ENV ?? 'development',
  STATIC_DIR: join(ROOT, 'game'), HL_PUBLIC_DIR: join(ROOT, 'game'), SEED_CONTENT_DIR: join(ROOT, 'game', 'content'),
  HL_SHARED_DATA: join(ROOT, 'server', 'shared'), DATA_DIR: process.env.DATA_DIR ?? join(ROOT, 'data'), GUEST_ACCOUNTS: process.env.GUEST_ACCOUNTS ?? 'true',
};
const server = spawn(process.execPath, [join(ROOT, 'server', 'server.mjs')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
// a quiet window: who comes and goes, and real problems. --logs shows everything the server says.
const quiet = /no plots\.bin|payments: TEST MODE/;
const relay = (stream, out) => { let buf = ''; stream.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); show(line, out); } }); };
const show = (line, out) => {
  if (has('--logs')) { out.write(line + '\n'); return; }
  const m = / INFO  (join|leave) (.+?) \(#\d+\) online=(\d+)/.exec(line);
  if (m) { console.log(`  ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}  ${m[2]} ${m[1] === 'join' ? 'joined' : 'left'} · ${m[3]} online`); return; }
  if (/ (WARN |ERROR) /.test(line) && !quiet.test(line)) out.write(line + '\n');
};
relay(server.stdout, process.stdout); relay(server.stderr, process.stderr);
if (mac && server.pid) { try { spawn('caffeinate', ['-i', '-w', String(server.pid)], { stdio: 'ignore' }).unref(); } catch { /* fine */ } } // no sleeping while you host

// this computer's address on the Wi-Fi
const ips = [];
for (const [name, list] of Object.entries(networkInterfaces())) for (const a of list ?? []) {
  if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
  const lan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address), virt = /^(utun|awdl|llw|bridge|vmnet|vbox|docker|veth|br-|tailscale|zt)/i.test(name);
  ips.push({ address: a.address, rank: (lan ? 0 : 2) + (virt ? 1 : 0) + (/^(en0|wlan0|wi-?fi|wlp)/i.test(name) ? -1 : 0) });
}
ips.sort((a, b) => a.rank - b.rank);

// wait for it, then open the browser
const url = `http://localhost:${port}`;
for (let i = 0; i < 120; i++) {
  if (server.exitCode !== null) process.exit(server.exitCode);
  try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`\n${bold('HustleLife is running.')} Keep this window open while you play.\n`);
console.log(`  You:                ${teal(url)}`);
if (ips[0]) console.log(`  Friends on your Wi-Fi: ${teal(bold(`http://${ips[0].address}:${port}`))}  ${dim('(they open this in Chrome or Safari)')}`);
console.log(dim(`\n  Your world is saved in the data folder. Ctrl+C or closing this window stops the game.\n`));
if (!has('--no-open')) {
  const [cmd, a] = win ? ['cmd', ['/c', 'start', '', url]] : mac ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* open it by hand */ }
}

const stop = () => { server.kill('SIGINT'); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
server.on('exit', (code) => process.exit(code ?? 0));
