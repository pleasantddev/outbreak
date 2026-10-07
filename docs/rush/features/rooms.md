# Feature Dossier: Multiplayer rooms

**Project:** Lagos Rush  **Owner:** Pleasant  **Status:** built  **Date:** 2026-10-07

## 1. Summary
Instanced races for up to twelve cars. Players get into a room by quick match, by creating a private room and sharing its LAGOS code or invite link, or by joining with a code. The server owns the race: it runs the authoritative simulation, rolls and judges items, validates every car report, decides results and awards series points. The host configures races and nothing else. Version 1 has no real money.

## 2. Context
- Users and roles: anonymous players identified by a random id and a reconnect token; the room host (first in, migrates on leave); spectators (joined mid race); AI drivers; the server.
- Platforms: browsers on Android, iOS and desktop; one Node process for rooms.
- Stack and conventions: TypeScript everywhere, the shared `RaceSim`, JSON over WebSocket, no database in v1.
- Scale expectations: tens of rooms per process at launch; rooms are independent so the path to more is sharding by room code.
- Regulatory context: no money, no gambling, no personal data beyond a display name. Quick chat is fixed phrases only, so there is no user generated text to moderate.
- Related features: graphics settings (client cost), GIS pipeline (routes), economy (play money rewards).

## 3. Expanded scope
- Quick match with AI fill and a start timer: v1
- Private rooms with codes, invite links, share sheet: v1
- Party as a private room with an invite: v1
- Lobby: ready states, host settings, kick, quick chat, car change: v1
- Room lifecycle, countdown, results, series points: v1
- Disconnect, reconnect, host migration, AFK stand ins, late join: v1
- Server validation and rate limits: v1
- Accounts, friends across devices, presence: later (needs auth and a database)
- Ranked matchmaking by skill: later (needs persistent ratings)
- Voice or free text chat: later (needs moderation)
- Regional servers and sharding: later (not needed at launch scale)

## 4. Sources
- SRC-01: `references/feature-catalog.md` and `references/edge-case-lenses.md` from the systems feature architect skill, for the scope expansion and the edge case sweep.
- SRC-02: `references/failure-library.md` from the same skill, for trust boundary and rate limit failures.
- SRC-03: The `ws` package documentation (github.com/websockets/ws) for `maxPayload` and permessage deflate options.
- SRC-04: Measured bandwidth from `rush/tools/bandwidth.mjs` (twelve car room, 4.7 KB/s on the wire).
- SRC-05: The user's architecture addendum: room lifecycle, host powers, no informal betting, v1 without real money.

## 5. Assumptions
- AS-01: Players accept a server authoritative result with client authority over their own movement. Risk if wrong: complaints about other cars "teleporting"; mitigated by 100 ms interpolation.
- AS-02: One process holds launch traffic. Risk if wrong: slow ticks; mitigation path is sharding by room code.
- AS-03: Four digit codes are enough. Risk if wrong: collisions above 9,000 live rooms; codes are checked against live rooms and the format can grow.
- AS-04: Losing live rooms on a server restart is acceptable in v1. Risk if wrong: players lose a race; clients detect it and leave cleanly.

## 6. System map
- Actors: player, host, spectator, AI driver, server, a malicious client.
- Entry points: `/ws` messages, invite links with `?room=`, `/health`.
- Data: player card (display name, crew, colour, level, car, livery), room view, race state; nothing persisted on the server; profile in browser storage.
- Trust boundaries: client to server on every message; host to room (configuration only); client authority over its own car only.
- Side effects: room broadcasts, results, play money rewards on the client.

