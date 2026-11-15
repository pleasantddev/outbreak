# CLAUDE.md — Project Blueprint: "Bo Le Ka Ja" (Working Title)

## 1. Project Identity & Core Mandate
- **Working Tagline:** `BO LE KA JA` *(Official title TBD — do NOT use "Ase League")*
- **Genre:** Third-Person Multiplayer Hero Arena Brawler (inspired by *Marvel Rivals*, *Call of Duty: Mobile*, and *Fortnite*).
- **Combat Identity:** **ZERO GUNPLAY.** Fast, readable, over-the-shoulder free-aim combat combining close-range martial arts combos, ranged spiritual projectiles, mobility, defensive counters, and ultimate abilities.
- **Core Premise:** Players do NOT play as the gods themselves. Players control distinct **Champions** who pledge allegiance to a researched **Spiritual Patron** (*The Covenant*), customizing their build via Patron Gifts, Boons, and Mystical Charms.
- **Target Platforms:** PC (Primary development & high-end visual baseline) and Android (built with scalable quality tiers from Day 1).
- **Visual Target:** **High-End Stylized 3D** (rich PBR materials, normal/roughness maps, expressive shaders, dramatic lighting, distinct silhouettes). Never build flat low-poly placeholder art when PBR assets/shaders can be generated or sourced.

---

## 2. Strict Technical Stack (Godot 4.x Native)
- **Engine:** **Godot 4.x** (Latest stable LTS/release installed on system. Inspect environment first and pin version in `README.md`). **NEVER use Unity or Unreal conventions.**
- **Language:** **GDScript** exclusively for all game logic, UI, and networking.
- **Rendering:**
  - PC Baseline: **Forward+** renderer with high-end PBR materials, SSAO, Glow/Bloom, and dynamic directional shadows.
  - Scalability: Built-in graphics quality manager supporting **High/Ultra (PC)** and **Balanced/Performance (Android)** via LODs, VRAM texture compression, and particle scaling.
- **Core Godot Nodes & Systems:**
  - `CharacterBody3D` for Champions, `SpringArm3D` + `Camera3D` for **Over-the-Shoulder Free-Aim** reticle targeting.
  - Custom `Resource` classes (`.tres`) for all static definitions (`ChampionDefinition`, `PatronDefinition`, `AbilityDefinition`, `CharmDefinition`, `ArenaDefinition`, `CosmeticDefinition`, `MatchModeDefinition`, `ProgressionRewardDefinition`).
  - `MultiplayerAPI` + `ENetMultiplayerPeer` + `MultiplayerSpawner` + `MultiplayerSynchronizer` for **strictly server-authoritative** 4v4 networking and headless Linux/Windows dedicated servers (`--headless`).
  - Signal-driven decoupled architecture. Never build monolithic "God Manager" scripts.

---

