# Roadmap

Each milestone ends in something playable. Built for one developer working nights.

| Milestone | Goal | Playable result | Status |
|---|---|---|---|
| M0 Concept | Bible, art direction, architecture | These docs | Done |
| M1 Playable core | Move, shoot, loot, die, win | Solo match against 11 bots | Done |
| M2 Vertical slice | The Heart, Awakening, vehicles, creatures, city, UI | This build | Done, now in playtesting |
| M3 Online foundation | Node server running `Sim`, WebSocket Commands, snapshots, prediction, lag compensation | Two browsers in one match | Next |
| M4 Feel pass | Strafe blends, hit reactions, recoil patterns, audio mix on real devices | Gunplay that feels like CODM | Next, in parallel with M3 |
| M5 Squads and modes | Duos and squads, revives, pings, Extraction, TDM | Friends queue together | Planned |
| M6 Lagos expands | Boats and the Flood season, underwater spaces, Drowned, more districts | Season 2 | Planned |
| M7 Release candidate | Mobile performance on mid range Android, accounts, store build | Public test | Planned |

## Next five tasks, each checkable

1. Strafe and backpedal blends: rotate the hips toward the movement direction while the spine keeps the aim, and confirm side steps no longer slide.
2. Server: run `Sim` in a Node WebSocket process and connect two browser clients that each see the other move.
3. Bot drivers: let bots enter a danfo or okada when their target is more than 150 m away and follow road nodes, and confirm in a scripted match that at least one bot drives.
4. Boats: canoes and a speedboat on the lagoon with the ray cast vehicle in water mode.
5. Mobile pass: profile on a mid range Android phone at Low quality and hold 30 frames per second in the market.
