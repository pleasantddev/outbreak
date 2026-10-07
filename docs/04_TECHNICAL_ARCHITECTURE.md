# Technical Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 5.9, strict | One language for client, server and tools |
| Rendering | three.js r180 with pmndrs postprocessing | Browser native, fits the existing three.js habit, runs on mid range Android |
| Physics | Rapier 0.21 (WASM, compat build) | Deterministic enough, character controller, ray cast vehicles, runs in Node for a server |
| Build | Vite 6 | Fast dev loop, static output for any host |
| Tests | Vitest | Runs the full simulation headless in Node |
| Audio | WebAudio, fully procedural | Zero licensing risk, tiny download |

## Module map

```
game/src
  data/      balance.ts, cosmetics.ts, profile.ts, copy.ts      tunables, catalog, persistence, in game text
  world/     cityGen.ts                                        seeded district as pure data
  sim/       sim.ts, ai.ts, nav.ts, physics.ts, items.ts, types.ts, rng.ts
  render/    engine, worldView, props, characters, weapons3d, vehicles3d, fx, camera, gameView, menuScene, materials
  ui/        menu.ts, hud.ts, styles.css
  input/     input.ts (keyboard, mouse, touch)
  audio/     audio.ts
  main.ts    app state machine and fixed step loop
```

## The authority boundary

`sim/` never imports from `render/`, `ui/`, `audio/` or the DOM. The renderer only reads sim state and a per tick event list. Clients send a `Command` (move vector, aim yaw and pitch, the exact aim ray from the eye, buttons, slot), and the sim decides what happened. Bots use the identical path: `BotBrain.think()` returns a `Command`.

This is the server shape the bible asks for. To go online, `Sim` moves into a Node process, clients send Commands over a WebSocket, and the server returns snapshots plus the event list.

### Tick

1. Match flow: phase changes, zone, corruption, Heart pulses, extraction, contracts, wins.
2. Bot brains produce Commands.
3. Actors: interaction, slots, abilities, heals, movement through the Rapier character controller, combat, auto pickup.
4. Vehicles: ray cast vehicle controller, part damage, self righting, run overs.
5. Creatures: spawn and despawn by phase, brains, movement.
6. Grenades and Metal walls.
7. Physics step, then seat sync.

Fixed at 60 Hz. The client renders at display rate and catches up to four sub steps per frame. Edge buttons (interact, reload, abilities) only fire on the first sub step.

### Third person aim correctness

The camera sits behind the right shoulder, so the crosshair ray and the gun ray differ. The client casts the crosshair ray into the world, finds the point it lands on, and sends the direction from the character's eye to that point. The server casts from the eye along that direction. Shots land where the crosshair says, and the server stays authoritative.

## World build

`generateCity(seed)` returns about 44,000 boxes, 3,500 props, 400 lights, 220 buildings, 1,600 loot spawns, 5,400 nav nodes and 13 vehicles. The same list drives:

* Rendering: boxes merged per material per 96 m chunk with world aligned UVs and vertex AO.
* Physics: about 31,000 fixed cuboid colliders, including props.
* Bullets and sight lines: the same colliders.

Buildings use a 4 m module, 3.4 m storeys, window and door openings cut into wall runs, a switchback stairwell (two 1.7 m flights per storey with a landing), slabs with a stair hole, an interior partition with a door gap, furniture, a parapet roof and a bulkhead. Stair waypoints sit in lane centres so walkers never press into the divider.

## Performance budgets (target: mid range Android at Low, desktop at High)

| Budget | Low | High |
|---|---|---|
| Pixel ratio | 1.0 | up to 2.0 |
| Real point lights | 8 pooled | 22 pooled |
| Shadows | Off | Moon 2048 and flashlight 1024 |
| Rain streaks | 1,200 | 5,000 |
| Characters animated | Within 160 m | Within 160 m |
| Creature views | Within 130 m | Within 130 m |
| Download | About 15 MB of assets | Same |

Lamps beyond the light pool render as additive glow points and ground light pools in a single draw call each.

## Feature dossier: match core and the Heart

### Requirements

