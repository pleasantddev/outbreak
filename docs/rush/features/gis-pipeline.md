# Feature Dossier: GIS pipeline, OpenStreetMap to race city

**Project:** Lagos Rush  **Owner:** Pleasant  **Status:** built  **Date:** 2026-10-07

## 1. Summary
A developer tool that downloads the Oshodi area from OpenStreetMap, records where and when it came from, and turns it into a compact city file and a set of race routes. The raw map is never the final game: a race designer overlay widens, smooths, links and dresses real roads into loops that race well, and the client keeps buildings out of the race corridor. The output is a Derivative Database under the ODbL and ships with attribution.

## 2. Context
- Users and roles: the developer running `npm run gis`; players who see the result; OSM contributors who own the source data.
- Platforms: Node scripts at build time; the client only reads JSON.
- Stack and conventions: Overpass API, `tsx`, local metres with x east and z south from an origin at the interchange (6.5560 N, 3.3510 E).
- Scale expectations: one district of about 2.5 by 2.3 km; 6,654 buildings, 602 road pieces after clipping, three terminals, nine footbridges.
- Regulatory context: ODbL 1.0 for the data; copyright and trademark questions for landmarks are covered in `05_GIS_AND_RIGHTS.md`.
- Related features: renderer (world view, landmarks), race simulation (tracks), rooms (route ids).

## 3. Expanded scope
- Extract with a reproducible query and provenance record: v1
- Projection, road classification, widths, bridge layers and heights: v1
- Building footprints, categories, heights: v1
- Terminal footprints for hand modelled landmarks: v1
- Race designer overlay: routing between anchors, hand links, fillets, grade limits, widths, ramps, pickups, boost strips, grid, checkpoints, par times: v1
- Clipping to the play area and dropping the routing graph from the shipped file: v1
- Attribution in the game and a provenance file next to the data: v1
- Overture Maps as a second source for buildings: later (OSM coverage of Oshodi is good enough for v1)
- Automatic refresh and diff review of new OSM data: later

## 4. Sources
- SRC-01: OpenStreetMap copyright and licence page (openstreetmap.org/copyright) for attribution wording and the ODbL obligations.
- SRC-02: Open Database License 1.0 (opendatacommons.org/licenses/odbl/1-0/) for Derivative Database and share alike terms.
- SRC-03: Overpass API documentation (wiki.openstreetmap.org/wiki/Overpass_API) for the query language and `out geom`.
- SRC-04: OSM tagging for highways, bridges and layers (wiki.openstreetmap.org/wiki/Key:highway, Key:bridge, Key:layer) for classification and stacking.
- SRC-05: The user's addendum: "Do not use raw map data as the final game"; "recognizable Lagos, optimized for racing".

## 5. Assumptions
- AS-01: OSM footprints and road geometry around the interchange are accurate enough to be recognisable. Risk if wrong: locals notice wrong turns; mitigation is the designer overlay and a refresh before launch.
- AS-02: 6.5 m per bridge layer reads right for Lagos flyovers. Risk: decks too low or high; tunable constant.
- AS-03: Shipping the derived file under the ODbL is acceptable to the business. Risk: share alike applies to the derived database; it does not reach the game code or art.

## 6. System map
- Actors: developer, Overpass server, OSM contributors (as rights holders), players.
- Entry points: `npm run gis:fetch`, `npm run gis:build`.
- Data: raw extract (`data/osm/oshodi.raw.json`), provenance, `public/world/oshodi.json`, `tracks.json`, `PROVENANCE.json`.
- Trust boundaries: network fetch from Overpass; everything after it is local and deterministic.
- Side effects: files written under `data/` and `public/world/`.

## 7. Edge cases (minimum 10)
- EC-01 | Overpass times out or returns a partial result | integrations | 2×2 | handling: query has a timeout, the fetch fails loudly, the last good extract stays on disk | test: manual rerun; build refuses to run without a raw file
- EC-02 | OSM ways run far outside the play area (Agege Motor Road, the railway) | data | 3×2 | handling: roads and rails clipped to the box plus 150 m, keeping one point past the edge | test: build output reports 10.9 km of rail instead of 35.5 km
- EC-03 | Bridges stacked on several layers at the interchange | data | 3×3 | handling: 6.5 m per layer, heights densified every 6 m and eased at 6.5% down connected roads | test: sim.test.ts "the terminal circuit climbs onto the bridges and stacks over Agege Motor Road"
- EC-04 | Sparse OSM nodes make long gentle ramps that are not drivable | data | 3×2 | handling: segments over 8 m are densified before easing | test: sim.test.ts bridge test and visual check in the viewer
- EC-05 | A route crosses a building after widening | data, state | 3×2 | handling: client clearance pass nudges buildings out of the corridor or drops them (1 dropped, 2 nudged on the Terminal Circuit) | test: world view stats logged; visual check
- EC-06 | Real roads do not form a raceable loop | data | 3×3 | handling: hand authored links (U-turns, a motor park cut) are inserted by splitting graph edges | test: sim.test.ts "every track is a closed loop"
- EC-07 | Tight real corners and overlapping carriageways | data | 3×2 | handling: corner fillets, 2 m resampling, overlap resolution, width scaling | test: sim.test.ts full AI race on every forward track
- EC-08 | Buildings with tiny or broken footprints | data | 2×1 | handling: under 14 m² dropped, rings simplified, winding normalised | test: build stats and facade rendering check
- EC-09 | Missing height tags on most buildings | data | 3×1 | handling: heights from levels when tagged, otherwise from category, size and nearness to major roads | test: visual check of the skyline
- EC-10 | City file too large for mobile data | devices | 3×2 | handling: routing graph dropped from the shipped file, clipping, gzip on the server (1.07 MB to 236 KB) | test: curl measurement in QA notes
- EC-11 | Attribution missing somewhere the map is shown | compliance | 2×3 | handling: credit on the splash, the main menu footer and the Lagos map screen, plus PROVENANCE.json | test: playtest screenshots of all three screens
- EC-12 | A later OSM refresh changes road ids used by hand links | lifecycle | 2×2 | handling: links match by position and road id with a distance warning in the build output | test: build prints warnings (one link start 9.5 m from a road on the Grand Tour)

