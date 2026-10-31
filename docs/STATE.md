# Working state (update at every milestone)

- Main checkout: /home/claude/hl (branch `hustlelife`, pushed to github.com/pleasantddev/outbreak). Commit as
  `Pleasant <joylove.rightchoice@gmail.com>`, no AI attribution, commit.gpgsign=false (repo-local config set).
- Game: /home/claude/hl/v2 (Vite + TS + three 0.180). Dev: `npx vite --host 127.0.0.1 --port 52xx`.
  Test: `flock /tmp/hl-browser.lock python3 regress.py URL?auto=1&q=low`. Screens: wshot.py, play.py.
- Published artifact: https://claude.ai/artifact/FwfqD3fisY7DtQX5k6WSQ7 (build: `rm -rf dist && npx vite build`,
  prune dist: devm, assets/tex, assets/chars, assets/anim/*.glb, tex/g0_arm_*; publish in <=58 MB batches with
  `files` + `root`, only changed files; null out removed ones).
- Server: /home/claude/hl/server (net branch, merged). Admin app: /home/claude/hl/admin (merged).
- Systems registry: v2/src/systems/index.ts (net, skills, society, nemesis, garage, identity, missions, life, vendors,
  decor, house, power, business, bills, leisure, ranks, agbero, transport, racing, tech, mechanic, wear, bank, powerjob, boys).
- Stable test build: `npx vite build --outDir /tmp/hlbuild` + `npx vite preview --outDir /tmp/hlbuild --port 5211` (the dev
  server reloads on every edit and breaks long browser tests). Online tests: scratchpad online/online.py; offline feature
  tests: scratchpad feat/run.py with ?auto=1&server=off.
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
- 30 Oct afternoon: founder brief 2 (16:14): agbero career, wear and tear (cars, houses: pipes, water, gen), a power
  company players work at that moves light around the map, windows lit only with power, rearrangeable decoratable rooms
  with interior designers, admin control of it all; pilots and airports later. Built: power grid (server-run feeders,
  control room job, admin board), wear (cars + house + gen + artisans), agbero, decor + designers, admin World page,
  businesses, social layer (meet, send money, invites, visits), mobile touch layout. Server tests 74/74.
  Teammate (hl-look): windows and street lamps follow the grid (powerShared.uGrid) with per-building gens.
- 30 Oct evening: published Version 8 to the artifact (index + three chunk changed, tuning.json added; old JS nulled).
  Merged hl-look ce3ef10 (windows, shop fronts, awnings and street lamps follow the grid; gens; solar lamps; uHome).
- Look pass notes (hl-look final report): declutter cut walk-stuck events 447 to 20 and lane events 302 to 1 at six
  neighbourhoods; facade shader rewrite; night grade; indoor sky mode. Open: lamp pool strength re-shot, generator
  windows a little bright (`genOn * 0.5`), warehouse stain pack not rebuilt, bank and hub interiors still white-heavy.
  Tips: snap constant-attribute varyings before a sin-hash (per-pixel noise otherwise); each vite dev server needs its own
  cache dir; headless frames are slow, so camera lerps need frames not seconds; tools: stuck.py, lookshot.py, intshot.py.
- 31 Oct 05:xx: founder brief 3 (see BACKLOG). Ideas board artifact: https://claude.ai/artifact/Htonjfcz9EWGJthTLB9VNz
  (regenerate with `python3 tools/ideas_page.py`, publish docs/ideas.html to that URL). Self-wake without the laptop: a cloud
  scheduled task "HustleLife build shift" (trig_01PQQg7HsZoz2eKSyNE6dRMk, every 4 h at :58) runs a fresh session from
  this repo's docs. Agents: SPORTS (Opus low, worktree /home/claude/wt/sports, branch hl-sports), IDEAS (Sonnet,
  /home/claude/wt/look, branch hl-look). Built: phone v2 (icons, dock, Back), phone network (numbers, IDs, contacts,
  texts, calls), voice (proximity, calls, radio), server tests 75.
- 31 Oct 09:00 shift: Paystack payments (53d2323). server/src/payments.ts + routes/pay.ts: server prices every product
  (sku "kind:id"), initialize -> hosted checkout, verify on return, HMAC-signed webhook, settle exactly once (pending ->
  paid, goods in the same transaction), amount/currency mismatch flagged not granted. Test mode when no
  PAYSTACK_SECRET_KEY and not NODE_ENV=production. purchases table got the admin Store page's columns (migration v5),
  so the admin ledger shows real rows; GET /api/pay/ledger for game admins. Client: systems/pay.ts (Top Up app: cash
  packs from content/iap.json, promo codes, receipts) and payApi.checkout(sku, meta) for MyAds and clubs to reuse:
  register a server product with api.payments.register(kind, { quote, fulfil }). Only cash/bank packs are sold until
  items, cosmetics, boosts and passes have fulfilment. Admin refunds mark the row but do not claw back cash yet.
  Server tests 86/86. Checked in the browser against a local test server: bought Market Day, wallet +₦1.5m.
