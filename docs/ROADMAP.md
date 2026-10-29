# HustleLife roadmap (autonomous mode, from 29 Oct 2026)

Founder brief (29 Oct): hands off. The aim is a life SIMULATION (Sims depth, refined cozy-real graphics) that uses GTA's
easy-to-learn controls, not GTA Online. Lagos-shaped, not a literal OSM dump full of obstructions. "WOW me": depth
everywhere. Market women haggle, brush teeth, eat, casinos, clubs, racing, mechanics, tech bros, yahoo boys, thieves.
Hard rules from the founder: max ONE teammate agent at a time. Keep working through usage-limit cooldowns by keeping a
send_later heartbeat scheduled into this session. Contact: joylove.rightchoice@gmail.com.
Content rule for us: 16+, no sexual content (nightlife = clubs, dancers clothed, no nudity), crime is satire and never
a how-to (yahoo/fraud is a game abstraction, no real scam scripts).

## Pillars
1. Life sim core: needs (hunger, energy, hygiene, bladder, fun, social, comfort, health, stress), moods, time of day,
   smart objects that advertise actions (bed: sleep/nap, sink: brush teeth/wash, toilet, bucket bath, stove: cook,
   fridge/cooler: eat, chair/bench: sit, TV, fan, mirror), autonomous actions when idle, action queue, Sims-style pie
   menu on click/tap of any object or person.
2. Places you live in: enterable interiors as small lots (face-me-I-face-you room first, then flats, duplex),
   beautiful controlled lighting, buy/decorate (features branch already has free placement and wall paint).
3. Livelihoods with real minigames: market trader with haggling (NPC personalities, anchoring, walk-away), mechanic
   (diagnose and fix), okada/danfo/keke (fares, routes, LASTMA), tech bro (gigs, typing/code minigame, Yaba hub),
   yahoo boy (satirical cyber hustle, EFCC raids, high risk), thief (pickpocket timing, car theft), street racer,
   bank clerk / office 9-5, food seller (buka).
4. Leisure: casino (blackjack, roulette, slots), nightclub (dance rhythm game, drinks, VIP), beer parlour, football
   viewing centre, gym, church/mosque, cinema.
5. Racing: street races vs AI racers on the road graph, drag on Third Mainland, time trials, bets.
6. Living city: society branch (citizens, schedules, economy, nemesis) wired into everything.
7. Feel and look: declutter the map (no walls across pavements, fewer random props), better facades and materials,
   cozy lighting and grade, my own HUD design (needs ring, clean minimal), sound (ambience, music, foley).
8. Online: net branch (server, accounts, realtime) and admin panel; deploy later.

## Order of work
A. Life sim core (needs, smart objects, pie menu, autonomy, eat/sleep/brush/bath/toilet) + the player's first room.
B. Haggling + market trader career; food vendors on the street (buy, eat, needs).
C. Map declutter + look pass (facades, lighting, grade, HUD v3).
D. Careers batch 2 (mechanic, okada/danfo fares, tech bro, yahoo, thief).
E. Leisure: casino, nightclub, beer parlour; racing modes.
F. Integrate society/missions/features deeper; sound pass; perf check; publish; push.
Each milestone: tsc, regress.py, screenshots reviewed, publish to the artifact, push to GitHub, update docs/STATE.md.

## Status (30 Oct)
- A done: systems/life (needs, moodlets, smart objects, pie, home lot with Sims cutaway, door on the street, social pie).
- B done: systems/life/vendors.ts + haggle.ts (market women, mama put, suya, corn, pure water, recharge, okrika, pay toilet).
- D mostly done: careers/transport (J on duty, fare haggling, agberos), mechanic, tech (Hub 32 gigs), thief (pickpocket),
  yahoo (satire arc, EFCC raid). Still to do: bank clerk / office 9-5, buka owner, autonomy when idle.
- E mostly done: leisure/casino (blackjack, roulette, slots), leisure/club (rhythm dance-off, VIP, DJ), careers/racing
  (sprint, circuit, drag with launch boost, AI rivals on the road graph). Still to do: beer parlour, viewing centre, gym.
- Venues API: systems/life/venue.ts; life.addVenue(v) builds colliders, places a street door on a commercial plot.
