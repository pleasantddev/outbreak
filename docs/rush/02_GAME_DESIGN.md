# Lagos Rush: Game Design

Lagos Rush is an arcade street racer set on the real road network around the Oshodi Transport Interchange. Races are short and loud. Up to twelve cars share a room, the three terminals and their bridges are the stadium, and every mechanic carries some Lagos in it. Version 1 has no real money anywhere: Naira in the game is play money earned by racing.

The principles we took from accessible kart racers, street racers and stunt racers are in `01_DESIGN_PRINCIPLES.md`. This document covers what we built on top of them.

## Thesis

**Fantasy.** You are the quickest driver in Oshodi. You slide a green Tokunbo under the skywalk, thread a danfo and two kekes on the bridge, and your crew watches you take the lead on the last lap.

**Promise.** Three minutes of close, readable racing on streets a Lagos player recognises at a glance.

**What sets it apart.** The venue is real. The roads come from OpenStreetMap and the terminals are modelled from their footprints, so a player from Oshodi can point at the screen and say where they are. The second difference is the room: you race your own people, by code or invite link, and nobody can buy a result.

**Pillars.** Each pillar earns its place by changing a system and cutting something.

| Pillar | System it shapes | What it cut from v1 |
|---|---|---|
| Recognisable Lagos, tuned for racing | The GIS pipeline and the race designer overlay that widens, smooths and dresses real roads | Free roam across the whole city |
| Anyone can race, skill still shows | Soft walls, the tow truck, steering assist, drift tiers you can read | Damage that ends a race |
| A decision every few seconds | Traffic, Ghana Must Go bags, Fuel, ramps, BRT boost strips | Empty straights; the designer fills them |
| Your crew, your room | Rooms, codes, invites, quick chat, series points | Free text chat and a global ranked ladder |
| Runs on the phone you already own | Graphics presets, dynamic resolution, procedural art | Photographic textures and big downloads |

**The question the first build had to answer:** is a three lap race around the terminals, with traffic and items, fun enough to want the rematch? The playtests in `09_QA_STATUS.md` say the loop runs end to end; whether it is fun is a question for real players on real phones, and the next milestone puts it in front of them.

## Loops

* **Moment:** brake into a bend, hold drift, watch the sparks go yellow, orange, pink, release for the boost, clip a keke for a near miss, top up Fuel, burn it past a rival.
* **Race:** grid, countdown with a launch window, one to six laps, finish, results with rewards.
* **Session:** one room. Lobby, race, results, the room reopens. A series runs one, three or five races with points per place.
* **Long term:** Naira and XP from every race buy cars, paint, finishes, wraps, rims, underglow and plates. Career cups and lap records give a reason to go back to old routes.

## Routes

Every route runs on real Oshodi roads. The overlay adds width, kerbs, barriers, ramps, pickups and boost strips, and links a few roads with U-turns or a motor park cut so each route closes into a loop.

| Route | Length | Laps | What it is |
|---|---|---|---|
| Terminal Circuit | 1.44 km | 4 | Under the skywalk, round Terminal 1, over both expressway bridges and back past Terminal 2 |
| Oshodi Loop | 2.56 km | 3 | Oshodi Road, Church Street and Oyetayo, then flat out down Agege Motor Road into the interchange |
| Expressway Run | 1.91 km | 3 | Both carriageways of the Apapa Oworonshoki Expressway with a U-turn at each end |
| Oshodi Grand Tour | 3.82 km | 2 | The neighbourhood loop and the whole interchange in one lap |
| Terminal, Oshodi and Expressway Reverse | as above | as above | The same roads the other way round |

Par times come from a simple point mass driven round each route at up to 209 km/h with arcade grip. Gold is a real target for the sport cars and a stretch in the starter car.

## Cars

Eight original cars from five invented makers. None of them copies a real model, badge or grille.

| Car | Maker | Class | Top speed | Unlocks |
|---|---|---|---|---|
| Tokunbo 1.8 | Oba Motors | Street | 187 km/h | Start |
| Keke Turbo | Ajala Works | Street | 158 km/h | Level 2, ₦15,000 |
| Danfo GT | Eko Coachworks | Heavy | 180 km/h | Level 3, ₦25,000 |
| Eko Spirit RS | Oba Motors | Sport | 216 km/h | Level 4, ₦40,000 |
| Ajah V8 | Lekki Iron | Sport | 238 km/h | Level 6, ₦60,000 |
| Wahala Cruiser | Lekki Iron | Heavy | 220 km/h | Level 7, ₦75,000 |
| Third Mainland R | Lagoon Automobili | Super | 274 km/h | Level 9, ₦140,000 |
| Banana Island Phantom | Lagoon Automobili | Super | 281 km/h | Level 11, ₦180,000 |

