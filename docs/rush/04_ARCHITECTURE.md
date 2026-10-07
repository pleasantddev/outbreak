# Lagos Rush: Technical Architecture

This document covers how the game is put together: one simulation shared by client, server and tests; a room server that owns every race result; the GIS pipeline that turns OpenStreetMap into the city; and the renderer that scales from a cheap Android phone to a gaming PC. The 10/10/10 analyses (edge cases, requirements, pathways) for the three riskiest systems are in `features/`.

## The pieces

```
 OpenStreetMap (Overpass extract, ODbL)
        │  tools/gis/fetch-osm.mjs, build-world.ts   (offline, run by a developer)
        ▼
 public/world/oshodi.json  tracks.json  PROVENANCE.json
        │
        ▼  fetched once at load, about 300 KB compressed
 ┌──────────────────────── browser ────────────────────────┐        ┌──────────── room server (Node) ────────────┐
 │ UI shell (screens, input, settings, profile)             │        │ HTTP: static client, /health                │
 │ Renderer (three.js): city, terminals, cars, FX, presets  │  JSON  │ WebSocket /ws                                │
 │ Audio (Web Audio synthesis)                              │◄──────►│ Rooms: lifecycle, matchmaking, codes         │
 │ RaceSession ── RaceSim (shared code)                     │  over  │ Room: authoritative RaceSim, validation,     │
 │ NetClient: clock sync, snapshot buffer, reconnect        │   WS   │       AI stand ins, results, series points   │
 └──────────────────────────────────────────────────────────┘        └──────────────────────────────────────────────┘
```

| Layer | Tech | Where |
|---|---|---|
| Client | TypeScript, three.js r180, postprocessing, Vite | `rush/src` |
| Shared simulation | Plain TypeScript, no DOM, no three.js | `rush/src/shared` |
| Room server | Node 22, `ws`, the shared simulation | `rush/server` |
| Data pipeline | Overpass API, `tsx` scripts | `rush/tools/gis` |
| Tests | Vitest (simulation, protocol, server), Playwright playtest | `rush/tests`, `rush/tools/playtest.mjs` |

## One simulation, three homes

`RaceSim` (`src/shared/race.ts`) runs a whole race: grid, countdown, launches, car physics, AI, items, hazards, pickups, traffic, slipstream, shunts, laps, places and the finish. The same class runs:

* offline on the client, as the authority for a solo race,
* on the room server, as the authority for an online race,
* on each online client, as a follower that only drives its own car,
* headless in the tests and in `tools/sim/headless.ts`.

Cars have one of three controllers. `local` reads this machine's input. `ai` is an `AiDriver` and only exists on an authority. `remote` is observed: its state arrives over the network and the sim only reads it for collisions, places and the minimap.

Two choices remove whole classes of network traffic:

* **Traffic is a pure function of the room seed and the race clock.** Every client computes the same danfos and kekes in the same places, so traffic never crosses the network. The replay player rebuilds it the same way.
* **Item rolls are seeded hashes** of position, car, bag and lap, so a roll can be reproduced and audited.

The client steps the sim at a fixed 60 Hz and draws between the last two steps; the server steps at 30 Hz.

## Who owns what

| Thing | Owner | Why |
|---|---|---|
| Your own car's movement | Your client, checked by the server | Zero input lag where it matters most |
| AI cars | Server | One copy of the truth; clients interpolate |
| Item rolls, item use, hazards, hits | Server | Nobody can grant themselves a rocket or dodge a hit locally |
| Pickups | Server | Bags disappear for everyone at once |
| Laps, finish order, results, points | Server | The result is the server's or it is nothing |
| Race clock and countdown | Server | Clients sync to it with ping and pong |
| Traffic | Nobody | Deterministic from the seed |
| Danfo Mode contact on your car | Your client | Judged from what you see, so it never feels unfair |

The room host sets up a race and can kick players in the lobby. The host cannot change results, physics, rewards or anything about a race once its countdown starts. Rewards are play money and are paid on the client from the server's result rows.

## Protocol

JSON text frames over one WebSocket at `/ws`, version 2. Every message has a `t` field.

| Client to server | Purpose | Limits |
|---|---|---|
| `hello` | Version, player card, reconnect token | Card is sanitised: name 2 to 16 safe characters, known car, valid colours |
| `quick`, `create`, `join`, `leave` | Room membership | 6 per burst, refilling 0.6 a second |
| `ready`, `setCar`, `config`, `kick`, `start` | Lobby actions | Host checks on `config`, `kick`, `start` |
| `chat` | One of ten fixed phrases | 2 per burst, refilling 0.5 a second |
| `state` | Own car, 14 rounded numbers | 20 a second; checked against physics |
| `useItem` | Ask to fire the held item | Server decides |
| `ping` | Clock sync | |

| Server to client | Purpose |
|---|---|
| `welcome` | Player id, reconnect token, server time, players online |
| `room` | Full room view after every change |
| `race` | Seed, start time, config and the entrant list in grid order |
| `snap` | Packed cars (19 numbers each) and hazards, 15 a second |
| `ev` | Item grants, hits, hazards, pickups, laps, finishes |
| `results` | Final rows with places, times and points |
| `chat`, `left`, `error`, `pong` | |

Every socket also has a general bucket of 40 messages with 30 refilled a second, and a frame limit of 8 KB. A socket that floods past the bucket is closed.

**Bandwidth.** Measured with `tools/bandwidth.mjs` on a twelve car room: snapshots arrive 15 times a second at about 960 bytes each, 14 KB/s of JSON, which the socket's permessage deflate turns into **4.7 KB/s on the wire**. A three minute race costs a player roughly 850 KB down. Before the packed format the same race would have cost around ten times that.

