# Feature Dossier: Graphics settings

**Project:** Lagos Rush  **Owner:** Pleasant  **Status:** built  **Date:** 2026-10-07

## 1. Summary
Five presets from Potato to Ultra, an Auto mode that picks one from the GPU and a short benchmark, dynamic resolution that holds the frame rate on busy laps, and every individual setting exposed for players who want to tune. The goal is a smooth race on the cheap Android phones many Nigerian players own, without holding back a good PC.

## 2. Context
- Users and roles: every player; support staff who can say "try ?gfx=low".
- Platforms: WebGL 2 browsers on Android, iOS, Windows, macOS, Linux; WebGL 1 falls back to Potato.
- Stack and conventions: three.js r180 with postprocessing; settings live in the profile in local storage.
- Scale expectations: phones from about 2 GB of memory and Mali G52 or Adreno 6xx class GPUs up to desktop RTX cards.
- Regulatory context: none.
- Related features: renderer, world view chunking, car models, effects, menu scenes.

## 3. Expanded scope
- Presets and Auto with a first run benchmark: v1
- Dynamic resolution with a cool down: v1
- Per setting controls (render scale, pixel ratio cap, target fps, shadows, bloom, SMAA, motion effects, draw distance, building detail, props, particles, reflections, anisotropy, crowd): v1
- Performance overlay (fps, ms, draw calls, triangles, resolution, preset): v1
- Settings that need the city rebuilt applied on leaving the screen: v1
- URL override ?gfx=: v1
- Thermal throttling detection on phones: later
- Per device presets from telemetry: later (needs analytics and consent)

## 4. Sources
- SRC-01: three.js documentation for `WebGLRenderer.info`, pixel ratio and shadow map types (threejs.org/docs).
- SRC-02: WEBGL_debug_renderer_info extension notes (developer.mozilla.org) for reading the GPU name, and its absence on some browsers.
- SRC-03: Measured triangle and draw call counts from the in browser probe during development (city on Low about 120k triangles, High about 390k; cars about 10 draw calls each after merging).
- SRC-04: The user's request: "make it so that the user can adjust their game graphics settings to ensure the game runs smooth on all devices".

## 5. Assumptions
- AS-01: GPU name patterns are a fair first guess. Risk: wrong tier on unknown GPUs; the benchmark corrects by one or two steps.
- AS-02: A 24 frame benchmark of the real menu scene predicts race cost. Risk: races are heavier; dynamic resolution covers the gap.
- AS-03: Players accept a softer image over dropped frames. Risk: some prefer sharpness; dynamic resolution can be switched off.

## 6. System map
- Actors: player, the Auto detector, the dynamic resolution controller.
- Entry points: first boot, Settings > Graphics, the ?gfx= parameter, the benchmark button.
- Data: `GraphicsSettings` in the profile; `deviceChecked` flag.
- Trust boundaries: none beyond local storage.
- Side effects: renderer resize, post effect toggles, city rebuild for detail settings.

## 7. Edge cases (minimum 10)
- EC-01 | No WebGL at all | devices | 2×3 | handling: the splash says the 3D engine could not start instead of showing a blank canvas | test: manual with WebGL disabled
- EC-02 | Software rendering (SwiftShader, llvmpipe) | devices | 2×2 | handling: Auto picks Potato | test: playtest under SwiftShader shows potato preset chosen
- EC-03 | GPU name hidden by the browser | devices | 3×2 | handling: guess from memory and cores, then the benchmark adjusts | test: manual on Firefox with resist fingerprinting
- EC-04 | Benchmark runs while the tab is hidden | lifecycle | 1×2 | handling: refinement only steps one or two presets and the player can rerun it from Settings | test: ACCEPTED, rerun available
- EC-05 | Frame rate drops on a busy lap with twelve cars and rain | performance | 3×2 | handling: dynamic resolution lowers scale in 5% steps with a 45 frame cool down, raises it in 2.5% steps | test: perf overlay check in playtests
- EC-06 | Phone with a very high pixel ratio (3x) | devices | 3×2 | handling: pixel ratio cap per preset (1 on Potato and Low) | test: emulated 3x viewport check
- EC-07 | Player raises building detail on a weak phone | devices | 2×2 | handling: change applies on leaving Settings with a rebuild; Auto can be restored any time | test: settings round trip in the triangle probe
- EC-08 | Settings changed during a race | state | 2×1 | handling: renderer settings apply live; city rebuild waits for the next race or menu | test: manual
- EC-09 | Rail sleepers or roof props explode the triangle count | performance | 3×3 | handling: sleepers drawn into the ballast texture, roof props only near the route, fewer segments | test: triangle probe before and after (1.4M to 120k on Low)
- EC-10 | Corrupt or old settings in storage | data | 2×1 | handling: profile loader fills missing fields with defaults | test: manual with an old profile
- EC-11 | Reduce motion is on | accessibility | 2×1 | handling: motion effects forced off with it | test: manual toggle check
- EC-12 | Many draw calls from detailed cars | performance | 3×2 | handling: body parts merged per material, brake discs and calipers only on the hero car | test: triangle probe counts draw calls per car

