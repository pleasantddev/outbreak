# Systems and Balance

Every number below lives in `game/src/data/balance.ts`, so a balance pass never touches logic.

## Movement

| Variable | Value | Notes |
|---|---|---|
| Jog | 4.6 m/s | Default on foot |
| Sprint | 6.8 m/s | Scout x1.08, Runner x1.03, Enforcer x0.97 |
| Aim walk | 2.6 m/s | |
| Crouch | 1.8 m/s | Silent footsteps |
| Jump | 5.2 m/s up, gravity 18 | About 0.75 m of clearance |
| Mantle | 0.45 to 2.05 m ledges | Space while facing a ledge |
| Swim | 2.4 m/s | Lagoon only |
| Fall damage | 7 per m/s above 15 m/s | Three storeys hurt, five can kill |
| Step height | 0.42 m | Kerbs and slabs, never stairs |

Stairs use invisible ramps under the visible steps, so climbing feels smooth and stays identical for bots.

## Weapons

| Weapon | Damage | Pellets | RPM | Mag | Reload | Hip / ADS spread | Range / max | Head |
|---|---|---|---|---|---|---|---|---|
| Ogun 9 | 24 | 1 | 380 | 12 | 1.4 s | 0.030 / 0.008 | 22 / 60 m | x2.0 |
| Okada SMG | 18 | 1 | 820 | 30 | 1.9 s | 0.040 / 0.016 | 18 / 55 m | x1.6 |
| Marina AR | 27 | 1 | 640 | 30 | 2.2 s | 0.050 / 0.006 | 45 / 140 m | x1.8 |
| Third Mainland 12 | 13 | 9 | 75 | 6 | 3.0 s | 0.090 / 0.065 | 9 / 30 m | x1.4 |
| Lekki Longshot | 96 | 1 | 42 | 5 | 3.1 s | 0.120 / 0.000 | 200 / 400 m | x2.2 |
| Cutlass | 55 | | 90 | | | | 2.2 m | x1.3 |

Damage falls off linearly from full range to 45 percent at max range. Moving widens spread by 60 percent, crouching tightens it by 30 percent. Firing breaks Shadow and makes noise that bots and creatures hear.

## Attachments (every one is a trade)

| Attachment | Gain | Cost |
|---|---|---|
| Red Dot | ADS spread x0.85, slight zoom | None beyond the slot |
| 4x Scope | ADS spread x0.6, deep zoom | Hip spread x1.15 |
| Suppressor | Noise x0.35 | Max range x0.85 |
| Compensator | Recoil x0.7 | Noise x1.3 |
| Extended Mag | Mag x1.5 | Reload x1.2 |
| Quick Mag | Reload x0.7 | Mag x0.8 |
| Vertical Grip | Recoil x0.75 | Move speed x0.97 |
| Laser | Hip spread x0.6 | Visible beam |

## Armour and health

* 100 health, armour up to 75 (Level 1: 25, Level 2: 50, Level 3: 75).
* Armour absorbs 70 percent of incoming player damage until depleted.
* Bandage: 2.5 s channel, 25 health. Med Kit: 5 s, 100 health. Sprinting, firing or taking damage cancels a heal.

## Archetypes

| Archetype | Weapon | Ability | Backpack | Perk |
|---|---|---|---|---|
| Scout | Okada SMG | Shadow | 6 | Sprint x1.08, quieter steps |
| Hunter | Marina AR | Force | 6 | Sees fresh enemy footprints |
| Enforcer | Third Mainland 12 | Metal | 6 | Starts with 25 armour |
| Runner | Ogun 9 | Force | **10** | Contraband pouch (3 per slot), vehicle entry 0.3 s |

## Backpack stack limits

| Item | Per slot |
|---|---|
| Light or heavy ammo | 120 |
| Shells | 32 |
| Sniper rounds | 25 |
| Bandage | 6 |
| Med Kit | 3 |
| Frag | 4 |
| Contraband | 1 (3 in a Runner pouch) |
| Repair kit, jerrycan, artifact, core | 1 or 2 |

## Abilities

| Ability | Cooldown | Effect at rank I | Rank II and III |
|---|---|---|---|
| Force | 14 s | 10 m cone, 18 m/s throw, 14 damage, stuns creatures, shoves vehicles, shatters Metal walls | x1.25 and x1.5 range and force |
| Shadow | 18 s | 4 s near invisibility and a 6.5 m dash | Longer and further |
| Metal | 20 s | 3.2 m wide, 2.3 m tall wall, 320 HP, 16 s | Wider and tougher |

Cooldowns shorten 15 percent per rank. Shards add a second ability or rank one up.

## Awakening

| Variable | Value |
|---|---|
| Duration | 45 s |
| Extra health | 150 |
| Regeneration | 8 per second |
| Speed | x1.55 |
| Jump | x1.9 |
| Claws | 70 damage, 2.6 m cone, 0.55 s |
| Wall climb | 4.5 m/s while pushing into a wall |
| Ping | Every 8 s to the whole server |
| Core drop | Full ability refill and rank up, Level 3 armour, full health |

## The Heart

| Variable | Value |
|---|---|
| Ping | Every 10 s |
| Carrier bonus | +50 max health, 3 health per second regeneration |
| Carrier speed | x0.92 |
| Creature pull | 60 m |
| Extraction hold | 30 s, bleeds at 0.5 per second when you leave |
| Contract extraction hold | 20 s |

## Vehicles

| Vehicle | Seats | Mass | Top speed | Body | Engine | Tyre |
|---|---|---|---|---|---|---|
| Okada | 2 | 180 kg | 30 m/s | 220 | 120 | 60 |
| Danfo | 6 | 1900 kg | 22 m/s | 1200 | 380 | 140 |
| Wahala SUV | 4 | 1700 kg | 28 m/s | 900 | 300 | 120 |

* Each flat tyre cuts top speed by 18 percent and that wheel's grip to 35 percent.
* Engine damage scales engine force down to 15 percent. At zero the vehicle burns and explodes after 5 s (8 m radius, 130 damage).
* Running someone over deals 3.2 damage per m/s above 5 m/s. Creatures take 6 per m/s.
* A self righting torque keeps cars upright; the okada leans into corners.

## Creatures

| Creature | HP | Speed | Damage | Sight / hearing | Notes |
|---|---|---|---|---|---|
| Crawler | 60 | 6.2 | 9 | 28 / 40 m | x1.3 at night |
| Hollow | 150 | 2.4 | 22 | 22 / 55 m | Often spawns idle, x1.4 at night |
| Stalker | 320 | 8.0 | 45 | 45 / 80 m | Deep night only, freezes while lit |

Creature population follows the phase: 14, 22, 32, 38, 40, then 30 during collapse. Corrupted districts add more.

## Zone and corruption

* Collapse starts at 16:00 at radius 520 m and shrinks to 30 m by 20:00, then keeps shrinking.
* Outside damage rises from 1 to 12 per second.
* Corrupted districts (two per match, 45 to 70 m radius) deal 1.5 per second.

## State machines

**Bot.** Perceive every 0.25 to 0.45 s. Decide every 0.5 s between Extract, Flee, Zone, Heal, Fight, Heart, Hunt, Loot and Roam. Fight strafes, settles aim error over time, bursts automatic weapons and uses abilities by situation. Loot paths across the nav graph, blacklists unreachable items and picks up on arrival.

**Creature.** Idle, Wander, Chase (direct steering when close, nav graph when not), Attack, Frozen (Force stun or Stalker held by a flashlight), Dead.