| ID | Type | Requirement |
|---|---|---|
| RQ01 | F | Exactly one Heart exists per match once the Heart phase begins. |
| RQ02 | F | Only one actor can carry the Heart; it drops at the carrier's position on death, raised to the ground or water surface. |
| RQ03 | F | A carrier wins only after holding an open extraction for 30 s; leaving bleeds progress at 0.5 per second. |
| RQ04 | F | Last survivor wins when one actor remains alive after the first 20 s. |
| RQ05 | F | A completed contract allows a 20 s contract extraction that ends that player's match as a win without ending the match. |
| RQ06 | F | Phase timings scale linearly with the chosen match length. |
| RQ07 | NF | The sim never reads from rendering, UI or the DOM. |
| RQ08 | NF | A given seed always produces the same city. |
| RQ09 | NF | Damage over time emits at most one hurt event per 4 points of damage. |
| RQ10 | OP | Automated tests cover city generation, climbing a stairwell, driving, and a full match through the Heart phase. |
| RQ11 | F | Every server announcement has a matching tone so audio and HUD stay in sync. |
| RQ12 | NF | Bots and players use the same Command path. |

### Edge cases

| ID | Case | Handling | Test |
|---|---|---|---|
| EC01 | Carrier dies in the lagoon | Heart placed on the water surface | Manual |
| EC02 | Carrier drives into extraction | Seat sync keeps the carrier position current, the hold counts | Manual |
| EC03 | Carrier leaves and returns | Progress bleeds, never resets instantly | Manual |
| EC04 | Two actors reach the Heart on the same tick | First interaction processed wins; the second sees it carried | Code path |
| EC05 | Everyone dies to the zone on the same tick | Match ends with no winner | sim.test |
| EC06 | Contract target dies to someone else | Informant contract stays live but stops progressing | Code path |
| EC07 | Survivor contract holder Awakens before the Heart | Contract fails | Code path |
| EC08 | Carrier Awakens | Awakening health stacks on top of the carrier bonus | Code path |
| EC09 | Bot stuck against an interior wall | Visible nearest node selection, jump, repath, loot blacklist | Bot debug run |
| EC10 | Player falls out of the world | Teleport to the nearest nav node below y of minus 30 | Code path |
| EC11 | Vehicle destroyed with occupants | Occupants ejected before the explosion | Code path |
| EC12 | Match length set to 6 minutes | Every phase still occurs in order | sim.test runs 1.5 minutes |

### Pathways

| ID | Pathway |
|---|---|
| PW01 | Heart wakes, a bot takes it, reaches extraction, holds 30 s, match ends. |
| PW02 | The player takes the Heart, is killed, the killer takes it. |
| PW03 | Nobody takes the Heart; the collapse forces a last survivor. |
| PW04 | The player completes The Smuggler and extracts alone; the match continues for others. |
| PW05 | The player dies; the death card offers to keep watching or return to the lobby. |
| PW06 | The player Awakens, is hunted, dies; the killer takes the Core. |
| PW07 | Carrier leaves extraction under fire, returns, finishes with less time remaining. |
| PW08 | Player pauses (single player), the sim halts, resumes cleanly. |
| PW09 | Player leaves mid match; profile records the match and XP. |
| PW10 | All actors die at once; the match ends with no winner. |

Approaches considered: a central match manager actor (rejected because it couples rules to entity code) against rules evaluated in `updateMatch` over plain state (chosen because it is testable headless and maps one to one onto a server tick).

## Going online: the plan

1. Move `Sim` into a Node WebSocket server. It already runs under Vitest in Node with Rapier.
2. Clients send Commands at 30 Hz with sequence numbers.
3. The server sends snapshots at 20 Hz: actor transforms, animation state, health, vehicle transforms, creature transforms, loot deltas and the event list.
4. Predict local movement on the client by running the same character controller against the same collider list, and reconcile on each snapshot.
5. Interpolate remote actors 100 ms behind.
6. Lag compensation for hitscan: the server rewinds actor capsules to the shooter's view time before casting.
7. Interest management by distance: replicate only what is within about 200 m, plus pinged carriers and Awakened.

## Tests

| Test | What it proves |
|---|---|
| city.test: determinism | Same seed, same city |
| city.test: real district | More than 60 buildings, a five storey block, three danfos, 150 loot spawns, three extractions |
| city.test: geometry | No NaN, no negative sizes |
| city.test: reachability | Over 95 percent of roofs and doors connect to the street graph |
| sim.test: spawn | 12 players, Runner has 10 slots, Scout has 6, a contract is assigned |
| sim.test: walking | Players stand on the ground and move |
| sim.test: stairs | A walker follows the nav path from a shop door to the roof of a three storey building |
| sim.test: match | Bots loot and shoot; the match reaches the Heart phase without NaN |
| sim.test: driving | A danfo moves under throttle and stays upright |

Run `npm test` in `game/`.