## 8. Requirements (minimum 10)
- RQ-01 [F] | The extract query, area, time and OSM base timestamp are recorded in provenance files | SRC-03
- RQ-02 [F] | The build is deterministic: the same raw file produces identical outputs apart from the generated timestamps | EC-12
- RQ-03 [F] | Every route is a closed loop at least 1 km long with a twelve car grid and checkpoints | EC-06
- RQ-04 [F] | Bridge decks sit at 6.5 m per layer and no drivable grade exceeds 8.5% on a route | EC-03, EC-04
- RQ-05 [NF] | The shipped city file is under 300 KB when compressed | EC-10
- RQ-06 [NF] | Attribution "© OpenStreetMap contributors" appears wherever map data is shown | EC-11
- RQ-07 [OP] | The derived database is shipped under the ODbL with its provenance | SRC-02
- RQ-08 [F] | No building stands inside a race corridor | EC-05
- RQ-09 [F] | The three terminal footprints are extracted for landmark modelling | none
- RQ-10 [NF] | The pipeline never ships raw OSM as the playable world; every route passes through the designer overlay | SRC-05
- RQ-11 [OP] | Build warnings name the route and the distance of any hand link that no longer meets a road | EC-12

## 9. Implementation pathways (minimum 10)
- PW-01 [main] | npm run gis: fetch, project, classify, build graph, heights, buildings, terminals, routes, clip, write files and provenance
- PW-02 [alternate] | Rebuild only: npm run gis:build from the cached raw extract after a design change
- PW-03 [alternate] | Add a route: write a TrackDef with anchors and links, rebuild, check warnings, race it in the viewer
- PW-04 [alternate] | Reverse variants generated from forward routes
- PW-05 [alternate] | Dev viewer: open ?dev= to fly the camera and screenshot views from a JSON list
- PW-06 [failure] | Overpass unreachable: fetch fails with the error, nothing is overwritten
- PW-07 [failure] | A hand link no longer meets a road after a refresh: build warns with route and distance
- PW-08 [failure] | Routing cannot connect two waypoints: build stops and names the route and the waypoints
- PW-09 [recovery] | Revert to the committed raw extract in git and rebuild
- PW-10 [recovery] | Adjust widths, fillet radius or avoid lists in the TrackDef and rebuild

## 10. Architecture approaches considered (minimum 2)
- Option A: Hand model the district in a 3D tool from reference photos. Full art control, but slow, hard to keep accurate, and photo references raise rights questions.
- Option B: Generate from OSM with a designer overlay. Accurate street layout, cheap to refresh, small files, and the overlay keeps it fun to race.
- Option C: Use a commercial map SDK with 3D tiles. Instant realism, but licence costs, heavy downloads and branding requirements.
- Decision and why: Option B. It is the only one that is accurate, light enough for mobile data and free of per player licence costs.

## 11. Design
- Data model: `WorldData` (meta, roads, buildings, areas, rails, footbridges, points, terminals) and `TrackData` (paths, widths, ramps, pickups, boosts, grid, checkpoints, traffic sections, intro camera, par).
- API contract: files only; schema types in `src/shared/world.ts` and `src/shared/track.ts`.
- UI states: the Lagos screen shows routes, terminals and bridges with attribution.
- Permission matrix: not applicable.
- Config: area box, projection origin, bridge height, grade, clip margin, route definitions.
- Rollback plan: outputs are committed; revert the commit.

## 12. Threat model and pre mortem
- Licence failure: shipping without attribution or share alike notice (covered by RQ-06, RQ-07).
- Accuracy failure: locals reject a route that does not match their roads (refresh and overlay).
- Size failure: a bigger area pushes the download past mobile budgets (clipping, chunking, gzip).

## 13. Test plan
`rush/tests/sim.test.ts` checks closed loops, grids, widths, the bridge stack at the interchange and full AI races on every forward route. Build output warnings are reviewed on every rebuild. Visual checks use the dev viewer and the playtest screenshots.

## 14. Observability
The build prints counts (roads, buildings, terminals, footbridges, rails, areas) and per route length, paths, ramps, pickup rows and warnings.

## 15. Deferred items and open questions
- Overture buildings as a cross check: later.
- Landmark rights clearance before commercial release: see `05_GIS_AND_RIGHTS.md`.

## 16. Definition of Done
- [x] Validator passes
- [x] All pathways walked
- [x] Edge cases handled or accepted
- [x] Tests pass
- [x] Observability in place (build output)
- [x] Docs written
