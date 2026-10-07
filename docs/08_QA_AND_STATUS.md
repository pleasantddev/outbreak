# QA and Status

Build checked on 7 October 2026. Labels: IMPLEMENTED (code exists), TESTED (an automated test or a scripted browser run exercised it), PARTIALLY TESTED, NOT TESTED.

## Evidence

* `npm test`: 10 of 10 tests pass in about 110 s (city generation, determinism, reachability, spawning, walking, stair climbing to a roof, a full bot match through the Heart phase, danfo driving).
* `npm run build`: TypeScript strict passes, Vite builds the app, three.js and Rapier into separate chunks.
* Scripted headless Chromium runs (software WebGL): lobby, Operators, Armory, drop map, match load, a tour of the street, market, flyover, a building interior, a rooftop, the terminal, the lagoon jetty, entering a danfo, creatures up close, the Heart waking, Awakening, the Force ability, and a firefight that killed a Crawler. No script errors were reported.

Headless software rendering runs at about 10 frames per second, so these runs check correctness and look but say nothing about real GPU performance.

## Status

| Feature | Status |
|---|---|
| Seeded Oshodi district, 220 enterable buildings, stairwells to every roof | TESTED |
| Movement, sprint, crouch, jump, mantle, swim, fall damage | PARTIALLY TESTED (walk and stairs automated; mantle and swim by code review) |
| Third person GTA camera, over the shoulder aim, collision pull in | PARTIALLY TESTED (screenshots) |
| Hitscan weapons, spread, falloff, headshots, attachments | PARTIALLY TESTED (browser firefight) |
| Armour, bandages, med kits | IMPLEMENTED |
| Inventory with Runner 10 slot courier rig | TESTED (spawn test) |
| Loot spawning, pickup, auto pickup, drops on death | TESTED (bot match counts pickups) |
| Abilities: Force, Shadow, Metal, shards and ranks | PARTIALLY TESTED (Force fired in browser) |
| Awakening, monster vision, Core drop | PARTIALLY TESTED (transformation captured) |
| The Heart: wake, pulse, carry, drop, extraction hold | PARTIALLY TESTED (phase reached in tests; carrying by code review) |
| Secret contracts (six) and contract extraction | IMPLEMENTED |
| Corruption, blackout, collapse circle | PARTIALLY TESTED (phases reached in the bot match) |
| Vehicles: okada, danfo, SUV, part damage, hijack, run overs | PARTIALLY TESTED (danfo drive test) |
| Bots: loot, navigate buildings, fight, chase the Heart, extract | PARTIALLY TESTED (bot debug run and match test) |
| Creatures: Crawler, Hollow, Stalker, flashlight freeze | PARTIALLY TESTED (spawned and fought in browser) |
| Characters: clothing shader, prints, gear, hair, layered animation | TESTED (lineup render) |
| Weapons with skins and visible attachments | TESTED (armory render) |
| Lobby, Operators, Armory, Dossier, Settings, drop map | TESTED (browser run) |
| HUD, minimap, map, inventory, pause, end screen | PARTIALLY TESTED (HUD in every match screenshot) |
| Touch controls | NOT TESTED on a real phone |
| Procedural audio | NOT TESTED (headless runs have no audio device) |
| Online multiplayer | NOT STARTED (architecture ready, see 04) |
| Bots driving vehicles, boats | NOT STARTED |

## Known issues

* Rifles use the pistol aim pose, so rifles are held two handed close to the chest rather than shouldered. Shouldered rifle animations are the next animation task.
* Strafing plays forward walk cycles with the body turned toward the aim, and backpedalling reverses them. There are no dedicated strafe clips yet.
* Bots never drive.
* The JavaScript bundle is about 5.3 MB raw (2 MB gzipped), mostly Rapier's embedded WASM.
* First sight of a new creature type can hitch while its shader compiles.

## Playtest script

Run five matches and answer after each one:

1. Did you know what to do in the first 60 seconds?
2. Did shooting feel responsive at close and long range?
3. Did a vehicle chase happen, and was it fun?
4. Did the Heart pull you toward a fight you would otherwise have avoided?
5. Did anyone Awaken, and did the server react?
6. Did the last two minutes feel more intense than the first ten?
7. Did you want to queue again straight away?
