# Map completeness audit

Checked the OSM extract the world is built from (`/home/claude/hlosm/data/corridor.osm.pbf`, 10,381 named things in it) against a list of famous Lagos places, then checked where each one lands in game metres (x east, z south, origin at Oshodi). Positions below are what OSM has, which is what the game draws.

## The big one: the map stops at Falomo

The playable map is bounded at lat 6.445 to 6.730 and lon 3.150 to 3.445 (game x -21,344 to 11,280, z -19,571 to 11,942). That cuts Lagos in two:

- Victoria Island is not on the map. Adeola Odeku, Akin Adesola, Ozumba Mbadiwe, Eko Hotel, Bar Beach, Eko Atlantic: all south of the cut.
- Lekki is not on the map. Lekki Phase 1, the Lekki Conservation Centre, the Lekki toll gate, Elegushi beach, Ajah: all east of the cut.
- Ikorodu town and the Ikorodu terminal are east of the cut too (the OSM file has them, at about x 15,800).
- The last thing on the south east corner is Falomo Bridge (9,322, 12,053) and Ikoyi. Banana Island is at x 12,512, just outside.

So "Lekki-Epe expressway near the toll" cannot be placed. The billboard and club work uses Ikoyi, the Falomo end and the east edge of the map as the stand-in, and says so in the `tag` and `place` fields.

Fix: widen `BBOX` in `pipe/extract.py` (lat_min 6.40, lon_max 3.50 adds Victoria Island, Bar Beach, Lekki Phase 1 and the toll) and re-run extract, bclass, parcels and pack. The OSM file already has the data. Size M for the pipeline, plus a look at pack size, stuck probes and the feeder map (power feeders are built from the same bounds). Not a cheap fix, so I did not do it blind. I recommend it as the next world task because the founder's list (Quilox, Lekki rooftop, VI lounge, Lekki toll, Detty December) lives in that strip.

## Present and good (has a real footprint or polygon)

| Place | Game position | Note |
| --- | --- | --- |
| Oshodi Transport Interchange, Terminals 1 to 3 | (890,-206) (860,-304) (1085,-406) | Now built as six-level terminals, see below |
| Oshodi footbridges over the expressway | (933..1027, -362..-187) | Deck heights fixed, see below |
| Murtala Muhammed Airport (airfield) | about (-3800,-2600) | Polygons are fine, the terminal node is wrong, see below |
| Ikeja City Mall, Computer Village, Ikeja Along, Allen Avenue | (1635,-6801) (-350,-4506) (-936,-5051) (1012,-5337) | All there |
| Third Mainland Bridge, Eko Bridge, Carter Bridge, Falomo Bridge | (5924,6414) (3435,8691) (4758,9781) (9308,12081) | Bridge decks present with elevation |
| Tafawa Balewa Square, Freedom Park, Tinubu Square, Jankara Market | (6325,11800) (5927,11530) (5134,10966) (5549,10171) | Polygons present |
| Holy Cross Cathedral, Cathedral Church of Christ, Lagos Central Mosque | (5914,11392) (5216,11293) (4997,10574) | Buildings present |
| Lagos National Stadium, Teslim Balogun Stadium | (2352,6141) (1949,5878) | Present |
| Yaba College of Technology, UNILAG, LUTH | (3441,3804) (6283,3637) (1368,3923) | Present |
| Mile 12 Market, Alaba International Market, Trade Fair Complex | (5607,-6199) (-16815,10001) (-9890,9259) | Present |
| Obalende motor park, Tafawa Balewa Square bus terminal, Oyingbo bus terminal | (7120,11429) (6404,11854) (4432,7978) | Present as bus station areas |
| Ojota, Ojodu Berger, Gbagada, Maryland, Ojuelegba, Jibowu, Anthony | various | Interchange and junction nodes present |
| Ikoyi Club, Falomo Shopping Mall, Ikoyi Road, Bourdillon Road | (9445,11134) (9424,11963) | Present, these are where ZILOX and GELE sit |
| Makoko (school, police post, taxi park) | (4852,5899) | Settlement is there as buildings, no floating-house look |

## Missing (nothing to draw)

| Place | What OSM has | Cheap fix? |
| --- | --- | --- |
| Balogun Market (Lagos Island) | Balogun Street only (4474..4843, 9982..10788), no market polygon | Needs a hand-placed market area, then a repack. Not cheap |
| Idumota, Oyingbo, Mushin, Oshodi, Tejuosho markets | Bus stops and street names only, no market polygons | Same |
| National Theatre building | Three rail station nodes and a relation, no building footprint | Needs a hand-built landmark. Coordinates in OSM look about 450 m off, so check before placing |
| Lagos City Hall | A multipolygon relation, no building drawn in the pack | Check the pack builder handles relation buildings |
| Onikan, Race Course | One health centre only | Skip |
| Victoria Island and Lekki items listed above | Outside the map | The bounds fix above |

## Wrong

| What | Problem |
| --- | --- |
| `Tarkwabay` node at (4547,11160) | Sits in the middle of Lagos Island. Tarkwa Bay is out in the harbour, about (5929,16800), off the map. Label only, harmless |
| `Murtala Muhammed Airport Terminal` node at (-1115,-3519) | About 1.5 km from the airfield polygons it belongs to. If a mission or fast travel uses it, point it at the airfield instead |
| Pedestrian bridges everywhere | The pack gave every bridge a 3 percent ramp, so a 100 m footbridge reached 1.9 m in the middle, under the height of a lorry. Fixed, see below |
| Terminals drawn as a 6.8 m flat roof on columns | Real ones are multi-storey. Fixed, see below |

## What I fixed

1. **Oshodi Transport Interchange** (`v2/src/world/oshodi.ts`): the three OSM terminals are now six-level buildings. Ground level is open bays with columns, painted bays and a union chairman's office at the west end of each. Floor 2 (6.4 m) is a glazed ticketing hall. Floors 3 to 6 (9.6, 12.8, 16.0 and the 19.2 m roof) are open parking decks with crash barriers, parked cars, `PARKING P3..P6` plates and stair cores on the roof.
2. **Pedestrian bridge heights** (`world/region.ts`, `footbridgeProfile`): footbridges now climb at about 10 degrees to 6 m clearance (12.8 m for layer-3 skywalks), computed from the way's own length, so tile seams do not matter. Covered roofs and posts go on the flat part of the Oshodi ones.
3. **Billboards** (`v2/src/data/billboards.json`, 88 faces, `pipe/billboards_gen.py`): sellable faces on the terminals, footbridges, Third Mainland, Eko Bridge, Ikorodu Road, Apapa-Oworonshoki, Allen Avenue, Ikeja, Marina to Ikoyi and rooftops on Lagos Island and Ikoyi.
4. **Clubs** (`v2/src/data/clubs.json`, `world/clubs.ts`): ZILOX Superclub and GELE Lounge as walk-in buildings on free lots, ORUN Rooftop as an open-air deck on a 21-level tower. Names are parodies.

## Next, in order of value

1. Widen the bounds to take in Victoria Island, Bar Beach, Lekki Phase 1 and the toll (M).
2. Hand-placed market areas for Balogun, Oshodi, Mushin, Oyingbo and Tejuosho through `pipe/sites.json` (S once the repack is running anyway).
3. National Theatre as a landmark building (S, after checking its real position).
4. Floating-house look for Makoko on stilts over the lagoon (M).
