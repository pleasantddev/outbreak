# HustleLife backlog

How to use this file: every engineer (the lead, teammates, and the scheduled cloud build shifts) picks the first
unchecked item in their lane, builds it, tests it, ticks it here with the commit hash, and pushes. Lanes: LEAD (main
checkout), SPORTS (worktree hl-sports), IDEAS (worktree hl-look, the Sonnet teammate), SHIFT (scheduled cloud run: any
unowned item, or finishing touches on a lead item).

## Founder brief 4 (31 Oct 2026, 05:35 and 05:38)
Verbatim keys: "Hospitals, clinics and sickness, transmittable one ... players can be sick and pass it on", "a hidden
luck meter that a lot of the Shii in the game will run by ... fluctuates based on karma ... determines casino wins ...
whether a player actually carries an illness and simply pass to another player without them falling sick or knowing
(only for transmitable diseases) ... if it's non transmitting then ... let them suffer it", "negative traits ... walk
slightly slower ... slight camera blur around the edges maybe myopia", "when a player is killed ... they appear in the
hospital and pay a bill, if they can't pay, they are sent out ... stripped of everything including clothes and have a
negative on their balance to be paid", "Avoid hyper inflation", "players can rent apartments, no one gets a home
immediately ... Except nepos or ... IJGB", "phones ... different types from small phone to tabs, cracks can appear ...
repair or get new ones at a shop or computer village in Ikeja ... if a player has hacking skills they can hack and
maintain access later to your device and do everything your device can do from their clone phone, let players be able
to switch between phones".
Rules: stripped means down to underwear (the 16+ floor); hacking is a game mechanic, never real technique.

### LIFE (new Opus agent, low effort)
- [ ] Luck and karma: hidden server-side luck per player, moved by karma (good and bad deeds), read by casino odds,
      carrier chance, accidents, finds; admin can see and tune it.
- [ ] Sickness: a set of illnesses (malaria, typhoid, cholera, flu, a cough that spreads, ulcer, hypertension...),
      symptoms that change play, transmissible ones spread between nearby players (server), silent carriers decided by
      luck, non-transmissible ones just hurt; pharmacies, clinics and hospitals treat them for a fee.
- [ ] Hospital respawn: death sends you to the nearest hospital with a bill; can't pay means discharged in underwear
      with everything you carried gone and a debt that comes out of what you earn next.
- [ ] Negative traits rolled at character creation (slower walk, myopia edge blur, weak stomach, light sleeper...),
      some can be treated (glasses at an optician).
### SPORTS lane adds
- [ ] Renting: new players start with no home; rent rooms and flats (face-me-I-face-you to a Lekki flat) from NPC
      landlords and from player owners through Property Manager; rent due, caution fee, eviction. IJGB (rich returnee)
      starting background gets a flat from day one.
### LEAD adds
- [ ] Phones as items: models from a small phone to a tablet (screen size, apps, battery), switch between them, cracks
      over time and from falls, repair or buy at Computer Village Ikeja and phone shops, a shady repairer with the
      hacking skill can clone your phone and keep reading it until you change phones or get it cleaned.
- [ ] Economy guard against inflation: money sinks (rent, bills, repairs, wear, fees, hospital), earnings scaled to
      the money supply, admin money supply chart.

## Founder brief 3 (31 Oct 2026, 04:54)
Verbatim keys: "roads street lights can be spoilt too", "add the police force, with a walk-in talkie, zone them apart,
add lastma too.. for traffic control… make all these viable career paths", "for the phone, add a back button to all
those apps and for the love of god make them look like actual apps with proper app icons", "MyAds ... pay real money to
advertise on the billboard ... upload the image ... rate and image sizing dependent on location, size and how long ...
base of 4500 per day ... track ... how much people (actual players) are seeing it everyday", "players can change their
outfits, remove clothes up to boxers for guys and inner bra and pants for ladies ... wear and buy other clothes",
"rebuilt the oshodi terminal ... including all those bridges ... huge billboards and signages on them ... oshodi can
also be used as a motor park and the terminal floors all 3-6 floors are just parking garages ... offices for the head
of union", "copy everywhere in the app like a human", "the entire Lagos map", "football place ... purchaseable ...
property manager app ... agents to sell and manage ... unlisted: other players shouldn't see the price or buy it ...
schedule and fix matches, play actual football matches against other players like in fifa, basketball like 2k20",
"ads manager ... drone shows ... ad blimps that fly across the map, make it pricey, use paystack for all payments",
"players can DJ ... dance on the poles and get paid working ... shut down the clubs how they do in Lagos ... the big
clubs from Lagos like Quilox", "DJ can play from a set list of Nigerian music ... music api ... upload your own song
... pay to have it up in the clubs (actual money)", "voice chat ... the closer you get to someone the better you can
hear them", "contact app ... player public id ... in-game phone number ... text and call each other", "find another
way to prompt yourself up", "keep a sonnet teammate that comes up with more ideas ... let me see the ideas in one
artifact", agents on Opus at low effort.