## 3. Repository & Directory Structure
Maintain this exact Godot-native folder hierarchy:
```text
project/
├── CLAUDE.md
├── ARCHITECTURE.md
├── TASKS.md
├── ASSET_LICENSES.md
├── README.md
├── project.godot
├── addons/
├── assets/
│   ├── audio/          # Nigerian percussion, combat SFX, voice cues, UI audio
│   ├── characters/     # High-end PBR character meshes (.glb), Mixamo rigs
│   ├── environments/   # Modular Nigerian urban architecture, props (.glb)
│   ├── materials/      # PBR ShaderMaterials, triplanar/trim sheets
│   ├── textures/       # 2K/4K Albedo, Normal, Roughness, ORM maps
│   ├── animations/     # Retargeted combat, traversal, emote libraries
│   ├── vfx/            # Patron & ability particle/shader scenes
│   └── ui/             # Icons, Ankara/Adire geometric frames, fonts
├── data/
│   ├── champions/      # .tres ChampionDefinition instances
│   ├── patrons/        # .tres PatronDefinition instances
│   ├── abilities/      # .tres AbilityDefinition instances
│   ├── charms/         # .tres CharmDefinition instances
│   ├── arenas/         # .tres ArenaDefinition instances
│   ├── cosmetics/      # .tres CosmeticDefinition instances
│   └── progression/    # .tres Battle Pass & mastery tracks
├── scenes/
│   ├── boot/
│   ├── login/
│   ├── lobby/
│   ├── champion_select/
│   ├── patron_select/
│   ├── loadout/
│   ├── matchmaking/
│   ├── arena/
│   ├── champions/
│   ├── abilities/
│   └── ui/
├── scripts/
│   ├── core/           # Custom Resource base classes, Attribute/Modifier engine, EventBus
│   ├── player/         # Over-the-shoulder controller, free-aim raycast, state machine
│   ├── champions/      # Champion base class & kit bindings
│   ├── abilities/      # Reusable ability components (Damage, Heal, Shield, Mobility, CC, AoE)
│   ├── patrons/        # Covenant manager, Patron Gifts, Boons, Charm slot evaluator
│   ├── combat/         # Hitboxes, Hurtboxes, DamageCalculator, StatusEffects, Respawn
│   ├── networking/     # ENet server/client bootstrap, RPC validators, state sync
│   ├── progression/    # Account XP, Champion mastery, Patron rank logic
│   ├── economy/        # Store, Inventory, Battle Pass, Currency schemas
│   └── ui/             # Combat HUD, Lobby tabs, Touch/Controller adaptive controls
├── server/
│   ├── export_presets/
│   └── configuration/
├── tests/              # Automated GDScript unit & headless multiplayer verification tests
└── backend/            # ASP.NET Core + PostgreSQL API contracts & schemas
```

---

## 4. Gameplay Mechanics & Domain Rules

### A. Champion System (5 Roles, 6-Slot Kit)
- **Combat Roles:** `Vanguard` (Frontline/Space), `Duelist` (Mobile Assassin/Combo), `Controller` (Area Denial/Disruption), `Support` (Recovery/Shields), `Specialist` (Objective/Utility). No rigid role-lock in matchmaking.
- **Ability Structure (Every Champion):**
  1. `Basic Attack` (LMB / Primary combo chain or spiritual strike)
  2. `Secondary Attack` (RMB / Heavy guard-break, aimed spiritual blast, or block/parry)
  3. `Mobility Ability` (Shift / Dash, leap, wall-vault, or spirit-step)
  4. `Utility / Defensive Ability` (E / Barrier, cleanse, trap, or counter)
  5. `Signature Ability` (Q / Defining kit centerpiece)
  6. `Ultimate Ability` (F / Charged via combat & objective play)
- **Unified Attribute System:** All stats (`MaxHealth`, `MoveSpeed`, `AttackPower`, `Defense`, `AbilityPower`, `CooldownReduction`, `UtilityEffectiveness`) are computed dynamically via:
  `FinalStat = (BaseStat + FlatModifiers) * (1.0 + PercentModifiers)`.

### B. The Covenant — Patron Deity & Charm Loadout System
- **Separation of Identity:** Champion = Fighting Style. Patron = Spiritual Enhancements. Players can switch active Patrons freely outside matches.
- **Loadout Slots:** `1 Active Patron` (grants 1 **Patron Gift** passive + 1 selectable **Patron Boon**) + `2 Minor Charm Slots` + `1 Major Charm Slot`.
- **Competitive Fairness:** Charms are **sidegrades with trade-offs** (e.g., *+20% Mobility cooldown recovery, -15% shield duration*). Zero pay-to-win stats.
- **Cultural Classification & Research Integrity:**
  - Every Patron entry must record: `patron_id`, `display_name`, `tradition_community`, `documented_cultural_role`, `classification` (`PlayableCandidate`, `LoreOnly`, `SupremeCreator`, `CollectiveCategory`, `Restricted`, `Unverified`), and `cultural_review_status`.
  - **Strict Rule:** Do NOT invent fake deities, collapse distinct Nigerian traditions (Yoruba Ìṣẹ̀ṣe, Igbo Odinani/Alusi, Edo, Efik/Ibibio, Northern Bori, Tiv, Ijaw, Urhobo, Nupe) into one generic pantheon, or turn Supreme Creators (*Olodumare*, *Chukwu*, *Osanobua*, *Abasi*) into selectable combat buffs.
  - **Initial Prototype Patrons (Phase 2):**
    1. `PATRON_SANGO` (Yoruba — Storm pressure, lightning chain procs, area control)
    2. `PATRON_OGUN` (Yoruba — Close-range melee lethality, armor shred, frontline resilience)
    3. `PATRON_OSUN` (Yoruba — River flow mobility, team restoration, cooldown harmony)
    4. `PATRON_AMADIOHA` (Igbo — Sky-lightning strikes, justice retaliation, defensive control)
    5. `PATRON_ALA` (Igbo — Earth tremors, deployable stone cover, grounded damage reduction)
    6. `PATRON_OLOKUN` (Edo / Yoruba — Deep ocean tidal zoning, heavy shielding, disruption)

