# Architecture

Godot 4.7.2 (pinned, see README), GDScript only. This document is the contract the code follows. When code and this
file disagree, fix one of them in the same commit.

## 1. Principles

1. **One simulation, two presentations.** All gameplay rules (movement, abilities, damage, cooldowns, objective, score,
   respawn) live in scripts that run identically on a listen host, a dedicated headless server and an offline sandbox.
   Visual and audio code only reacts to state and signals. A headless server never instantiates meshes, particles or UI.
2. **Data drives gameplay.** Every number a designer tunes lives in a `.tres` Resource under `data/`. Gameplay scripts
   read definitions; they never hard-code champion stats, patron effects or ability numbers.
3. **Abilities are composed, not written.** An ability is a definition plus an ordered list of reusable effect
   components (damage, heal, shield, dash, area, status). New champions add data, not new systems.
4. **The server decides.** Clients send intent (input and ability requests). The server validates and owns health,
   cooldowns, hits, objective, score, respawn and match end. A client never awards itself anything.
5. **Small parts that talk through signals.** Global events go through the `EventBus` autoload; local wiring uses node
   signals. No script owns "the game".

## 2. Autoloads (project.godot)

| Name | Script | Job |
|---|---|---|
| `EventBus` | `scripts/core/event_bus.gd` | Global signals only. Holds no state. |
| `Registry` | `scripts/core/registry.gd` | Loads every definition under `data/` once at boot, indexed by id. Read-only after boot. |
| `GameSettings` | `scripts/core/game_settings.gd` | Graphics tier, sensitivity, audio volumes; saved to `user://settings.cfg`. |
| `Net` | `scripts/networking/net.gd` | Starts/stops ENet peers, knows the role (offline, server, client), exposes `is_authority()`. |

`EventBus` signals (the full list; add here first, then in code):

```
champion_spawned(champion: Node, peer_id: int, team: int)
champion_damaged(target: Node, source: Node, amount: float, ability_id: StringName)
champion_healed(target: Node, source: Node, amount: float)
champion_shielded(target: Node, amount: float, duration: float)
champion_died(victim: Node, killer: Node, ability_id: StringName)
champion_respawned(champion: Node)
ability_cast(caster: Node, ability_id: StringName, slot: int)
ability_ready(caster: Node, slot: int)
ultimate_charge_changed(caster: Node, value: float)       # 0..1
status_applied(target: Node, status_id: StringName, duration: float)
status_removed(target: Node, status_id: StringName)
objective_state_changed(owner_team: int, progress: float, contested: bool)
score_changed(team: int, score: int)
match_phase_changed(phase: StringName)                   # warmup, active, overtime, ended
match_ended(winner_team: int)
```

## 3. Data model (custom Resources, `scripts/core/defs/`)

All definitions extend `GameDefinition` (`id: StringName`, `display_name: String`, `description: String`).

**StatBlock** (`stat_block.gd`): base values for `max_health, move_speed, attack_power, defense, ability_power,
cooldown_reduction, utility_effectiveness, mobility`.

**StatModifier** (`stat_modifier.gd`): `stat: StringName, flat: float, percent: float, source: StringName`.
A charm's trade-off is two modifiers, one positive and one negative.

**Attributes** (`scripts/core/attributes.gd`, a RefCounted owned by each champion at runtime):
`final(stat) = (base + sum(flat)) * (1.0 + sum(percent))`, clamped per stat (cooldown reduction 0..0.6, move speed >= 1,
everything else >= 0). Modifiers are added and removed by `source`, so removing a charm or an expired status is one call.
Values are cached and recomputed only when a modifier changes.

**AbilityDefinition**: `slot` (BASIC, SECONDARY, MOBILITY, UTILITY, SIGNATURE, ULTIMATE), `cooldown: float`,
`charges: int`, `cast_time: float`, `recovery: float`, `reach: float`, `targeting` (MELEE_ARC, PROJECTILE, HITSCAN_AIM,
SELF, GROUND_AIM), `ult_cost: float` (ultimate only, 0..1), `effects: Array[AbilityEffect]`, `animation: StringName`,
`vfx: PackedScene` (client only, may be null), `combo_next: StringName` (basic attack chains).

**AbilityEffect** (abstract, `scripts/abilities/effects/`): `func apply(ctx: AbilityContext) -> void`. Shipped components:
`DamageEffect (amount, scaling_stat, scaling)`, `HealEffect`, `ShieldEffect (amount, duration)`,
`DashEffect (distance, duration, through_units)`, `AreaEffect (radius, inner: Array[AbilityEffect], affects)`,
`StatusEffectApply (status: StatusDefinition)`, `KnockbackEffect`, `SpawnProjectileEffect (speed, radius, lifetime,
on_hit: Array[AbilityEffect])`. `AbilityContext` carries caster, aim origin and direction, targets hit, the server time
and the caster's Attributes.

