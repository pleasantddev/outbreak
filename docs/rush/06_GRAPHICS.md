# Lagos Rush: Graphics Settings

Lagos Rush has to run on a cheap Android phone and still look good on a gaming PC. It does that with five presets, an Auto mode, dynamic resolution and a full set of individual settings. The design reasoning and edge cases are in `features/graphics-settings.md`; this page is the reference.

## Presets

| Setting | Potato | Low | Medium | High | Ultra |
|---|---|---|---|---|---|
| Render scale | 60% | 75% | 90% | 100% | 100% |
| Pixel ratio cap | 1 | 1 | 1.5 | 2 | 2.5 |
| Dynamic resolution | on | on | on | on | off |
| Target frame rate | 30 | 60 | 60 | 60 | 120 |
| Shadows | off | off | 1024 | 2048 | 4096 |
| Bloom | off | off | on | on | on |
| SMAA | off | off | off | on | on |
| Motion effects | off | off | on | on | on |
| Draw distance | 380 m | 520 m | 750 m | 1000 m | 1400 m |
| Building detail | low | medium | medium | high | high |
| Props density | 25% | 50% | 80% | 100% | 100% |
| Particles | 30% | 50% | 75% | 100% | 100% |
| Reflections | off | on | on | on | on |
| Anisotropic filtering | 1x | 2x | 4x | 8x | 16x |
| Crowds | off | off | on | on | on |

Building detail turns flat roof slabs into parapets and pitched corrugated roofs at medium. High adds shop awnings and wall AC units everywhere, and rooftop water tanks, dishes and solar panels on buildings near a route, where racers can see them.

## Auto

On first boot the game reads the GPU name, the device memory and the core count and makes a guess. Software renderers and WebGL 1 get Potato. Recent Apple GPUs, Adreno 7xx and newer Mali get Medium on phones; older mid range phone GPUs get Low. Desktop RTX and recent Radeon cards get Ultra. Then it times 24 frames of the real menu scene and steps the preset down one or two levels if frames are slow, or up one if there is plenty of room. The result and the timing are printed to the console.

Players can press Run benchmark in Settings at any time for a fresh suggestion, or pick Auto again to redo the guess.

## Dynamic resolution

While racing, the game keeps a smoothed frame time. Over budget by 12% and it drops the render scale by 5%; under budget by 22% and it climbs back by 2.5%, never above the scale the player chose and never below 50%. After each change it waits 45 frames before deciding again, so the image does not pump.

## Settings that rebuild the city

Shadows, building detail, props, crowds and draw distance change the geometry of the city. They apply when the player leaves the Settings screen (the screen says so), and the next race or menu uses the rebuilt city. Everything else applies immediately.

## Support

A link ending in `?gfx=potato`, `?gfx=low`, `?gfx=medium`, `?gfx=high` or `?gfx=ultra` forces that preset at boot. It is the quickest fix to suggest to a player whose game stutters.

## What we measured

On the menu view of the Terminal Circuit, the city costs about 120k triangles on Low and about 390k on High, after moving railway sleepers into a texture (they had cost 1.3 million triangles on their own) and limiting rooftop props to buildings near the route. Each car costs about ten draw calls after merging its body parts by material, down from about fifty. These counts come from a probe in headless Chromium; real phone frame rates still need measuring on hardware.