### C. Game Modes & Arenas
- **Primary Mode (`Convergence`):** 4v4 objective control over a shifting spiritually significant zone. Score is driven by objective control and team coordination.
- **First Arena (`The Crossing`):** Fictionalized outdoor Lagos urban intersection, transit hub, pedestrian overpass, commercial stalls, multi-height buildings, and side flanking routes.
- **Geographic Data Policy (Strict Legal Rule):** **NEVER extract, rip, or convert Google Maps 3D Tiles into game geometry.** Use **OpenStreetMap (OSM)** vector footprints (with ODbL attribution in `ASSET_LICENSES.md`), original Blender 3D modeling, and properly licensed PBR textures/models.

---

## 5. External Tooling: Blender & Claude in Chrome Asset Pipeline
Claude Code is authorized to use **Blender** (headless/CLI scripting) and **Claude in Chrome** (authenticated browser automation) to source and process **high-end PBR 3D assets, animations, textures, and audio**:

1. **Characters & Animations (Mixamo via Claude in Chrome + Blender CLI):**
   - Navigate to `https://mixamo.com` using the user's already logged-in Chrome session to download high-quality humanoid character rigs and martial arts / spellcasting / locomotion animations (`.fbx`).
   - Run Blender in background mode (`blender --background --python scripts/tools/process_character.py`) to merge animation tracks into a single NLA skeleton, optimize materials to PBR Metallic-Roughness, and export Godot-ready `.glb` files into `assets/characters/` and `assets/animations/`.
2. **High-End PBR Textures, HDRIs & 3D Props (Claude in Chrome):**
   - Source 2K/4K PBR texture sets (Albedo, Normal, Roughness, AO) and realistic sky HDRIs from:
     - **Poly Haven:** `https://polyhaven.com` (CC0)
     - **AmbientCG:** `https://ambientcg.com` (CC0)
     - **Kenney / Quaternius (only for rapid blockout props if needed, upgrade to PBR):** `https://kenney.nl` / `https://quaternius.com`
     - **Sketchfab (CC-BY / CC0 high-detail models only):** `https://sketchfab.com`
3. **Audio & Nigerian Rhythmic / Combat SFX (Claude in Chrome):**
   - *(The founder's blueprint was cut off at this point when it was pasted. Restore the rest of section 5 and any later sections from the original.)*

---

## Source documents
- `documentation/UNiti_GDD.txt`: the founder's GDD and development specification (Godot 4.x, GDScript). This is the spec.
- `documentation/Game_Development_GDD.txt`: an earlier draft. Its section 13 names C#, the Universal Render Pipeline and Unity
  Netcode, which contradict this file and UNiti. Those parts are superseded; everything else agrees with UNiti.

## Working rules for agents
- Commit as `Pleasant <joylove.rightchoice@gmail.com>`. No AI author, co-author or attribution lines in commits.
- Keep the project runnable after every task. Run `./tools/test.sh` before every commit.
- Phones are the performance target: measure on Android before adding expensive lighting or effects.
- Prose written for the founder: plain words, no em dashes.
