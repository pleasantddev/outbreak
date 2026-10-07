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
| City reflections | off | off | on | on | on |
| Anisotropic filtering | 1x | 2x | 4x | 8x | 16x |
| Crowds | off | off | on | on | on |

Cars reflect the sky on every preset; a car covers few pixels and its paint looks like plastic without it. City reflections put the same sky on every wall and road, which cost half of a Low frame in our timing probe, so they start at Medium.

Building detail turns flat roof slabs into parapets and pitched corrugated roofs at medium. High adds shop awnings and wall AC units everywhere, and rooftop water tanks, dishes and solar panels on buildings near a route, where racers can see them.

## Auto

On first boot the game reads the GPU name, the device memory and the core count and makes a guess. Software renderers and WebGL 1 get Potato. Recent Apple GPUs, Adreno 7xx and newer Mali get Medium on phones; older mid range phone GPUs get Low. Desktop RTX and recent Radeon cards get Ultra. Then it times up to 24 frames of the real menu scene, for no more than about two and a half seconds, and steps the preset down one or two levels if frames are slow, straight to Potato if they take more than three times the budget, or up one if there is plenty of room. Each timed frame ends with a one pixel read back from the GPU. That matters: `gl.finish()` returns early in Chrome, and a benchmark built on it measures how fast the browser queues work rather than how fast the GPU draws it, which makes a slow phone look fast. The result and the timing are printed to the console.

Players can press Run benchmark in Settings at any time for a fresh suggestion, or pick Auto again to redo the guess.

## Dynamic resolution

While racing, the game keeps a smoothed frame time. Over budget by 12% and it drops the render scale by 5%; under budget by 22% and it climbs back by 2.5%, never above the scale the player chose and never below 50%. After each change it waits 45 frames before deciding again, so the image does not pump. A new scale is applied at the start of the next frame and drawn straight away; resizing a canvas wipes it, and doing that after a frame was drawn shows the player a blank frame.

## Settings that rebuild the city

Shadows, building detail, props, crowds and draw distance change the geometry of the city. They apply when the player leaves the Settings screen (the screen says so), and the next race or menu uses the rebuilt city. Everything else applies immediately.

## Support

A link ending in `?gfx=potato`, `?gfx=low`, `?gfx=medium`, `?gfx=high` or `?gfx=ultra` forces that preset at boot. It is the quickest fix to suggest to a player whose game stutters.

## What we measured

On the menu view of the Terminal Circuit, the city costs about 120k triangles on Low and about 390k on High, after moving railway sleepers into a texture (they had cost 1.3 million triangles on their own) and limiting rooftop props to buildings near the route. Each car costs about ten draw calls after merging its body parts by material, down from about fifty. These counts come from a probe in headless Chromium; real phone frame rates still need measuring on hardware.

Frame cost of the menu view with a forced GPU sync, in software rendering (SwiftShader on four CPU cores) at a 1280 by 720 window:

| Preset | Render size | Frame |
|---|---|---|
| Potato | 703 by 395 | 137 ms |
| Low | 896 by 503 | 315 ms (about 650 ms before city reflections moved to Medium) |
| Medium | 1088 by 612 | 1.3 s |
| High | 1216 by 684 | 1.8 s |

A software renderer is many times slower than any phone GPU, so only the ratios mean anything: each step up costs real work, and the gap from Potato to High is about thirteen times.
