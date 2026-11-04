#!/usr/bin/env node
// Builds the `play` branch: the game ready to run, with none of the dev tooling. One built game, one server file, a
// launcher and a double-click file for Mac and Windows. Run from the repo root on the hustlelife branch:
//
//   node tools/release-play.mjs           build and commit to the local `play` branch (in a worktree)
//   node tools/release-play.mjs --push    and push it to GitHub
//
// The worktree lives in ../hl-play next to the repo (or $PLAY_DIR). Nothing in it is edited by hand: every run
// rebuilds it from scratch, so edit the templates below or the game, then run this again.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAME = join(ROOT, 'v2'), SERVER = join(ROOT, 'server');
const OUT = resolve(process.env.PLAY_DIR ?? join(ROOT, '..', 'hl-play'));
const push = process.argv.includes('--push');
const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const step = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

// 1. a worktree on the play branch (an orphan branch: none of the dev history comes with a clone of it)
step('Worktree');
if (!existsSync(join(OUT, '.git'))) {
  const exists = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/play'], { cwd: ROOT }).status === 0;
  const remote = !exists && spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/play'], { cwd: ROOT }).status === 0;
  if (exists) git(['worktree', 'add', OUT, 'play']);
  else if (remote) git(['worktree', 'add', '-b', 'play', OUT, 'origin/play']);
  else git(['worktree', 'add', '--orphan', '-b', 'play', OUT]); // git 2.42 or newer
}
for (const e of readdirSync(OUT)) if (e !== '.git') rmSync(join(OUT, e), { recursive: true, force: true });

// 2. the game, built
step('Building the game');
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build', '--outDir', join(OUT, 'game'), '--emptyOutDir'], { cwd: GAME, stdio: 'inherit' });
rmSync(join(OUT, 'game', 'devm'), { recursive: true, force: true }); // studio-only models, not part of the game

// 3. the server in one file (better-sqlite3 and ws are installed by the launcher; everything else is inside)
step('Bundling the server');
const esbuild = await import(pathToFileURL(join(GAME, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
await esbuild.build({
  entryPoints: [join(SERVER, 'src', 'play.ts')], outfile: join(OUT, 'server', 'server.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
  external: ['better-sqlite3', 'ws', 'bufferutil', 'utf-8-validate'], legalComments: 'none', logLevel: 'warning',
  banner: { js: "import { createRequire as __hlRequire } from 'node:module'; const require = __hlRequire(import.meta.url);" },
});
mkdirSync(join(OUT, 'server', 'shared'), { recursive: true });
for (const f of ['feeders.json', 'clubs.json', 'billboards.json']) cpSync(join(GAME, 'src', 'data', f), join(OUT, 'server', 'shared', f));

// 4. launcher, double-click files, readme
step('Launcher');
const lock = JSON.parse(readFileSync(join(SERVER, 'package-lock.json'), 'utf8')).packages;
const ver = (n) => lock[`node_modules/${n}`]?.version ?? '*';
const commit = git(['rev-parse', '--short', 'HEAD']);
writeFileSync(join(OUT, 'package.json'), JSON.stringify({ name: 'hustlelife', version: `0.11.0-${commit}`, private: true, type: 'module', engines: { node: '>=22' }, scripts: { start: 'node start.mjs' }, dependencies: { 'better-sqlite3': `^${ver('better-sqlite3')}`, ws: `^${ver('ws')}` } }, null, 2) + '\n');
writeFileSync(join(OUT, '.gitignore'), 'node_modules/\ndata/\n');
cpSync(join(ROOT, 'tools', 'play', 'start.mjs'), join(OUT, 'start.mjs'));
cpSync(join(ROOT, 'tools', 'play', 'README.md'), join(OUT, 'README.md'));
cpSync(join(ROOT, 'tools', 'play', 'Play HustleLife.command'), join(OUT, 'Play HustleLife.command')); chmodSync(join(OUT, 'Play HustleLife.command'), 0o755);
writeFileSync(join(OUT, 'Play HustleLife.cmd'), readFileSync(join(ROOT, 'tools', 'play', 'Play HustleLife.cmd'), 'utf8').replace(/\r?\n/g, '\r\n'));

// 5. commit (as the founder, no attribution lines) and push
step('Commit');
git(['add', '-A'], OUT);
const changed = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: OUT }).status !== 0;
if (changed) git(['-c', 'user.name=Pleasant', '-c', 'user.email=joylove.rightchoice@gmail.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `HustleLife ${new Date().toISOString().slice(0, 10)} (from hustlelife ${commit})`], OUT);
console.log(changed ? `committed ${git(['rev-parse', '--short', 'HEAD'], OUT)} on play` : 'nothing changed');
if (push) { git(['push', '-u', 'origin', 'play'], OUT); console.log('pushed to origin/play'); }
console.log(`\nThe play build is in ${OUT}. Try it: cd ${OUT} && node start.mjs`);
