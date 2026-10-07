# Lagos Rush: UI and UX

The interface has one job: get a player from the splash screen to a green light in as few presses as possible, then get out of the way. It borrows the energy of Lagos street graphics (bold condensed type, danfo yellow, hazard stripes, hand painted slogans) and none of any other racing game's layout.

## Visual language

| Element | Rule |
|---|---|
| Type | Barlow Condensed, heavy italic for titles and numbers; Inter for body text; JetBrains Mono for times |
| Colour | Danfo yellow `#f6c514` for focus and primary actions, hot pink `#ff2d8a` for the host and hype, cyan for other humans, near black panels |
| Shape | Skewed buttons and tags that lean forward like they are moving; hazard stripe bars under the logo |
| Motion | Short slides and fades. Reduce motion turns them off |
| Copy | Short, warm, a little cheeky. Pidgin where a Lagos driver would use it (quick chat, callouts), plain English for anything a player must understand |

Every screen sits over the live 3D city, so the game never looks like a form. Panels are opaque enough to read over a bright sky.

## Screen map

```
Splash (loading, tips, ODbL credit)
 └ Onboarding (first run: name, crew, how to drive, graphics preset chosen for this device)
    └ Main menu: RACE . GARAGE . LAGOS . MULTIPLAYER . CAREER . PROFILE . settings gear
       ├ Quick Race (route cards, mode, laps, opponents, rivals, traffic, time, weather, car)
       │   └ Intro fly through ─ Countdown ─ HUD ─ Pause ─ Results and rewards ─ Replay
       ├ Garage (cars, stats, paint, finish, wrap, rims, extras, buy and equip)
       ├ Lagos (the map with routes, terminals and bridges, landmark notes)
       ├ Multiplayer
       │   ├ Quick match ─ Matchmaking ─ Lobby
       │   ├ Create room (all race settings) ─ Lobby
       │   ├ Join with code ─ Lobby
       │   ├ Friends (friend code, add friends, raced recently, copy room link)
       │   └ Leaderboards (lap records per route, medals)
       │       Lobby ─ Countdown ─ HUD ─ Menu (race keeps going) ─ Online results ─ back to the room
       ├ Career (cups, standings, next race)
       ├ Profile (name, crew, colour, friend code, stats, records, badges)
       └ Settings: Graphics . Audio . Controls . Accessibility . Gameplay . About
```

An invite link (`?room=LAGOS-4827`) skips the menus: after the splash the player lands in the join screen and then the lobby.

## Every element answers four questions

What is this, why am I seeing it, what can I do, what happens next. Two examples:

* **Room code panel.** Shows LAGOS-4827 in huge type, says whether the room is private or public, and offers copy and share buttons. Sharing uses the phone's share sheet where it exists, otherwise copies the link.
* **Ready button.** Says Ready or Not ready. Once everyone present is ready the race starts by itself; the host can also press Start now. A pill next to each player says READY, NOT READY, AWAY (dropped, seat kept) or WATCHING (joined mid race).

## The HUD

| Area | What it shows |
|---|---|
| Top left | Position (big), lap count or stunt timer, race clock, best and last lap |
| Left, under it | Standings ticker: the leader, the car ahead, you, the car behind, with gaps in metres. Humans in cyan |
| Top right | Minimap of the route with every car and live hazards |
| Centre | Countdown numbers, big callouts (PERFECT START, FINAL LAP, NEPA TAKE LIGHT!), WRONG WAY |
| Right | Style feed (SLIPSTREAM, NEAR MISS +25, GBEDU +50) |
| Bottom left | Item slot with a short roulette while the bag rolls |
| Bottom right | Speed gauge and number (km/h or mph), Fuel bar, three Gbedu pips |

DOM writes are throttled to about fifteen a second so the HUD never costs frame time on a slow phone. Callouts carry their own colour: green for good, red for bad, yellow for information.

The HUD steps aside when the race reports its result, so the results screen sits over the orbiting car and nothing else. In the chase view a rival right under the camera turns see through until it pulls clear; off the grid that is the car behind you, and solid it would fill a third of the screen.

## Input

All menus work with mouse, touch, keyboard and gamepad. Arrow keys, WASD, the D pad and the left stick move a focus ring between buttons by screen position; Enter or A clicks, Escape or B goes back.

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Accelerate | W or Up | Right trigger | GAS (or auto accelerate) |
| Brake and reverse | S or Down | Left trigger | BRAKE |
| Steer | A D or Left Right | Left stick | Steering pad on the left |
| Drift | Space | RB or A | DRIFT |
| Fuel | Shift | B or X | FUEL |
| Item | E, X or Enter | LB or Y | ITEM |
| Look back | C | Right stick click | |
| Tow truck | R | | |
| Camera | V | | |
| Pause or menu | Escape or P | Start | |

Every key can be rebound. A short tap of the item key counts even on a phone running at a low frame rate. Touch players get auto accelerate and steering assist by default; both can be switched off.

## Accessibility

* Colour blind safe HUD: blue and orange replace green and red.
* High contrast: solid panels and brighter secondary text.
* Reduce motion: no screen shake, no speed streaks, no menu slides.
* Interface size from 85% to 140%.
* Steering assist from off to strong, auto accelerate, invertible air pitch, vibration toggle.
* Camera choice (near, far, bonnet) and an option to skip the pre race fly through.
* Speed in km/h or mph.
* Callouts never rely on colour alone: every one is also a word.

## States

| State | What the player sees |
|---|---|
| Loading | Progress bar with what is happening ("Raising the terminals"), a driving tip, the map credit |
| WebGL missing | A plain message on the splash instead of a blank canvas |
| Offline or server unreachable | OFFLINE pill with the reason and "trying again in N s"; solo play and the garage keep working |
| Room not found or full | A toast with the reason, the code field stays filled |
| Dropped mid race | "Connection lost. Reconnecting..." while an AI keeps the car going; the race picks up where the room has your car |
| Joined mid race | WATCHING in the lobby, straight into the next race |
| Kicked | "The host removed you from the room" and back to Multiplayer |
| Empty lists | One line that says how to fill them ("Race online and the people you meet show up here") |

## Mobile first

Many players will be on mid range Android phones on patchy data, so the phone is the primary target, not an afterthought.

* Safe areas are respected on every edge; the HUD keeps clear of notches and gesture bars.
* Touch targets are at least 44 px; the steering pad and pedals are large thumb zones.
* The whole game downloads in under a megabyte and a half compressed, with no texture packs, because every texture and sound is generated on the device.
* Graphics presets are chosen automatically from the GPU and a short benchmark, and dynamic resolution holds the frame rate on busy laps.
