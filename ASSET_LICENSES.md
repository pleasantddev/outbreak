# Asset licences

Every external file in `assets/` has a row here before it is committed. Status: GREEN (licence confirmed, terms
understood), YELLOW (usable, a detail still to confirm), RED (unclear or incompatible; never ship).

| File(s) | What | Creator | Source | Licence | Attribution | Status | Checked |
|---|---|---|---|---|---|---|---|
| `assets/characters/male.glb`, `female.glb` | Rigged base humans | Quaternius | Universal Base Characters, https://quaternius.com | CC0 1.0 | Not required (credited anyway) | YELLOW: carried over from HustleLife (optimised with glTF-Transform); confirm the pack page and keep its licence file | 15 Nov 2026 |
| `assets/characters/*_dark.webp`, `*_light.webp` | Skin textures for the base humans | Quaternius (assumed) | as above | CC0 1.0 (assumed) | n/a | YELLOW: origin to confirm against the pack | 15 Nov 2026 |
| `assets/animations/ual_core.glb`, `ual_combat.glb` | 86 animation clips (locomotion, punches, spells, roll, shield, sword, jumps) | Quaternius | Universal Animation Library 1 and 2, https://quaternius.com | CC0 1.0 | Not required (credited anyway) | YELLOW: carried over from HustleLife; confirm the pack page | 15 Nov 2026 |
| `assets/textures/*_diff/_nor/_arm.webp` | PBR sets: road, sidewalk, concrete, plaster, block, corrugated iron, rust, paint, planks | Poly Haven | https://polyhaven.com/textures | CC0 1.0 | Not required | YELLOW: carried over from HustleLife's pipeline (its CREDITS.md lists Poly Haven CC0 as the only source); record each source slug | 15 Nov 2026 |
| `assets/characters/realistic/{survivor,rogue,trooper,farah,girl}.glb` and `*_lod.glb` | Realistic human bodies, rebuilt onto the UAL skeleton by HustleLife's Blender pipeline (charbake) | Unknown (Fab library and Sketchfab uploads) | Fab / Sketchfab; original source pages not recorded in HustleLife | Unknown (Fab Standard Licence or Sketchfab CC-BY/Standard, per model) | Unknown | RED until each model's page, creator and licence are found. Allowed for internal prototyping at the founder's request (15 Nov 2026); must be GREEN or replaced before any public build | 15 Nov 2026 |
| `assets/characters/rocketbox/*/` (Male_Adult_18, Male_Adult_12, Male_Adult_04, Female_Party_02, Military_Male_06): FBX plus textures converted to webp (specular inverted to roughness) | Realistic rigged humans with facial blendshapes | Microsoft (Rocketbox Studios) | https://github.com/microsoft/Microsoft-Rocketbox (official, archived) | MIT | Keep the MIT notice (copy LICENSE into the credits) | GREEN: MIT, fetched from the official repository 15 Nov 2026 | 15 Nov 2026 |
| `assets/animations/mixamo/*.fbx` | Fighting, locomotion and casting animations (X Bot, without skin, in place, 30 fps) | Adobe Mixamo | https://www.mixamo.com, downloaded from the founder's own Adobe account | Adobe Mixamo terms: free for commercial use in games; the raw animation files may not be redistributed on their own | Not required | YELLOW: fine inside the game; keep this repository private and never publish the raw FBX files | 15 Nov 2026 |

Not carried over: HustleLife's `office` crowd model (unrigged), and the source files of the realistic bodies (they lived
in the old cloud sandbox, not in the repo).

## Map data
None yet. If The Crossing uses OpenStreetMap footprints, add: "Map data © OpenStreetMap contributors, ODbL 1.0,
https://www.openstreetmap.org/copyright" here and in the game credits. Google Maps 3D Tiles are never a source.