**StatusDefinition**: `id, duration, modifiers: Array[StatModifier], tick_effects: Array[AbilityEffect],
tick_interval, flags (stun, root, silence, slow)`.

**ChampionDefinition**: `role` (VANGUARD, DUELIST, CONTROLLER, SUPPORT, SPECIALIST), `biography`, `origin`,
`base_stats: StatBlock`, `abilities: Array[AbilityDefinition]` (exactly six, one per slot, validated at load),
`model: PackedScene`, `skin: Texture2D`, `capsule_height`, `capsule_radius`.

**PatronDefinition**: `patron_id, display_name, alternative_names, tradition_community, geographic_context,
documented_cultural_role, research_sources: PackedStringArray, pronunciation, classification` (PLAYABLE_CANDIDATE,
LORE_ONLY, SUPREME_CREATOR, COLLECTIVE_CATEGORY, RESTRICTED, UNVERIFIED), `cultural_review_status` (NOT_REVIEWED,
IN_REVIEW, APPROVED, CHANGES_REQUESTED), `approval_status`, then the invented game layer, kept apart:
`gameplay_identity, gift: PatronGift, boons: Array[PatronBoon], charms: Array[CharmDefinition], vfx_color`.
Only `PLAYABLE_CANDIDATE` patrons can be equipped; `Registry` refuses the others, which enforces the supreme creator rule.

**PatronGift / PatronBoon**: `modifiers: Array[StatModifier]`, `ability_overrides` (slot to extra effects),
`triggers` (on_hit, on_kill, on_low_health with an effect list).

**CharmDefinition**: `size` (MINOR, MAJOR), `category` (MOBILITY, DEFENSIVE, ABILITY, UTILITY, PATRON),
`modifiers` (must contain at least one negative, validated by a test), `patron_id` (PATRON charms only).

**ArenaDefinition**: `scene: PackedScene, spawn_points_team_a/b` (marker node paths), `objective_points`,
`bounds: AABB`, `osm_attribution: String`.

**MatchModeDefinition**: `team_size, score_to_win, capture_rate, contest_rule, objective_move_interval, respawn_base,
respawn_per_minute, time_limit`.

**CosmeticDefinition / ProgressionRewardDefinition**: id, slot, unlock source. Never carry stat modifiers (test-checked).

**Loadout** (runtime Resource, saved per account): `champion_id, patron_id, boon_id, minor: [id, id], major: id`.
`Covenant.validate(loadout)` checks ids exist, the patron is playable, the boon belongs to the patron, charm sizes match
their slots and no charm is equipped twice.

## 4. Scenes and node trees

```
scenes/boot/boot.tscn            Control: reads command line (--server, --connect=host:port, --sandbox), routes
scenes/lobby/lobby.tscn          Control + SubViewport stage with the selected champion
scenes/arena/arena_root.tscn     Node3D "Arena"
  ├─ World (instanced from ArenaDefinition.scene: geometry, lights, WorldEnvironment, markers)
  ├─ Champions (Node3D)          MultiplayerSpawner spawn_path points here
  ├─ Projectiles (Node3D)        MultiplayerSpawner
  ├─ Match (Node)                match_state.gd: phases, score, timer (server runs logic, clients mirror)
  ├─ Objective (Area3D)          objective.gd: capture progress, contest, moves on interval
  └─ HUD (CanvasLayer)           client only, freed on headless
scenes/champions/champion.tscn   CharacterBody3D "Champion" (champion.gd)
  ├─ Collision (CollisionShape3D capsule)
  ├─ Hurtbox (Area3D, layer HURTBOX)
  ├─ Visual (Node3D)             client only: model instance, AnimationTree, VFX anchors
  ├─ CameraRig (Node3D)          local player only
  │   └─ Yaw (Node3D) → Pitch (Node3D) → SpringArm3D → Camera3D
  ├─ Health (Node)               health.gd: health, shield stack, death, signals
  ├─ AbilityRunner (Node)        ability_runner.gd: six slots, cooldowns, charges, cast/recovery, ult charge
  ├─ StatusHost (Node)           status_host.gd: active statuses, ticks, expiry
  ├─ Controller (Node)           player_input.gd (local) or nothing (remote/server)
  └─ Sync (MultiplayerSynchronizer)
```

Champion state machine (in `champion.gd`, small and explicit): `IDLE, MOVING, AIRBORNE, CASTING, RECOVERING, DASHING,
STUNNED, DEAD`. Casting and recovering lock or slow movement as the ability defines.

## 5. Over-the-shoulder free aim