## 7. Edge cases (minimum 10)
- EC-01 | Two players race and one sends a teleport or an impossible speed | malicious actors | 3×3 | handling: speed, distance, road and height checks; invalid states ignored and counted; 40 violations remove the player | test: server.test.ts "runs a race: start, relay state, reject impossible moves"
- EC-02 | Client sends malformed JSON, wrong array length or NaN values | malicious actors | 2×3 | handling: frames parsed in try, state arrays must be 14 finite numbers | test: server.test.ts "reject impossible moves"; protocol.test.ts "rejects state arrays of the wrong shape"
- EC-03 | A player drops mid race | network | 3×2 | handling: seat kept 60 s, AI drives the car, host migrates if needed | test: server.test.ts "keeps a dropped seat, restores it with the reconnect token"
- EC-04 | The dropped player comes back during the same race | network, state | 3×2 | handling: token restores identity, server hands the car back and resends the race, client resyncs car, lap and distance from the snapshot | test: server.test.ts reconnect test; playtest online flow
- EC-05 | A connected player goes silent (hidden tab, frozen phone) | lifecycle | 3×2 | handling: AI stand in after 8 s, handed back on the next valid state with a catch up allowance | test: server.test.ts "hands a quiet driver to an AI stand-in"
- EC-06 | A human never finishes and keeps the room waiting | state, malicious actors | 2×3 | handling: 90 s after an AI wins, 25 s after the first human, hard cap at three times par | test: sim.test.ts "online, an AI winner starts a clock"; "a hard cap ends a race nobody finishes"
- EC-07 | Someone joins while a race is running | state | 2×1 | handling: marked WATCHING, gets the next race | test: manual check, not yet automated
- EC-08 | The room fills up while two people try the last seat | concurrency | 1×2 | handling: join checks capacity on the single threaded server; the loser gets "That room is full" | test: server.test.ts "turns away players when the room is full"
- EC-09 | The host tries to change laps or kick during a race | permissions | 2×2 | handling: config and kick only in the lobby, host only | test: server.test.ts "only lets the host change the race"; race test checks not_host during racing
- EC-10 | A client floods chat or room actions | malicious actors | 2×2 | handling: token buckets per socket for all messages, room actions and chat; flooding closes the socket | test: server.test.ts "rate limits chat"
- EC-11 | Old client version connects after a protocol change | lifecycle | 2×2 | handling: version check on hello, "Please update the game" | test: server.test.ts "rejects an old client version"
- EC-12 | The server restarts with live rooms | lifecycle | 1×2 | handling: client clears the old room on welcome and leaves cleanly if it does not come back within 3 s | test: ACCEPTED as v1 limitation; manual check planned
- EC-13 | Player on a slow phone falls behind the room clock | devices | 3×2 | handling: up to half a second of catch up per frame, short gaps skipped without snapping the car back | test: playtest online flow under software rendering
- EC-14 | Name with markup or emoji | data | 2×1 | handling: names reduced to safe characters, 2 to 16 long, escaped in every screen | test: server.test.ts "strips markup from player names"

## 8. Requirements (minimum 10)
- RQ-01 [F] | Quick match places a player in a public room within 2 s and starts a race with AI fill after 20 s or when two or more players are ready | EC-07
- RQ-02 [F] | A private room has a unique LAGOS code; joining by the four digits works | EC-08
- RQ-03 [F] | An invite link with ?room= takes a player from the splash screen into the lobby | none
- RQ-04 [F] | The host can set route, mode, laps, AI, traffic, time, weather, car class, players, privacy and series length, only in the lobby | EC-09
- RQ-05 [NF] | No client message can change another player's car, a result, points or rewards | EC-01, EC-09
- RQ-06 [NF] | Server validates every state report against speed, distance and road limits before using it | EC-01, EC-02
- RQ-07 [F] | A dropped player's car keeps racing under AI and the seat is held for 60 s | EC-03, EC-04
- RQ-08 [F] | Results come only from the server and list every entrant with place, time, best lap and points | EC-06
- RQ-09 [NF] | Online bandwidth stays under 8 KB/s per player in a twelve car room | SRC-04
- RQ-10 [NF] | Every message type is rate limited and frames over 8 KB are refused | EC-10
- RQ-11 [OP] | Room events are logged and /health reports rooms, players, uptime and version | none
- RQ-12 [F] | No race outlives three times par plus 90 s | EC-06

