# Level Design: Oshodi

## Size, derived

Travel distance equals speed multiplied by travel time.

* A sprinting survivor at 6.8 m/s should cross the district in roughly 100 seconds, so the playable square is about 680 m. We use 720 m to leave room for the lagoon edge.
* An okada at 30 m/s crosses it in 24 seconds, fast enough to rotate between Heart sites and extractions inside the two minute warning.
* The Heart sites sit 75 to 110 m apart in the middle of the map, so every landing spot is within 300 m of at least one.
* The extraction points are 300 to 400 m from the Heart sites and spread to three edges, which forces a real chase.

## Layout

| Cell | Content | Combat character |
|---|---|---|
| North strip | Airport Road: apron, three hangars, fence line, helipad extraction | Long sight lines, vehicle play |
| West columns | Mainland Estates: two to four storey blocks, the drainage canal, mechanic yard | Room to room, canal flanks |
| Centre west, south of the flyover | Oshodi Terminal: canopy, bus bays, waiting hall | Pillar cover, Heart site |
| Centre, north of the flyover | Ile Epo Market: stall grid, narrow alleys, fire barrels | Close quarters, Heart site |
| East to west through the centre | The Flyover: 7.5 m deck, ramps at both ends, under bridge stalls | Elevated sniping, vehicle chases, Heart site |
| Centre east | Central Oshodi: tallest blocks, five storeys | Rooftop fights |
| South east | Apapa Port: stacked containers, cranes, warehouse | Maze of cover, port extraction |
| East edge | Lagoon Edge: stilt shacks, canoes, walkways, the jetty | Water, swim escapes, jetty extraction |

## Roads

Five north to south roads and five east to west roads on a roughly 120 m grid, 14 m wide with 3.2 m raised sidewalks. One east to west road becomes the flyover between x of minus 262 and 96. The canal runs north to south at x of minus 200 and is bridged at every road.

## Buildings

Each block places shophouses and residential blocks along its road facing edges, with alleys of 2 to 6 m between them, and leaves the courtyard for clutter, wrecks, palms and water tanks.

| Rule | Value |
|---|---|
| Module | 4 m |
| Width | 12 to 24 m |
| Depth | 12 to 16 m |
| Storeys | 2 to 5 (central blocks are tallest; lagoon blocks are low) |
| Storey height | 3.4 m |
| Ground floor | Shop door on the street, a sign above it, a rusted shutter on some secondary doors |
| Windows | 62 percent of upper modules, 35 percent on the ground floor; 13 percent glow with generator or candle light |
| Stairwell | Back left corner, switchback, open to every floor and the roof |
| Rooms | Front room and back room per floor with a doorway between |
| Loot | One spawn per room per floor; tiers rise with height |

## Navigation

A waypoint graph of about 5,400 nodes: road centrelines every 24 m, sidewalk projections in front of every door, room nodes, stair lane nodes, landings and roofs, open nodes across the market, terminal and port, and a separate chain along the flyover deck. Tests require more than 95 percent of roofs and doors to be reachable from the street.

## Loot heat

* Ground floors and streets: common.
* Upper floors and the market: mostly rare.
* Fourth floor and above, rooftops: epic, plus both Awakening Artifacts.
* Port containers and warehouse: rare and epic.

## Extraction points

| Point | Location | Feel |
|---|---|---|
| Airport Road Helipad | North, open apron | Exposed, easy to see coming |
| Apapa Port Quay | South east, between containers | Ambush heaven |
| Lagoon Jetty | East, at the end of a plank pier | One way in, unless you swim |
