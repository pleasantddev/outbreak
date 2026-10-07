# Lagos Rush: QA Status

What was tested, how, what broke, and what nobody has tested yet. Status words: TESTED means an automated test or a scripted playtest exercised it and it passed; PARTIALLY TESTED means some of it was exercised; NOT TESTED means exactly that.

All browser testing so far ran in headless Chromium with SwiftShader software rendering inside a container. That proves the code paths and the pictures, not the frame rate on a real phone.

## Automated tests

`npm test` runs 33 tests in three files, all passing on 7 October 2026.

| File | Tests | Covers |
|---|---|---|
| `tests/sim.test.ts` | 15 | Every route is a closed loop with a grid and sane widths; the Terminal Circuit climbs onto the stacked bridges; a full AI race finishes on every forward route; determinism for a seed; lap counting; launch timing; item odds and repeatable rolls; traffic as a pure function of seed and time; items handed out and used; race end rules (AI winner clock online, hard cap, offline waits for the player, followers never end a race) |
| `tests/protocol.test.ts` | 5 | Packed state round trip within a centimetre; malformed state arrays rejected; snapshot cars and hazards round trip; room codes typed loosely; room settings clamped |
| `tests/server.test.ts` | 13 | Real WebSockets against a real server: old client refused; private room with a LAGOS code; join by digits; unknown code; host only settings; full room; a whole race (start, relay, impossible moves ignored, results, points, series reset); AI stand in and hand back; dropped seat kept and restored by token; host migration; names stripped of markup; a late joiner watches, then races the next one; kick; chat rate limit; quick match with AI fill; health |

## Scripted browser playtests

`tools/playtest.mjs` drives the real UI with the keyboard and mouse. Its bot only presses keys: it steers toward the road ahead, lifts for tight corners, burns Fuel on straights, fires items and calls the tow truck when stuck.

| Flow | Result |
|---|---|
| Solo: splash, onboarding, main menu, garage, paint tab, Lagos map, career, settings, quick race setup, intro, grid, countdown, race | TESTED on Potato and High |
| Solo: results, rewards, replay with TV, chase and helicopter cameras, back to results | See the latest run below |
| Online: two browsers, create room, invite link joins the second player straight into the lobby, ready, start, race with three AI, server results with points, back to the room | TESTED on Potato at 640 by 360 |
| Gallery: aerials of the interchange at noon, dusk and night, Terminal 3 and the bridges, Terminals 1 and 2, the skywalk over the grid, the giant boards, fliers on barriers, the crowd | TESTED on High |

## Probes and measurements

| Probe | What it showed |
|---|---|
| Triangle and draw call probe | City on Low dropped from 1.43M to about 120k triangles after the sleeper and rooftop fixes; High from 1.9M to about 390k. Cars went from about 50 draw calls each to about 10 |
| Bandwidth meter | 4.7 KB/s per player on the wire in a twelve car room (14 KB/s before socket compression) |
| Download size | City data 1.07 MB raw, 236 KB gzipped from our server; the whole client about 0.9 MB compressed |
| NaN probe | Found and fixed NaN pixels from zero length normals that blacked out whole frames under bloom; zero NaN pixels in all test views afterwards |

## Bugs found by testing and fixed

| Found by | Bug | Fix |
|---|---|---|
| Online playtest | The multiplayer screen recursed until the stack overflowed when the server was unreachable | Screens no longer bypass the reconnect backoff; network notices are deferred |
| Online playtest | Network updates re-rendered a screen that subscribed again inside the same loop, hanging the page | Listeners are iterated from a snapshot; replaced screens unsubscribe themselves |
| Online playtest | On a slow device the client kept snapping its own car back to the server's last copy | Short gaps are skipped; only long gaps (when an AI stand in drove) resync |
| Online playtest | A human who never finished kept the room waiting forever | 90 s clock after an AI wins, 25 s after the first human, hard cap at three times par |
| Online playtest | The callout subtitle stayed on screen for the whole race | Cleared with the callout |
| Online playtest | Results screens overflowed on a 640 px wide phone | Columns stack and scroll on small screens |
| Gallery | Whole frames went black or white under bloom | Degenerate faces no longer produce zero normals; a scrub pass runs before bloom |
| Gallery | A regular billboard hid half of the giant ADVERTISE WITH US board | Giant boards claim their spots first |
| Gallery | Board headline wider than the board | Text shrinks to fit; fonts load before any canvas is drawn |
| Gallery | Fliers sank into barriers on banked corners | Heights taken at the barrier |
| Solo playtest | The start banner read backwards from behind | Two single sided planes |
| Solo playtest | Garage and menu cameras missed the car or sat inside walls | A dedicated garage workshop and track relative hero shots |
| Solo playtest | A tap of the item key shorter than one frame was lost at low frame rates | Taps are latched until the next read |
| Solo playtest | The chase camera could end up behind a barrier with the car hidden | The camera is pulled in along the line to the car |
| Probe | Railway sleepers alone cost 1.3M triangles | Painted into the ballast texture; rails clipped to the map |
| Solo playtest | Skid marks on a bridge deck showed through the deck as grey flecks when racing underneath | Decal depth offsets cut to what the race surface needs |
| Gallery | The street light pools drew as pale discs through other surfaces from high up | Same decal offset fix |

## Status by area

| Area | Status | Notes |
|---|---|---|
| Race simulation | TESTED | Unit tests and many headless races |
| Car handling feel | PARTIALLY TESTED | Bot driving only; needs human players |
| AI rivals | TESTED | Full races on every route at all levels in tests |
| Items and hazards | TESTED | Odds, use and hits in tests; visuals seen in playtests |
| Traffic | TESTED | Determinism test; visible in every race screenshot |
| Rooms and server | TESTED | Integration tests and the two player playtest |
| Reconnect mid race in a browser | PARTIALLY TESTED | Server side tested; the browser resync path ran only through code review and the long gap logic |
| Renderer and presets | PARTIALLY TESTED | Potato and High in software rendering; Low, Medium and Ultra only through the probe |
| Garage customisation | PARTIALLY TESTED | Screens and preview seen; buying every item not scripted |
| Career | PARTIALLY TESTED | Screen seen; a full cup not played through |
| Replay | PARTIALLY TESTED | Cars, traffic, effects and item hazards are replayed; camera modes checked in the playtest |
| Audio and music | NOT TESTED | Synthesis code runs, but headless tests cannot listen; needs ears on real speakers |
| Gamepad | NOT TESTED | Mapped, not exercised |
| Touch controls on a device | NOT TESTED | Layout exists; needs a phone |
| Real phones and GPUs | NOT TESTED | First job for the next milestone: two Android phones (one around Mali G52 or Adreno 610 class, one recent) and an iPhone |
| Long sessions and memory | NOT TESTED | Rebuilding scenery many times in one session should be watched |
| Server under load | NOT TESTED | Dozens of rooms expected per process; not measured |
| Bad networks | NOT TESTED | Latency, jitter and packet loss on Nigerian mobile networks |

## Known issues and limits

* Frame rates are unknown on real hardware; the software renderer ran at 10 to 13 fps, which says nothing about phones with GPUs.
* There are no accounts: profiles live in the browser, friends are local, and leaderboards show this device's records only.
* Restarting the server ends live rooms; clients notice within a few seconds and leave cleanly.
* Distant views at noon are hazy and at dusk the street light pools show as pale discs from very high up.
* Rights work before a commercial launch: the landmark question under the Copyright Act 2022, a lawyer's view on the campaign fliers, and a trademark registry search for the invented brands (see `05_GIS_AND_RIGHTS.md`).