Heavy cars win contact, light cars win corners, and the Keke corners like it runs on rails. New players start in a green Tokunbo with white stripes and a Lagos plate.

## Driving

The model is arcade on purpose. Grip is high, slides are recoverable and walls push you back onto the road.

* **Gbedu.** Hold drift into a bend to charge three tiers of sparks. Releasing pays a boost scaled to the tier. A tier one or higher drift also dodges a Gala Rocket.
* **Fuel.** A nitro meter filled by drifting, near misses, airtime, slipstream and shunts. In Street Race it is the only boost.
* **Launch.** Throttle in the last 0.6 seconds before GO gives a perfect start, up to 1.4 seconds gives a good one, and anything earlier bogs the car down.
* **Slipstream and BRT lanes.** Sitting behind a car tops up Fuel; the red BRT lanes carry boost strips on race day.
* **Ramps and tricks.** In the air, steer to spin and push forward or back to flip. A clean landing pays out; a crash landing costs a moment.
* **Tow truck.** Off a bridge or wedged against a wall, press R and the tow truck lifts you back onto the road. Stay off the road for a few seconds and it comes on its own. Nothing ends your race.

## Ghana Must Go bags

Driving through a floating bag grants an item, weighted by position so leaders get defence and the back of the pack gets comebacks. Pure Water, Pothole, Agbero Horn, Gala Rocket, Gen Boost, NEPA Blackout, Danfo Mode and Okada Swarm are described in `01_DESIGN_PRINCIPLES.md`. Online, the room server rolls every item and judges every hit; clients only ask to use what they hold.

## Modes

| Mode | Rules |
|---|---|
| Rush Race | Items, traffic and Fuel. The default. |
| Street Race | No items. Traffic, Fuel and shunts decide it. |
| Stunt Run | Two minutes of airtime, tricks, drifts and near misses for points. |
| Time Trial | Solo against the clock and your best lap. Not offered in rooms. |

## Rivals

AI drivers have names, crews and temperaments: some drift, some lean on you, some hold a lane. Four levels set pace, drift use, item use and how often they make mistakes.

| Level | Pace | Drifting | Mistakes |
|---|---|---|---|
| Learner | 84% | none | often |
| Driver | 92% | some | now and then |
| Racer | 97.5% | most bends | rarely |
| Lagos Legend | 100% | every bend that pays | almost never |

Catch up is mild and visible. An AI more than 120 m ahead of the nearest human drops to 95.5% of its pace, one more than 120 m behind gets 3.5% extra, and the back of the pack gets better items. Nothing ever changes a human player's physics.

## Economy

Naira is play money. You earn it from finishing position, scaled by route length and field size, with bonuses for drift time, clean tricks, near misses, shunts, item hits, a new lap record and an online race. There is no paid currency, no loot box and no way to turn Naira into anything outside the game.

| Spend | Price |
|---|---|
| Paint colour | ₦800 |
| Finish | gloss free, metallic ₦600, matte ₦1,200, pearl ₦2,500, chrome ₦6,000 |
| Plate | ₦500 |
| Rims | ₦1,800 |
| Wrap | ₦2,500 |
| Underglow | ₦3,000 |

XP levels unlock cars and cups. The curve is in `src/shared/economy.ts`; every tuning number lives in data, not in screen code.

## Career

Four cups, unlocked by level, each a short series against AI with points per race and a cash prize.

| Cup | Unlock | Rivals | Races |
|---|---|---|---|
| Oshodi Rookie Cup | Level 1 | Learner | Oshodi Loop, Terminal Circuit, Expressway Run |
| Interchange Cup | Level 3 | Driver | Every route in reverse |
| Expressway Masters | Level 6 | Racer, rush hour traffic | Expressway, Grand Tour, Terminal |
| Lagos Legend Cup | Level 9 | Lagos Legend, night | Four races, no mercy |

## Rooms

A room is one instanced race for up to twelve cars. AI fills empty grid slots unless the host turns it off. The host picks the route, mode, laps, AI, traffic, time of day, weather, car class, player count, privacy and series length. The host cannot change results, physics or rewards, and cannot touch a race once the lights start. Points per place are 15, 12, 10, 8, 6, 5, 4, 3, 2 and 1. How rooms behave under disconnects, reconnects and host changes is in `04_ARCHITECTURE.md`.

## Where the numbers live

| What | File |
|---|---|
| Cars, liveries, prices | `rush/src/shared/cars.ts` |
| Items and odds | `rush/src/shared/items.ts` |
| AI levels and personas | `rush/src/shared/ai.ts` |
| Rewards and XP curve | `rush/src/shared/economy.ts` |
| Routes | `rush/src/shared/trackDefs.ts` |
| Room limits | `rush/src/shared/roomConfig.ts` and `rush/server/rooms.ts` |