Rules we keep: 16+ (no nudity: underwear is the floor; pole dancing is athletic and clothed, a job, never sexual),
crime is satire never a how-to, no real brand logos, parody names for real clubs (Quilox becomes a parody) unless the
founder clears the real name, music only where we have the right to play it (Audius streams, CC0/CC-BY tracks, songs
players upload and attest they own).

### LEAD
- [ ] Phone v2: real-looking apps (proper icon set, app bars, list cells), a back button in every app, consistent
      navigation (swipe/back/Backspace), touch friendly.
- [ ] Contacts + Messages + Calls: public player ID and in-game phone number per account; add contacts; texting
      (server-stored, offline delivery); voice calls player to player.
- [ ] Proximity voice chat (WebRTC, server signalling): hear players near you, volume by distance, same-space only,
      push-to-talk and open mic, mute per player. Police walkie-talkie: radio channel per zone while on duty.
- [ ] Payments: Paystack (server initialize + verify + webhook, env PAYSTACK_SECRET_KEY / PAYSTACK_PUBLIC_KEY), test
      mode without keys; every real-money purchase goes through it; admin ledger.
- [ ] MyAds: billboard inventory (Oshodi bridges, expressways, rooftops), price from ₦4,500/day by location, size and
      days; image upload with size spec per board; moderation queue in admin; real-player impression tracking per day.
- [ ] MyAds extras: drone shows (your text in the night sky for a set time), ad blimps that cross the map. Pricey.
- [ ] Clubs: DJ booth (players DJ from a big Nigerian set list streamed from Audius plus CC tracks), song upload to
      your phone library and paid promotion into club rotation, pole dancer job (athletic, clothed, paid), club
      shutdown (book the club, spray money, the whole room knows), parody big clubs.
- [ ] Wardrobe: buy clothes (market, okrika, boutiques), change outfits, strip to underwear (boxers; bra and pants).
- [ ] Police career: divisions by zone, patrols, respond to crimes, arrests, checkpoints (satire), walkie-talkie radio.
- [ ] LASTMA career: traffic control at junctions, book offenders (NPC and player), towing.
- [ ] Street lights can be knocked down or broken (cars, fights), go dark, and Lagos Power linemen repair them.
- [ ] Copy pass over every player-facing string with the humanizer guide.

### SPORTS (Opus agent, low effort)
- [ ] Property Manager app: list your property for sale yourself or through an agent (commission), set price; only
      listed property shows a price or can be bought; agents manage rentals.
- [ ] Pitches, courts and stadiums on the map are ownable property (server ownership, listing rules above).
- [ ] Book and fix matches: owners rent out slots; players challenge each other; scheduled kick-offs.
- [ ] Football match: players control footballers, FIFA-style controls, online between real players, AI fills.
- [ ] Basketball match: 2K-style, online between real players.

### IDEAS (Sonnet teammate)
- [ ] Ideas artifact: a running page of new ideas in the founder's spirit, each with a status, kept current.
- [ ] Oshodi Transport Interchange rebuilt like the real one: terminals, pedestrian bridges over the expressway with
      huge billboard faces (MyAds inventory), motor park, terminal floors 3 to 6 as parking garages, union offices.
- [ ] Club buildings and interiors for the big parody clubs; pole stages, DJ booths.
- [ ] Map completeness audit: list missing Lagos places and add them.

## Earlier backlog (21 Oct)

## Admin panel (next)
- Control everything: in-app purchases, prices, account bans/suspensions, profiles, economy values.
- Full map viewer in 3D (map and locations; players/NPCs can be markers, not 3D).
- Content editor for the game script: routes, events, missions, skills, skill modes and trees. View, edit, add, remove.

## Cappa Mechanic Village, Ilupeju
- Meet NPC mechanics or other players for paint jobs.
- Painters get a full 3D paint editor (paint and draw anything on a car).
- Custom plate numbers for sale.
- Vehicle trackers sold at mechanic villages and shops.

## Identity and ownership
- In-game NIN, issued at local government offices.
- Register cars to your name; report stolen; track with a bought tracker.

## Housing (Sims-style, free placement, no grid)
- Decorate bought houses; paint external and internal walls.
- Buy and place items in the compound and house freely: decor, generator, solar, anything.

## Later
- Governance system.
- Schooling: universities, attending classes, and related scenarios.
