# Art and UI Direction: Sodium Noir

## Visual thesis

**A real Lagos street at the worst hour of the worst night: sodium orange and blood red light cutting through wet darkness, with grounded human figures and grime on everything.**

The look is grounded realism lit like a horror film. The references are the night streets of Dying Light, the restraint of The Last of Us Part II and the readable combat silhouettes of Warzone and CODM, carried through Lagos's own material language: plastered block walls, rusted corrugated roofs, yellow danfos, hand painted shop boards and black GeePee tanks.

We rejected cartoon low poly, which you ruled out, and isometric pixel art, which belongs to Project Zomboid's camera. Photoreal AAA was also out, because a solo developer cannot ship it in a browser.

## Why this works for a browser game made by one developer

* **Darkness is a budget.** A night city hides distance, simplifies geometry and lets a few strong lights carry the composition. Fog and rain do the rest.
* **Scanned materials carry realism.** Every wall, road and roof uses a CC0 photoscanned PBR set from Poly Haven, so a box reads as plaster, rust or wet asphalt.
* **Wet streets double the lights.** Puddles and rain darkened roughness reflect every lamp and the blood moon, so the frame fills with highlights without extra geometry.
* **Bodies are real; clothing is a shader.** Realistic CC0 bodies from Quaternius's Universal Base Characters take a procedural clothing layer, so customization costs no extra meshes.

## Palette

| Role | Colour | Use |
|---|---|---|
| Ink | #060507 | Shadows, UI ground |
| Blood | #8a0b0b | Accent, danger, the Heart |
| Blood high | #d4161c | Highlights, hit markers, the PLAY button |
| Bone | #e8e0d0 | Text, crosshair, key highlights |
| Sodium | #f2a03d | Streetlights, warnings, contract text |
| Toxic | #39ffb0 | Extraction only, so it never gets confused with anything else |
| Rare, epic, mythic | #3a8aff, #b04aff, #ff2a2a | Loot rarity rings and pickup prompts |

## Lighting rules

1. **Sodium is the street.** Working lamps are orange, a third of them are dead and some stutter.
2. **Red belongs to danger.** Fire, the Heart, corruption, blood, the blood moon. Never use red for neutral information.
3. **White light is human.** Flashlights, generators and lit windows are where survivors are. Bots and remote players show a visible beam in the rain.
4. **Cold fill from the moon.** A dim blue directional light gives silhouettes and shadows.
5. **The night deepens.** The sky, the fog and the moon move from dusk to deep night as the match runs.
6. **Light can die.** Blackouts kill lamps by district, and the corruption tints the whole grade red.

## Post-processing stack

ACES tone mapping, mipmap bloom, a custom split tone grade with crushed blacks and boosted reds, a vignette, film grain, slight chromatic aberration, and gameplay driven layers: blood seeping from the screen edges when hurt, a heartbeat throb at low health, a red shockwave on every Heart pulse, a red cast inside corruption and Awakened vision.

## Characters

* **Bodies.** Quaternius Universal Base Characters (CC0), masculine and feminine, rigged to the Universal Animation Library skeleton.
* **Animation.** Universal Animation Library 1 and 2 (CC0): locomotion, crouch, sprint, jump, swim, drive, pistol aim and shoot and reload, melee, spell cast, climb, death, hit reactions and zombie walk, idle and scratch. The upper and lower body play separately so a survivor can aim while running. Long guns are shouldered with two bone arm IK: the gun sits at the shoulder along the aim and both hands are pulled onto the grip and foregrip, with a procedural recoil kick.
* **Clothing shader.** Clothing regions are worked out from the bind pose skeleton (sleeve length, waist, ankles, neckline) and painted procedurally with fabric weave, grime at the hems, mud on the legs and blood driven by a wear slider. Clothing sits slightly proud of the skin so silhouettes read.
* **Prints with Lagos identity.** Ankara Sunburst, Ankara Lagoon Wave, Adire Indigo, Strip Weave, Urban Camo, Night Camo and Danfo Stripe.
* **Tops.** Street Tee, Hoodie with kangaroo pocket, Bomber Jacket with zip and cuffs, Tactical Shirt with chest pockets, and a Short Agbada with an embroidered neckline that falls to the knee.
* **Gear on bones.** Cap, Fila, Helmet, Bandana mask, Gas mask, Hood, Plate carrier and Backpack, each placed in bind pose space and parented to the right bone.
* **Hair.** Six hairstyles plus a beard, rebound onto the character's skeleton.
* **Face.** Marks, Bone paint and Ash.
* **Skin.** Six tones, darkest first, because the default Lagos survivor is dark skinned.

### Creatures use the same bodies

| Creature | Treatment |
|---|---|
| Crawler | Grey green rotting skin, veins, wounds, clothes torn open, hunched fast crouch run |
| Hollow | Ash white skin, white glowing eyes, stillness |
| Stalker | Stretched 28 percent taller and thinner, black skin cracked with emissive red, burning eyes |
| Awakened player | The player's own outfit swallowed by black veins and red cracks, eyes ignite |