## 9. Implementation pathways (minimum 10)
- PW-01 [main] | Quick match: tap Quick match, join the fullest open public room or a new one, lobby, timer or all ready, countdown, race, results, room reopens
- PW-02 [alternate] | Private room: create with settings, copy or share the code, friends join by code, everyone ready or host starts
- PW-03 [alternate] | Invite link: open link, splash, join screen fills the code, lobby
- PW-04 [alternate] | Series: three races in a row with points, final standings and a winner, then everyone back on zero
- PW-05 [alternate] | Late join: enter during a race, watch from the lobby, race the next one
- PW-06 [failure] | Unknown code or full room: toast with the reason, stay on the join screen
- PW-07 [failure] | Server unreachable: OFFLINE pill with the reason, retry with backoff, solo play still works
- PW-08 [failure] | Kicked by the host: told why, back to Multiplayer
- PW-09 [recovery] | Dropout mid race: AI drives, reconnect with token, race resent, car resynced, carry on
- PW-10 [recovery] | Silent player: AI stand in after 8 s, car handed back on the next valid report
- PW-11 [recovery] | Host leaves: host moves to the next connected player, lobby keeps working
- PW-12 [failure] | Cheating client: impossible states ignored, repeat offenders removed

## 10. Architecture approaches considered (minimum 2)
- Option A: Fully server authoritative physics with client input only. Fair and simple to secure, but every car including your own lags by a round trip, and Nigerian mobile latency of 100 ms or more makes that feel sluggish.
- Option B: Client authority over its own car with server validation; server authority over everything else. Instant controls, results still owned by the server, cheating limited to driving slightly better than physics allows.
- Option C: Peer to peer with a host. No server cost, but the host can cheat freely and the addendum rules out informal peer arrangements.
- Decision and why: Option B. Input lag would hurt the feel more than the narrow cheating window it opens, and the validation rules close the obvious exploits.

## 11. Design
- Data model: in memory `Rooms` map keyed by code; `Room` holds players (with connection, seat and points), config, phase, the authoritative `RaceSim`, timers.
- API contract: see the protocol tables in `04_ARCHITECTURE.md`; errors are `{ t: 'error', code, msg }` with codes bad_version, not_found, full, in_race, not_host, rate, invalid, not_in_room, server.
- UI states: connecting, offline with retry, lobby, matchmaking, countdown, racing, menu during a race, results, room closed, kicked.
- Permission matrix: anyone in the room can ready, change car, chat, leave; only the host can configure, kick and start, and only in the lobby; nobody can touch results.
- Config: `TIMING` in `server/rooms.ts`; `PORT`; `QUIET`.
- Rollback plan: protocol version gate; clients and server deploy together; old clients are told to update.

## 12. Threat model and pre mortem
- STRIDE: spoofing (no accounts; reconnect tokens are random 128 bit), tampering (state validation), repudiation (room logs), information disclosure (no personal data), denial of service (rate limits, payload cap, per room tick cost bounded by twelve cars), elevation (host powers are lobby only).
- Pre mortem: rooms stuck forever by a stalled player (fixed with caps); data costs scaring players away (packed protocol, measured); reconnect loops freezing the menu (found in playtest and fixed); cheaters boosting (bounded by validation).

## 13. Test plan
Unit and integration tests in `rush/tests/server.test.ts`, `sim.test.ts` and `protocol.test.ts` cover EC-01 to EC-11. The two player browser playtest (`tools/playtest.mjs online`) covers PW-01 to PW-03 and PW-09 end to end. Malicious client tests send teleports, impossible speeds, NaN, short arrays and objects in place of arrays.

## 14. Observability
Room logs for joins, leaves, starts and winners; `/health` with counts. Planned: tick time, bandwidth and violation metrics with alerts.

## 15. Deferred items and open questions
- Accounts and cross device friends: needs auth; owner Pleasant.
- Server side leaderboards: needs persistence.
- Sharding beyond one process: only when traffic needs it.
- Real device latency tests on Nigerian mobile networks: first item for the next milestone.

## 16. Definition of Done
- [x] Validator passes
- [x] All pathways walked (playtest and tests)
- [x] Edge cases handled or accepted
- [x] Tests pass (incl. malicious + authorization)
- [ ] Observability in place (logs and health only)
- [x] Docs written
