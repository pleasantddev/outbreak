# Working state (update at every milestone)

- Main checkout: /home/claude/hl (branch `hustlelife`, pushed to github.com/pleasantddev/outbreak). Commit as
  `Pleasant <joylove.rightchoice@gmail.com>`, no AI attribution, commit.gpgsign=false (repo-local config set).
- Game: /home/claude/hl/v2 (Vite + TS + three 0.180). Dev: `npx vite --host 127.0.0.1 --port 52xx`.
  Test: `flock /tmp/hl-browser.lock python3 regress.py URL?auto=1&q=low`. Screens: wshot.py, play.py.
- Published artifact: https://claude.ai/artifact/FwfqD3fisY7DtQX5k6WSQ7 (build: `rm -rf dist && npx vite build`,
  prune dist: devm, assets/tex, assets/chars, assets/anim/*.glb, tex/g0_arm_*; publish in <=58 MB batches with
  `files` + `root`, only changed files; null out removed ones).
- Server: /home/claude/hl/server (net branch, merged). Admin app: /home/claude/hl/admin (merged).
- Systems registry: v2/src/systems/index.ts (net, skills, society, nemesis, garage, identity, missions).
- Old worktrees under /home/claude/wt/* are merged; the six agents of 22 Oct are retired (do not resume them).
- Heartbeat: keep one send_later scheduled (240 min) with the message "Heartbeat (autonomous mode) ...".

## Milestone log
- 29 Oct: merged perf2, net, admin, society, features, missions WIP; tsc clean; regress passes (player died in the
  car during the drive step, check society/nemesis ambush tuning). Next: roadmap A (life sim core).
- 30 Oct: founder correction applied (see ROADMAP "Course correction"): GTA camera/controls, walk-in loaded
  interiors, shared clock, real-time needs, server-authoritative casino/earnings/doors. Server tests 63/63.
- 30 Oct 10:00 UTC: published Version 7 to the artifact (GTA play style, life depth, online rules, venues, careers,
  ranks, bills, merged look pass a14aaa1). Local test server: `cd server && PORT=8787 DATA_DIR=/tmp/hlsrv npx tsx src/main.ts`;
  two-player browser test: scratchpad online/online.py (signs up accounts over HTTP, injects the token).
