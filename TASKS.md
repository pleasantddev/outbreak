# Tasks

Tick a box only when the thing works and its check has been run. Put the commit hash after the tick.
Phases follow the UNiti roadmap: phase 1 is milestones 0 and 1, phase 2 is milestones 2 and 3, phase 3 is milestone 4,
phase 4 is milestones 5 and 6, phase 5 is milestones 7 and 8.

## Phase 1: Foundation and combat sandbox (milestones 0 and 1)

### Task 1: Project initialisation
- [x] Environment audit recorded in README (Godot, Blender, Python, Git, OS, GPU).
- [x] `project.godot`: name, main scene, Forward+ on desktop and Mobile on Android, physics layers named, autoloads.
- [x] Folder structure as in CLAUDE.md section 3.
- [x] InputMap: move (WASD and left stick), look (mouse and right stick), jump, basic, secondary, mobility, utility,
      signature, ultimate, scoreboard, pause. Check: test lists every action with at least one key and one pad event.
- [x] Custom Resource classes: GameDefinition, StatBlock, StatModifier, AbilityDefinition, AbilityEffect,
      StatusDefinition, ChampionDefinition, PatronDefinition, PatronGift, PatronBoon, CharmDefinition, ArenaDefinition,
      MatchModeDefinition, CosmeticDefinition, ProgressionRewardDefinition, Loadout.
- [x] Attributes engine with the formula `(base + flat) * (1 + percent)`. Check: unit tests for stacking, removal by
      source, clamps.
- [x] EventBus autoload with the signal list from ARCHITECTURE.
- [x] Headless test runner and `tools/test.sh`. Check: runs in CI-style headless mode and fails on a broken test.
- [x] Boot scene opens with the project. Check: `godot --headless --quit-after 60` exits cleanly with no errors.

### Task 2: Arena blockout (test arena)
- [x] Graybox plaza with two spawn areas, a central objective pad, two side routes, cover, one raised walkway.
- [x] PBR materials from the Poly Haven sets (road, sidewalk, plaster, concrete, corrugated iron).
- [x] WorldEnvironment: sky, ACES or AgX tonemap, glow, SSAO on HIGH only, one shadowed sun.
- [x] Out-of-bounds kill volume and invisible walls at the edge.

### Task 3: Champion controller
- [x] CharacterBody3D champion with the capsule from its definition, gravity, jump, camera-relative movement.
- [x] Over-the-shoulder SpringArm3D camera with clamped pitch, wall collision and shoulder offset.
- [x] Screen-centre reticle; aim point by camera ray; muzzle-to-aim blocker check.
- [x] Quaternius character with animations from the CC0 library: idle, jog, sprint, jump, land, hit, death, punches.
- [x] Check: a test drives inputs headless and asserts position change and that the camera never ends inside a wall.

### Task 4: Ability framework and the first champion
- [x] AbilityRunner with six slots, cooldowns, charges, cast and recovery, ultimate charge.
- [x] Effect components: Damage, Heal, Shield, Dash, Area, Projectile, Status, Knockback.
- [x] Champion A (Vanguard) data: basic three-hit combo, guard-break secondary, shoulder dash, barrier, ground slam
      signature, ultimate.
- [x] Training dummies that take damage and show numbers.
- [x] Check: unit tests for cooldown with reduction, combo chaining, shield absorbing before health, dash distance.

### Task 5: Health, death, respawn, HUD
- [x] Health and shield with signals; death state; respawn after the mode's delay at a team spawn.
- [x] Combat HUD: health and shield bar, six ability icons with cooldown sweeps, ult meter, reticle with hit marker,
      damage numbers, kill feed, respawn timer.
- [x] Check: a test kills a dummy champion and asserts respawn position, full health and reset cooldowns.

### Phase 1 follow-ups (found while testing)
- [ ] Champion outfits: the CC0 base bodies are unclothed. Each champion needs its own clothing and silhouette
      (Blender pipeline or licensed outfit packs) before anyone outside the team sees it.
- [ ] First-play shader hitch: the first run compiled shaders for about 15 s. Warm every material and particle once
      behind the loading screen, then measure again.
- [ ] Hit-stop (2 to 4 frames), camera kick and hit sparks on melee impacts; impact sounds.
- [ ] Ability VFX for the slam, guard and quake (now only animations, damage numbers and the shield bar show them).

## Phase 2: Champions and the Covenant (milestones 2 and 3)
- [ ] Champions B (Duelist), C (Controller), D (Support) as data plus any new effect components they need.
- [ ] Champion select screen with 3D preview.
- [ ] Patron research register in `data/patrons/` for every name in the UNiti register, each classified, with sources.
- [ ] Three prototype patrons playable (Sango, Ogun, Osun first), each with a gift and three boons, cultural review
      status recorded as NOT_REVIEWED.
- [ ] Charm system: two minor and one major slot, trade-off validation, at least 12 charms.
- [ ] Patron select and loadout screens; loadout saved locally.
- [ ] Check: every champion with every patron loads and casts all six abilities in a headless test.

## Phase 3: Multiplayer (milestone 4)
- [ ] `Net` autoload: `--server`, `--connect`, `--sandbox`.
- [ ] Dedicated server export preset (headless) and a script that starts it.
- [ ] Spawner and synchroniser for champions and projectiles; team assignment.
- [ ] Server-authoritative movement, abilities, hits, health, respawn, objective, score, match end.
- [ ] Input and ability rpc validation, rate limits, disconnect handling, reconnection into the same team.
- [ ] Client prediction and reconciliation for the local champion.
- [ ] Check: one process test with a server and two clients; a second test with three separate OS processes.
- [ ] Network conditions test: 150 ms latency and 3% loss (tc/pfctl or a proxy) with notes.

## Phase 4: The Crossing, lobby and progression (milestones 5 and 6)
- [ ] The Crossing arena: plaza, connected streets, overpass, covered passages, side routes, landmarks, cover, bounds.
- [ ] OSM footprint reference (with ODbL attribution) or fully original layout; recorded in ASSET_LICENSES.
- [ ] Convergence mode: moving objective, capture and contest rules, score to win, overtime.
- [ ] Lobby with Play, Champions, Patrons, Loadout, Profile, Settings; match results screen; return to lobby.
- [ ] Backend contracts in `backend/` (OpenAPI) for accounts, loadouts, progression, match results.
- [ ] Persistent progression: account XP, champion mastery, patron rank (server-reported results only).

## Phase 5: Economy, seasons and Android (milestones 7 and 8)
- [ ] Cosmetic inventory, store, battle pass (free and paid tracks), no stats on any cosmetic (test-checked).
- [ ] Android export with internet permission, touch controls (left stick, look pad, six ability buttons).
- [ ] Quality tiers wired and measured on a real mid-range Android phone; numbers recorded.
- [ ] Network test from Lagos, Abuja and Port Harcourt before choosing hosting.
