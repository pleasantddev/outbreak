# HustleLife architecture and ownership (Oct 2026 build-out)

Six workstreams run in parallel, each in its own git worktree and branch off `hustlelife`. The lead merges.

## Shared contracts (do not break)
- **Game systems**: every new gameplay system is a module in `v2/src/systems/<name>.ts` exporting a `GameSystem`
  (see `v2/src/systems/registry.ts`) and registered with ONE line in `v2/src/systems/index.ts`.
  hustle.ts already calls init/start/step/frame/onEvent/onAction. Keep edits to hustle.ts, lifeView.ts, life.ts small and surgical.
- **Content data** (editable in the admin panel): JSON files in `v2/public/content/`:
  `missions.json`, `events.json`, `skills.json`, `routes.json` (missions/content agent),
  `npcs.json` (archetypes, names, backstory parts, factions: society agent),
  `economy.json` (prices, wages, sinks; society agent), `iap.json` (store items; admin agent),
  `shops.json` (paint, plates, trackers, decor catalogue; features agent).
  Each file: `{ "version": 1, "items": [ ... ] }`; each item has a stable string `id`. TypeScript types live in
  `v2/src/content/schema.ts` (each owner adds their own section, append only). Loader: `v2/src/content/load.ts`.
- **Save data**: single player saves under localStorage `hustlelife`; each system stores its state under its own key
  in `ctx.save` and calls `ctx.persist()`. With a server, the same state is synced to the account (net agent).
- **Server**: `server/` at repo root, Node 22 + TypeScript, `ws` for realtime, plain `node:http` (or a tiny router) for REST,
  SQLite (`better-sqlite3`) for persistence. Owned by the multiplayer agent.
  REST routes are plug-ins: every file in `server/routes/*.ts` exports `register(api)`; the core auto-loads them.
  The admin agent owns `server/routes/admin*.ts` and the `admin/` web app. Content is served and edited through
  `GET /api/content/:kind` and `PUT /api/content/:kind` (admin auth), backed by files in `server/data/content/`
  seeded from `v2/public/content/`.
- **Offline first**: the game must still run with no server (artifact build, single player). Multiplayer turns on when a
  server URL is configured (`?server=wss://...` or a build-time setting).

## Ownership
| Agent | Owns |
|---|---|
| perf | renderer/streaming optimisation without dropping resolution: render/quality.ts, lifeView render path, streamer, LOD/impostors |
| society | NPC lives, schedules, backstories, nemesis, NPC-driven economy: systems/society*.ts, systems/nemesis.ts, sim brain hooks |
| missions | 100 missions, events, routes, skills and skill trees, mission runtime and UI: systems/missions*.ts, systems/skills.ts, content JSON |
| net | multiplayer server + client netcode, accounts, server persistence: server/*, systems/net.ts |
| admin | admin panel web app (3D map, economy, IAP, bans, content editor): admin/*, server/routes/admin*.ts |
| features | Cappa paint shop + 3D paint editor, plates, NIN at LGA offices, vehicle registry and stolen reports, trackers, house decor and free placement: systems/garage*.ts, systems/identity.ts, systems/housing*.ts |
