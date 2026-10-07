# Lagos Rush: Map Data, Licensing and Rights

This is the record of where the city came from, what we owe the people who mapped it, and which rights questions are still open before a commercial release. Nothing here is legal advice. Where a question needs a Nigerian lawyer, it says so.

## The map data

**Source.** OpenStreetMap, fetched through the Overpass API on 7 October 2026 (OSM base timestamp 18:22 UTC). The query and the box (6.5455 to 6.5665 N, 3.3395 to 3.3625 E) are stored word for word in `rush/data/osm/provenance.json` and `rush/public/world/PROVENANCE.json`. The raw extract is committed at `rush/data/osm/oshodi.raw.json`, so every build can be reproduced.

**Processing.** `rush/tools/gis/build-world.ts` projects coordinates to local metres around the interchange, classifies roads, builds a road graph from shared nodes, lifts bridges to 6.5 m per layer and eases their approaches, simplifies building footprints, extracts the three terminal footprints, clips everything to the play area plus 150 m, and routes the race tracks through the designer overlay. The game never ships the raw map as the playable world: routes are widened, smoothed, linked and dressed for racing, and buildings that would block a route are moved or dropped.

**Licence.** OpenStreetMap data is © OpenStreetMap contributors under the Open Database License 1.0. Our `public/world/oshodi.json` and `tracks.json` are Derivative Databases, so:

| Obligation | How we meet it |
|---|---|
| Attribute | "Map data © OpenStreetMap contributors" on the splash screen, in the main menu footer with a link to openstreetmap.org/copyright, and on the Lagos map screen |
| Keep the database open | The derived files ship in the clear next to the game and are offered under the ODbL; the provenance file says so |
| Share alike | Applies to the derived database only. Game code, art, audio and design are separate works and stay ours |
| Keep notices | `PROVENANCE.json` travels with the data |

The rendered city on screen is a Produced Work under the ODbL; attribution covers it.

## The terminals and bridges

The user asked to see the real Oshodi Transport Interchange: its three terminals and the bridges and skywalks that connect them. They are in the game, built this way:

* Footprints and positions come from OpenStreetMap (ways 693552184, 693552185 and 693552186).
* The 3D forms are our own simplified models, generated in code: glass and louvred decks, steel arches, cable stayed skywalks on lattice pylons. No photograph, texture or drawing from the architects or the operator is used.
* The terminals carry generic labels (Terminal 1, 2 and 3) and no operator logo or trademark.
* Reference photos used while modelling were Creative Commons images kept outside the repository and never shipped.

**Open question for counsel before a commercial launch.** Nigeria's Copyright Act 2022 treats works of architecture as artistic works. Its panorama style exception in section 20(1)(e) appears to cover including a publicly sited artistic work in an audiovisual work or broadcast, and commentators disagree on how far it reaches beyond that. Whether a video game counts as an audiovisual work for that purpose is not settled in anything we found. Before release:

1. Ask a Nigerian IP lawyer whether section 20(1)(e) covers simplified 3D models of the interchange in a commercial game.
2. If it does not, seek permission from the rights holders: the architects of the interchange and the Lagos State Government, which commissioned it.
3. Keep a fallback ready: a "fictionalised interchange" variant that keeps the road layout (which comes from OSM) and swaps the terminal shells for original designs. The landmark code is isolated in `rush/src/render/landmarks.ts`, so the swap is contained.

Sources: the Act as published by the Nigerian Copyright Commission ([copyright.gov.ng](https://www.copyright.gov.ng/CopyrightAct/CopyrightAct2023FinalPublication1.pdf)); [Free Knowledge Africa on the 2022 Act](https://freeknowledgeafrica.org/navigating-the-new-nigerian-copyright-act-of-2022/) and [on freedom of panorama](https://freeknowledgeafrica.org/restoring-freedom-of-panorama-in-nigerias-copyright-act-a-call-for-balance/); [The IP Press on the Lekki Ikoyi bridge](https://www.theippress.com/?p=6887); [Mondaq on architectural works in Nigerian IP law](https://webiis08.mondaq.com/nigeria/trademark/1708348/architectural-works-and-intellectual-property-laws-in-nigeria).

## Campaign fliers

The user asked for Peter Obi fliers scattered across the map, as they are on real Lagos streets. They are in, with limits that keep the risk low:

* Name and a generic call to vote only: "VOTE PETER OBI FOR PRESIDENT". No photograph or likeness, no party logo, no slogan of any campaign.
* Three plain designs in green and white, fly posted on barriers and poles among other local notices (a crusade, an owambe, a tailoring school, a room to let).
* A setting turns them off (Settings > Gameplay), and the city rebuilds without them.

Political content in a game can raise questions of endorsement, publicity rights and election rules, and it can put off some players. Before release, a lawyer should confirm this treatment is acceptable, and the default (on, as requested) should be a deliberate business decision.

## Brands on billboards

Every brand on every billboard is invented: Jollof Royale, Zobo Fizz, Ekolink 5G, GidiPay, Suya Kings, Danfo Dash, Afrogroove 99.1, Naija Shield, Owambe Lace, Mama Nkechi Noodles, Coral Bay Homes, Sunrise Malt, plus the house "ADVERTISE WITH US" board and our own Lagos Rush posters. On 7 October 2026 we searched the web for each of the more product like names; none matched an established Nigerian brand. "Jollof Royale" appeared as a dish on a single Ghanaian ordering page, which we judged low risk. A search of the Nigerian Trademarks Registry should be done before release, and any name that turns out to be registered gets swapped in `rush/src/render/signage.ts`.

The "ADVERTISE WITH US" board is driven by `rush/public/ads/slots.json`, so real advertisers can later be placed without touching code. Any real brand placed there must come with a signed agreement.

## Cars

Eight original cars from invented makers (Oba Motors, Ajala Works, Eko Coachworks, Lekki Iron, Lagoon Automobili). Bodies are lofted in code from our own profiles; no real grille, badge, light signature or silhouette was traced. Plates read "EKO . CITY OF HUSTLE", which is not a real Lagos State plate design.

## Names and language

Gbedu, Fuel, Ghana Must Go bags, NEPA Blackout, Danfo Mode, Okada Swarm, Agbero Horn and Pure Water are everyday Lagos words used descriptively, not anyone's marks. No term was taken from another racing game.
