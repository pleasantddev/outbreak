// Register systems here, one line each. Order = init/update order.
import type { GameSystem } from './registry';
import { netSystem } from './net';
import { societySystem } from './society';
import { nemesisSystem } from './nemesis';
import { garage } from './garage';
import { identity } from './identity';
import { skills } from './skills';
import { missions } from './missions'; import { lifeSystem } from './life'; import { vendorSystem } from './life/vendors'; import { billsSystem } from './life/bills'; import { leisureSystem } from './leisure'; import { transportSystem } from './careers/transport'; import { racingSystem } from './careers/racing'; import { thiefSystem } from './careers/thief'; import { techSystem } from './careers/tech'; import { mechanicSystem } from './careers/mechanic'; import { ranksSystem } from './careers/ranks'; import { boysSystem } from './careers/yahoo'; import { bankSystem } from './careers/bank'; import { businessSystem } from './business'; import { powerSystem } from './power'; import { powerJobSystem } from './careers/power'; import { wearSystem } from './wear'; import { houseSystem } from './life/house'; import { agberoSystem } from './careers/agbero'; import { decorSystem } from './life/decor'; import { phoneNetSystem } from './phonenet'; import { voiceSystem } from './voice'; import { paySystem } from './pay'; import { sportsSystem } from './sports';
// net goes first: it signs the player in during init, before the lobby and before other systems read their saved state
export const SYSTEMS: GameSystem[] = [
  netSystem,
  voiceSystem, // proximity voice, calls, walkie-talkie radio (WebRTC, server-relayed handshakes)
  phoneNetSystem, // Contacts, Messages, Phone: numbers, player IDs, texts and calls between players
  paySystem, // Top Up app and the one real-money checkout (Paystack, verified on the server)
  skills, // perks and skill levels: other systems read ctx.systems.get('skills').stat('...')
  societySystem, nemesisSystem,
  garage, identity,
  missions, // missions, events, routes: content/missions.json etc.
  thiefSystem, // pickpocketing (before life so a crouched E goes to the lift, not the chat pie)
  lifeSystem, // needs, smart objects, the pie, your room
  vendorSystem, // market women, mama put, suya, pay toilets: haggle for everything
  powerSystem, // the grid: which feeders have light (server-run online), windows, lamps, your bulbs
  decorSystem, // arrange and decorate your room; designers; guests see your layout
  houseSystem, // pipes, wiring, roof, water tank, generator, artisans and renovation
  billsSystem, // weekly rent, prepaid light and NEPA, ChopNow delivery
  sportsSystem, // pitches, courts, stadiums as property; Property Manager and Sports apps; football and basketball matches
  businessSystem, // shops on real shop fronts: buy, stock, collect the till; other players buy from yours
  leisureSystem, // casino and night club interiors
  ranksSystem, // career ranks and the Career phone app
  agberoSystem, // motor park union: tickets from every danfo and keke, the chairman's cut
  transportSystem, // okada / keke / danfo / ride-hailing on duty (J)
  racingSystem, // night street races: sprint, circuit, drag
  techSystem, // Hub 32 co-working: remote gigs for dollars
  mechanicSystem, // roadside workshops: diagnose, parts, bolts
  wearSystem, // cars wear: engine, oil, tyres, brakes, body; servicing at the workshops
  bankSystem, // First Hustle Bank: teller shifts
  powerJobSystem, // Lagos Power control room: move light around the city
  boysSystem, // the yahoo crew: satire with consequences
];