## 8. Requirements (minimum 10)
- RQ-01 [F] | First boot picks a preset from the GPU, then a 24 frame benchmark moves it up or down at most two steps | EC-02, EC-03
- RQ-02 [F] | Players can choose Auto or any of five presets, and change any setting individually | SRC-04
- RQ-03 [NF] | On Low, the city in the menu view stays under 150k triangles | EC-09
- RQ-04 [NF] | A car costs about ten draw calls | EC-12
- RQ-05 [F] | Dynamic resolution never renders above the player's chosen render scale | EC-05
- RQ-06 [F] | Settings that need a rebuild say so and apply on leaving the screen | EC-07
- RQ-07 [F] | A performance overlay shows fps, frame time, draw calls, triangles, resolution and preset | none
- RQ-08 [F] | ?gfx= with a preset name forces that preset at boot | none
- RQ-09 [NF] | Potato keeps every gameplay element visible: traffic, items, hazards, the HUD | none
- RQ-10 [OP] | The chosen preset and benchmark time are logged to the console on first boot | none
- RQ-11 [NF] | Changing a setting never requires a page reload | EC-08

## 9. Implementation pathways (minimum 10)
- PW-01 [main] | First boot: detect device, guess preset, load the city, benchmark the menu scene, step the preset, save
- PW-02 [alternate] | Player picks a preset in Settings: renderer applies live, detail changes rebuild on leaving
- PW-03 [alternate] | Player tunes one setting: preset becomes Custom
- PW-04 [alternate] | Player runs the benchmark from Settings and gets a suggestion
- PW-05 [alternate] | Support link with ?gfx=low forces a preset
- PW-06 [alternate] | Player switches back to Auto: guess again from the device
- PW-07 [failure] | No WebGL: message on the splash
- PW-08 [failure] | Frame time over budget in a race: dynamic resolution lowers scale
- PW-09 [recovery] | Frame time back under budget: scale climbs back to the chosen maximum
- PW-10 [recovery] | Player picked too high a preset and the game stutters: open Settings, choose Auto or a lower preset, carry on without reloading

## 10. Architecture approaches considered (minimum 2)
- Option A: One fixed quality with a single resolution slider. Simple, but a phone and a PC can never both be happy.
- Option B: Presets plus Auto plus dynamic resolution, with every setting exposed. More code, but it fits every device and lets players fix their own problems.
- Decision and why: Option B. The audience spans a very wide range of hardware and the request asks for exactly this control.

## 11. Design
- Data model: `GraphicsSettings` with fifteen fields, `PRESETS` table in `src/render/quality.ts`.
- API contract: not applicable.
- UI states: Auto selected, preset selected, Custom, benchmark running, rebuild pending.
- Permission matrix: not applicable.
- Config: presets table; `?gfx=`.
- Rollback plan: Auto is always one tap away.

## 12. Threat model and pre mortem
- Pre mortem: players on cheap phones uninstall after a stuttering first race (Auto plus dynamic resolution); an unknown GPU gets Ultra (benchmark steps it down); a later art change silently doubles the triangle count (the probe in the QA plan catches it).

## 13. Test plan
The triangle probe (Playwright) measures each preset's city and car cost; playtests run on Potato and High; the overlay is checked in every playtest. Real device tests on two Android phones are planned for the next milestone.

## 14. Observability
Console line with the benchmark result and chosen preset; the in game performance overlay.

## 15. Deferred items and open questions
- Thermal throttling handling on phones: later.
- Telemetry based presets: later, with consent.
- Real device numbers: next milestone.

## 16. Definition of Done
- [x] Validator passes
- [x] All pathways walked
- [x] Edge cases handled or accepted
- [x] Tests pass (probe and playtests)
- [x] Observability in place
- [x] Docs written
