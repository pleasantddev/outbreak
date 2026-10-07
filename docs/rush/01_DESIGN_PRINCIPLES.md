# Lagos Rush: Design Principles

What makes accessible kart racers, high speed street racers and stunt racers so hard to put down, and how Lagos Rush turns each lesson into something original and Lagos shaped. Nothing here copies another game's characters, tracks, items, UI, vehicles, names or terms. We take the mechanics behind them, never the content.

## 1. What the three genres teach

### Accessible kart racers

| Principle | Why it hooks | How it shows up |
|---|---|---|
| Anyone can finish | Steering is forgiving, walls bounce you back instead of ending your race, there is no real crash state | Soft barriers, no damage model that ends a race, quick automatic recovery |
| Drifting is the skill ceiling | Holding a slide charges a reward you release on exit, so cornering becomes a choice rather than a chore | A charge that climbs through visible tiers, paid out as a boost when you let go |
| The pack stays together | Item odds depend on position, so the leader gets defence and the back of the pack gets comeback tools | Rank weighted pickup tables, mild catch up on AI, slipstream behind cars |
| Chaos is shared | Items create stories nobody planned, and everyone gets a turn to be the hero or the victim | Pickups every lap, short effects, readable telegraphs |
| Instant restart | Races last two to four minutes and the next one is one button away | Rematch from the results screen, no menus in between |

### High speed street racers

| Principle | Why it hooks | How it shows up |
|---|---|---|
| Risk earns speed | Near misses, drifting and driving against traffic fill a meter that makes you faster, so the brave line is the fast line | A nitro meter fed by risk |
| Speed you can feel | FOV pushes out, the camera shakes, the world streaks, the engine screams | Speed driven camera, motion streaks, audio that rises with velocity |
| Contact pays | Shoving a rival into a wall is the biggest reward in the game | Shunt rewards, a slam that fills nitro |
| Traffic is terrain | Civilian vehicles turn a straight road into a puzzle at 200 km/h | Lane based traffic you weave through |
| Cars as identity | People care about their car, its paint, its wheels and its sound | A garage with paint, wraps, rims, underglow and plates |

### Stunt racers

| Principle | Why it hooks | How it shows up |
|---|---|---|
| Airtime is a reward | Leaving the ground feels like a small victory | Ramps on every track, big ones on bridges |
| Tricks in the air | Input while airborne turns a jump into expression | Spins and flips in the air, paid out on landing |
| Land it or lose it | A clean landing boosts you, a bad one costs time | A landing grade: clean, sloppy or crash |
| Mastery through lines | Perfect runs are memorable and repeatable | Time trials with ghosts and medals |

## 2. The Lagos Rush loop

DRIVE, RISK (drift, near miss, airtime, shunt), EARN (boost and nitro), SPEND (go faster, use pickups), RACE FOR POSITION, FINISH, REMATCH.

The session loop is one room: lobby, countdown, three laps, results, rematch. The long term loop is Naira and XP from every race, spent on cars, paint, wheels and plates, plus cups in Career.

## 3. Original Lagos implementations

### Drift charge: "Gbedu"

Hold drift while steering into a corner. The charge climbs through three tiers shown as sparks under the rear wheels: yellow, orange, then hot pink. Release for a boost whose length grows with the tier. Gbedu is Lagos slang for a big, loud party, and a well held drift should feel like one.

### Nitro: "Fuel"

A meter that fills from risk: drifting, near misses with traffic, airtime, slipstream and shunting rivals. Press to burn it. In Street Race mode, Fuel is the only boost.

### Pickups: "Ghana Must Go" bags

Pickup boxes are the plaid woven carrier bags every Nigerian recognises, floating over the road. Driving through one gives a random item, weighted by race position.

| Item | Effect | Weighted toward |
|---|---|---|
| Pure Water | Drops a burst sachet; a car that drives over it skids | Leaders |
| Pothole | Drops a crater; anyone who hits it bounces and slows | Leaders |
| Agbero Horn | A shockwave that shoves nearby cars sideways | Middle |
| Gala Rocket | A homing snack rocket that spins out the car ahead | Middle |
| Gen Boost | Three short boosts, like a generator kicking in | Middle and back |
| NEPA Blackout | Every car ahead of you loses its screen to darkness for a few seconds, except its own headlights | Back |
| Danfo Mode | You become an unstoppable yellow bus on autopilot for a few seconds, flattening anyone you touch | Far back |
| Okada Swarm | A swarm of okadas cuts across the race leader and spins them out | Last place only |

Every item has a counter: you can steer around Pure Water and Potholes, a well timed drift dodges the Gala Rocket, and boosting through a shockwave keeps you straight.

### Traffic: Lagos at rush hour

Danfos, kekes, okadas, BRT buses and tankers move along their lanes on a deterministic schedule. Every client computes the same traffic from the room seed, so traffic never needs network sync. Near misses fill Fuel, and touching traffic spins you unless you are boosting.

### Stunts: bridges and ramps

Ramps sit on the approaches to bridges, on market stalls and on construction sites. While airborne, steer to spin and pitch to flip. A clean landing pays out a boost scaled to the tricks you completed.

### Recovery

Fall off a bridge or leave the track and a tow truck crane lifts you back to the last stretch of road you were safely on. No race ending crashes.

## 4. Modes

| Mode | Rules |
|---|---|
| Rush Race | Pickups, traffic and Fuel. The default. |
| Street Race | No pickups. Traffic, Fuel and shunts decide it. |
| Stunt Run | Score attack: airtime, tricks and drifts on a timer. |
| Time Trial | Solo against your ghost for medals. |

## 5. Rules for fairness

* Catch up is mild and visible: slipstream and pickup odds, plus gentle AI pacing. Nothing secretly changes the player's physics.
* The server owns race configuration, start time, checkpoints and final ranking.
* Room hosts set up a race but can never change results or physics.

## 6. What we avoid

* Copying any franchise's items, mascots, track shapes, UI layout, sounds or terminology.
* Real car brands, logos or recognisable designs. Every car is original.
* Real commercial brands on billboards. Every brand is fictional, apart from the public political posters requested for street realism (see the art direction document for the note on those).
