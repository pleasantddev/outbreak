# Play HustleLife on your own network

One computer hosts the game. Everyone on the same Wi-Fi plays online on it from a phone or a laptop, with nothing to install.

Just want to play? Use the `play` branch: `git clone -b play --depth 1 https://github.com/pleasantddev/outbreak.git hustlelife`,
then double-click Play HustleLife. It is the built game and nothing else; its README has the rest. Rebuild it from here
with `node tools/release-play.mjs --push`. The steps below are for running from the source on this branch.

## On the computer that hosts

You need Node 22 or newer (the LTS from https://nodejs.org) and this repository on the `hustlelife` branch.

```
git clone -b hustlelife https://github.com/pleasantddev/outbreak.git
cd outbreak
node lan.mjs
```

The first run installs packages and builds the game, so give it a few minutes. After a `git pull` it rebuilds by itself. When it is ready it prints two addresses:

```
HustleLife is running on your network
  On this computer:   http://localhost:8787
  Everyone on your Wi-Fi: http://192.168.1.23:8787
```

Send the second one to everybody. If the Mac asks whether `node` may accept incoming connections, click Allow. The Mac is kept awake while the server runs. Ctrl+C stops it.

| Command | What it does |
|---|---|
| `node lan.mjs` | install what is missing, rebuild if the code changed, start |
| `node lan.mjs --build` | rebuild the game first even if nothing changed |
| `node lan.mjs --no-build` | start with the last build |
| `node lan.mjs --port 9000` | use another port |
| `node lan.mjs --fresh` | start an empty world (the old database is kept beside it, not deleted) |

## For the testers

Open the address in Chrome or Safari, tap Play as guest, pick a name, then Play. Each device is its own player. Guests can save their account later with an email or phone number from the green dot in the corner.

Phones: hold it sideways for driving, upright for the phone apps. The world is saved on the host in `server/data/hustlelife.db`, so money, land, shops and shares stay between sessions.

## Good to know

- Everyone must be on the same Wi-Fi. Guest networks and some office networks block devices from seeing each other; a phone hotspot from the host works as a fallback.
- Voice chat needs https, so for now it only works on the host computer. Everything else works for everyone.
- Payments are in test mode on a local server: checkouts are fake and nothing is charged.
- Adding `?server=off` to the address plays offline on that device; `?server=ws://<ip>:8787` points a build at another server.