- Camera rig: yaw node rotates around world Y with mouse X; pitch node around local X with mouse Y, clamped to
  -70..+60 degrees. The spring arm is offset right `0.55 m` and up `1.55 m` from the champion origin, length `3.2 m`,
  collision mask = world only, so the camera slides in against walls instead of clipping.
- Movement is camera-relative: `wish = (yaw_basis * Vector3(input.x, 0, input.y)).normalized()`. The body turns toward
  the aim yaw while attacking or aiming, and toward the move direction otherwise (`lerp_angle`, 12 rad/s).
- **Aim point:** cast a ray from the camera through the screen centre (the reticle) up to `AIM_RANGE = 80 m`, excluding
  the shooter. If it hits, the aim point is the hit; otherwise it is the far end of the ray.
- **Shot direction:** projectiles and hitscan leave from the champion's `muzzle` (chest height, slightly forward), not
  from the camera, along `(aim_point - muzzle).normalized()`. This keeps over-the-shoulder shots honest: a wall between
  the champion and the target blocks the shot even if the camera can see past it. Before firing, a short ray from
  muzzle to aim point checks for that blocker and moves the impact to it.
- Melee uses an arc test on the server: targets within `range` whose direction from the caster is within `arc/2` of the
  aim yaw, with line of sight from chest height.
- The client sends `(aim_origin, aim_dir)` with each ability request; the server re-derives the muzzle from its own
  authoritative position and rejects an origin more than `1.5 m` from it.

## 6. Ability pipeline

```
input → AbilityRunner.request(slot, aim) ─(client)→ rpc_id(1, "server_request_ability", slot, aim_origin, aim_dir, seq)
server: validate(peer owns champion, alive, not stunned/silenced, slot ready, charges > 0, rate limit)
      → start cast (cast_time) → resolve: build AbilityContext → for effect in effects: effect.apply(ctx)
      → set cooldown = def.cooldown * (1 - final(cooldown_reduction)) → emit EventBus.ability_cast
      → replicate: cooldown end time and cast event to clients (reliable rpc), health/shield via Sync
client: plays animation/VFX from the cast event; predicts only its own cooldown UI (corrected by the server value)
```

Offline sandbox runs the same path with the local peer as authority, so there is no second code path to drift.

Damage formula (`scripts/combat/damage.gd`): `raw = amount + scaling * final(scaling_stat)`,
`mitigated = raw * 100 / (100 + final(defense))`, shields absorb first. Ultimate charge: +1% per 40 damage dealt, +1% per
30 healing done, +2% per second on the objective, capped at 100%.

## 7. Networking

- Transport `ENetMultiplayerPeer`, default port `24565`, max 8 clients plus spectators later.
- Roles: `--server` (headless dedicated), `--connect=host:port` (client), `--sandbox` (offline, local authority).
- `MultiplayerSpawner` under `Champions` and `Projectiles`; spawn function receives `{peer_id, team, champion_id,
  loadout}` and builds the champion from the Registry, so spawns are data, not scenes per champion.
- `MultiplayerSynchronizer` on each champion replicates from the server: `position, velocity, aim_yaw, aim_pitch,
  state, health, shield, ult_charge` (on change for health and ult, always for transform at 30 Hz).
- Client input: an unreliable rpc at the physics rate carrying `(seq, move: Vector2, jump, aim_yaw, aim_pitch)`; the server
  stores the latest per peer and simulates. Prediction and reconciliation for the local player come after the
  authoritative loop is proven (TASKS phase 3).
- Validation and limits on every rpc: sender id must own the champion, values clamped, ability requests limited to 20 per
  second, oversized or malformed input dropped and counted; three strikes in ten seconds disconnects the peer.
- The match server reports results to the backend with a server credential; clients never call reward endpoints.

## 8. Rendering and quality tiers

- Desktop: Forward+ (`rendering/renderer/rendering_method="forward_plus"`). Android: Mobile renderer
  (`rendering_method.mobile="mobile"`).
- `GameSettings.tier`: ULTRA, HIGH (PC), BALANCED, PERFORMANCE (Android). The tier sets shadow size and distance, SSAO,
  glow, SSR, MSAA, particle amount multiplier, LOD bias and texture size. Resolution is never lowered below native as a
  performance fix; cost is cut everywhere else first.
- Textures ship as VRAM-compressed (ETC2/ASTC on Android, S3TC/BPTC on desktop).

## 9. Tests

`tests/run_tests.gd` is a SceneTree script run headless. It loads every `tests/test_*.gd`, calls each `test_*` method,
and exits non-zero on any failure. Multiplayer tests start a server and two client peers in one process on loopback and
step frames. `tools/test.sh` wraps it so every commit runs the same command.