Corpses on the streets are baked from the Death01 pose into static instanced meshes.

## Weapons

Weapons are procedural, built to real proportions, with a pistol, an SMG, an AR, a pump shotgun, a bolt action sniper and a cutlass. Attachments are visible on the model: red dot, 4x scope, suppressor, compensator, extended and quick magazines, vertical grip, and a laser whose beam shows in the rain. Finishes use canvas generated patterns: Factory, Oshodi Rust, Bloodwork, Ankara, Big Man Gold, Nightfall, Danfo Yellow and Bone Charm, plus a blood charm.

## World

* Box geometry with world aligned UVs so textures continue across wall segments and window cuts.
* Fake ambient occlusion through vertex colour: walls darken toward their base, ceilings stay dim.
* Puddles, rain darkening and soot streaks through a shader on every material.
* Instanced props: lamps, generators, stalls, burnt wrecks, wrecked danfos, water tanks, cranes, palms, kiosks, canoes, tyres, dishes, crates, beds, tables and shelves.
* Shop signs drawn into one text atlas with real Lagos naming: MAMA CHIOMA PROVISIONS, GOD'S TIME IS THE BEST ELECTRONICS, NO WEAPON FORMED AUTO PARTS, IYA BASIRAT BUKA, EKO BOYS VULCANIZER.
* Billboards: PRAY FOR LAGOS, EKO O NI BAJE, HAVE YOU SEEN THIS CHILD?, MIRACLE CRUSADE TONIGHT.
* Danfo livery: yellow, black stripes, rust bloom and a back slogan such as GOD DEY, NO TELL MY MAMA or SHINE YA EYE.

## UI direction: bloody darkness

### What we took from the references

| Reference | Lesson |
|---|---|
| Dying Light 2 | A distressed condensed wordmark for identity, clean sans serif inside the HUD, and a HUD the player can thin out |
| The Last of Us Part II | A minimal HUD that shows only what you need and lets the world carry the tone |
| Warzone and CODM lobbies | Operator in the centre of a 3D backdrop, mode card and a dominant deploy button bottom right, loadout and armory one click away, attachment stats with visible tradeoffs |
| Horror menu practice | Dark painterly backgrounds with one warm focal light, noise post-processing, minimal fonts for buttons, never blood fonts on interactive text |

### Type system

| Face | Use |
|---|---|
| Oswald | Headings, nav, buttons, labels, set in capitals with wide tracking |
| Teko | Numbers: timer, ammo, placement, stats |
| Special Elite | Lore, contracts, tips, death lines: the voice of recovered notes |
| Inter | Small body copy |

### Shape language

Cut corner panels, corner tick marks, slanted tags, hexagonal ability and level badges, a hand painted blood brush behind the active nav item, red drips from the wordmark and film grain over everything.

### Screens

* **Lobby.** Your operator stands under a stuttering sodium lamp in the rain next to a danfo with its headlights on, a fire barrel and a shop shutter. Nav on the left, mode card and archetype chips on the right, DEPLOY bottom right, and a ticker of tips and lore along the bottom.
* **Operators.** Operator list with bios, a live 3D preview you can turn, and tabs for Body, Head, Top, Bottom, Gear and Marks.
* **Armory.** Weapon list, a rotating weapon on a stage, stat bars that show gains in green and losses in red, finishes with level locks, and attachment slots with tradeoff text.
* **Drop.** The district map with Heart sites and extraction points marked. Tap where you land.
* **HUD.** Rotating minimap with gunfire ticks, phase and timer, compass with Heart and extraction markers, killfeed, a dynamic crosshair, hit markers that turn red on kills and headshots, damage direction arcs, vitals with lagging damage, weapon and ammo, ability hexes with cooldown sweeps, the contract card, pickup toasts, world space distance markers and an extraction progress bar.
* **Mobile.** A floating left stick, look by dragging the right side, a CODM style left fire button, and buttons for aim, jump, crouch, reload, use, both abilities, heal, frag, swap, Awaken, map, bag and pause.

## Sources consulted

* Dying Light 2 UI and accessibility coverage: gamingnexus.com/News/48597
* Dying Light wordmark analysis: madegooddesigns.com/?p=10679
* The Last of Us Part II UX review: uxdesign.cc/uxd-playing-games-the-last-of-us-ii-7e93aecd2b3d
* HUD and inventory study: medium.com/@brdelfino.work/ux-and-ui-in-game-design-exploring-hud-inventory-and-menus-5d8c189deb65
* Warzone Mobile loadout flow: esports.net/news/mobile-games/how-to-customize-loadouts-in-warzone-mobile
* Horror menu conventions: summerengine.com/asset-store/horror-fps-main-menu-ui-66593544
* Quaternius packs and licences: quaternius.com
* Poly Haven textures: polyhaven.com