## Room lifecycle

```
            create / quick match
                    │
                    ▼
   ┌────────── waiting ◄──────────────────────────────┐
   │   all present ready, host Start, or quick timer  │
   │                ▼                                  │
   │           countdown (5.2 s)                       │
   │                ▼                                  │
   │            racing ── first finish ──► finishing   │
   │                                         │         │
   │                     everyone in, grace, cap       │
   │                                         ▼         │
   │                                     results (12 s)┘
   │
   └── last player leaves ──► closed (removed on the next tick)
```

| Timer | Value | Notes |
|---|---|---|
| Countdown | 5.2 s | The client shows the last three seconds and the launch window |
| Grace after the first human finishes | 25 s | |
| Grace after an AI wins | 90 s | So a stalled player cannot hold the room |
| Hard cap | three times par for the laps, plus 90 s | No race outlives it |
| Results on screen | 12 s | Then the room reopens |
| Quick match wait | 20 s | Then it starts with AI fill |
| Seat kept after a dropout | 60 s | |
| Silence before an AI stand in | 8 s | |

All timers live in `TIMING` in `server/rooms.ts`; the tests shrink them to run a full lifecycle in a few seconds.

**Series.** A room runs one, three or five races. Points per place are 15, 12, 10, 8, 6, 5, 4, 3, 2, 1. After the last race of a series the results screen shows the series winner and the room reopens with everyone on zero.

## Matchmaking, codes and invites

* **Quick match** joins the fullest public quick room still in its lobby, or creates one on a random route with seven AI and a twenty second timer.
* **Private rooms** get a code `LAGOS-` plus four digits, checked against live rooms for collisions. Typing just the four digits works.
* **Invites** are links with `?room=LAGOS-4827`. After the splash the game joins that room directly.
* **Parties** are private rooms. Friends share the code or the link; the share button uses the phone's share sheet.

## When things go wrong

| Situation | What happens |
|---|---|
| A player's connection drops | Their seat is kept for 60 s and an AI drives their car. If they were host, the next connected player becomes host |
| They come back | The reconnect token restores the same identity and seat, the server hands the car back and resends the race; the client picks its car up from the latest snapshot, lap and distance included |
| A tab is hidden or a phone freezes | Gaps under 6 s are skipped and the car carries on from where it was. Longer gaps mean the AI stand in drove; the client resyncs from the room |
| A player stops sending state while connected | After 8 s an AI takes over; the next valid state hands the car back, with a short catch up allowance for the snapshot delay |
| Someone joins mid race | They watch from the lobby and are on the grid for the next race |
| Someone leaves on purpose | Their car finishes the race under AI control; results still list them |
| The host leaves | Host moves to the next connected player |
| Everyone leaves | The room closes on the next tick |
| The server is unreachable | The multiplayer screen says so and retries with backoff (0.5 s doubling to 8 s); solo play keeps working |
| A client sends nonsense | Malformed frames are dropped; impossible states are ignored and counted, and 40 violations remove the player |

## Validation

A client is trusted only for its own car's movement, and that movement must fit the game's physics:

* every number finite and the array the right length,
* speed under 1.75 times the car's top speed plus 6 m/s,
* distance since the last report under what that speed allows over the elapsed time, with slack for one tow truck drop back onto the road,
* within 9 m of the road surface laterally and 30 m vertically,
* no movement off the grid during the countdown.

Invalid reports change nothing. Violations decay slowly with good reports, so a bad connection does not get anyone kicked.

## Client netcode

* **Clock.** `welcome` sets the offset; every `pong` refines it with an exponential average corrected by half the round trip.
* **Other cars** are drawn 100 ms in the past, interpolated between snapshots, extrapolated for at most 250 ms if snapshots stop. They are fed into the local sim before each step so collisions with them work.
* **Your car** is never corrected while you drive it. It is the one thing you own.
* **Items** are requests. The server fires them, and the resulting events come back to every client, yours included.
* **Hazards** take their positions from snapshots, so rockets fly on the server's clock.
* **The end** comes only from the server's `results`; a follower never ends a race on its own view of it.

## Persistence

Version 1 keeps the profile (name, crew, garage, Naira, XP, records, settings) in the browser's local storage and the rooms in server memory. There are no accounts, no database and no personal data beyond a display name. Restarting the server ends live rooms; clients reconnect and land back in the multiplayer menu. Accounts, cloud saves and server side leaderboards are the next step and need a database, authentication and the auth playbook from the systems architect skill.

## Deployment

`npm start` builds the client and serves it, the health check and the WebSocket from one Node process on `PORT`. Text files are gzipped in memory once per build (the city data drops from 1.1 MB to 236 KB). Rooms are independent, so the scaling path is horizontal: several processes behind a router that sends each room code to one process, with a small shared directory of open quick rooms. None of that is built yet; one process comfortably holds dozens of rooms.

## Observability

Each room logs joins, leaves, race starts and winners. `/health` reports uptime, protocol version, rooms and players. Not built yet: metrics for tick time, bandwidth and violation counts, and alerts on them.

## Performance budgets

| Budget | Target | Measured |
|---|---|---|
| City triangles on Low, menu view | under 150k | about 120k |
| City triangles on High, menu view | under 450k | about 390k |
| Draw calls per car | about 10 | merged per material; was about 50 |
| Download, compressed | under 1.5 MB | about 0.9 MB (code, city data, fonts) |
| Online bandwidth per player | under 8 KB/s | 4.7 KB/s in a twelve car room |

Frame rates were measured under software rendering in the container, which says little about real phones. Real device numbers are the first item in the QA plan.
