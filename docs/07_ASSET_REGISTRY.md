# Asset Registry

Every third party asset in the build, with its licence. Status GREEN means the licence is explicit and commercial use is clear.

| Need | Asset | Creator | Source | Licence | Commercial | Attribution | Date checked | Status |
|---|---|---|---|---|---|---|---|---|
| Human bodies | Universal Base Characters (Standard) | Quaternius | quaternius.com/packs/universalbasecharacters.html | CC0 1.0 | Yes | Not required | 2026 10 07 | GREEN |
| Hair and beards | Universal Base Characters hairstyles | Quaternius | same pack | CC0 1.0 | Yes | Not required | 2026 10 07 | GREEN |
| Animation | Universal Animation Library (Standard) | Quaternius | quaternius.com/packs/universalanimationlibrary.html | CC0 1.0 | Yes | Not required | 2026 10 07 | GREEN |
| Animation | Universal Animation Library 2 (Standard) | Quaternius | quaternius.com/packs/universalanimationlibrary2.html | CC0 1.0 | Yes | Not required | 2026 10 07 | GREEN |
| Road | road_damaged | Poly Haven | polyhaven.com/a/road_damaged | CC0 1.0 | Yes | Not required | 2026 10 07 | GREEN |
| Sidewalk | concrete_pavement_02 | Poly Haven | polyhaven.com | CC0 1.0 | Yes | Not required | 2026 10 07 | GREEN |
| Walls | damaged_plaster, painted_plaster_wall, concrete_block_wall, dirty_concrete | Poly Haven | polyhaven.com | CC0 1.0 | Yes | Not required | 2026 10 07 | GREEN |
| Floors | dirty_tiles, old_wood_floor | Poly Haven | polyhaven.com | CC0 1.0 | Yes | Not required | 2026 10 07 | GREEN |
| Metal | rusty_corrugated_iron, rusty_metal_02, rusted_shutter | Poly Haven | polyhaven.com | CC0 1.0 | Yes | Not required | 2026 10 07 | GREEN |
| Ground and wood | brown_mud_02, distressed_painted_planks | Poly Haven | polyhaven.com | CC0 1.0 | Yes | Not required | 2026 10 07 | GREEN |
| Fonts | Oswald, Teko, Special Elite, Inter (via Fontsource) | Google Fonts authors | fontsource.org | SIL Open Font Licence 1.1 | Yes | Licence text ships in node_modules | 2026 10 07 | GREEN |
| Engine | three.js, postprocessing, Rapier | Open source | npm | MIT, Zlib, Apache 2.0 | Yes | Licence notices in packages | 2026 10 07 | GREEN |

## Made in house

Weapons, vehicles, props, signs, billboards, the danfo livery, the sky, rain, fire, blood, every shader, every sound and the whole UI are procedural code written for this project.

## Pipeline

`game/tools/build-assets.mjs` converts the source packs into game ready GLB files: dedupe, prune, WebP textures at 1024 for bodies and 512 for hair, animation libraries with meshes stripped and keyframes resampled and quantized. Poly Haven textures are downloaded at 1k and recompressed to WebP. Total shipped assets come to about 15 MB.

Not used: the Quaternius Zombie Apocalypse Kit (chibi proportions clash with the grounded art direction) and any Mixamo content (its terms do not allow redistributing raw files in a public repository).
