# HustleLife

Lagos, online. This branch is the game ready to play. No build step, no dev tools.

## Play

You need Node 22 or newer. Get the LTS from https://nodejs.org if you do not have it.

```
git clone -b play --depth 1 https://github.com/pleasantddev/outbreak.git hustlelife
```

Then open the `hustlelife` folder and double-click **Play HustleLife** (`.command` on a Mac, `.cmd` on Windows), or run `node start.mjs` in that folder.

The first start takes about a minute. After that the game opens in your browser. Keep the black window open while you play. Closing it stops the game.

## Play with friends on your Wi-Fi

The window prints a second address, something like `http://192.168.1.23:8787`. Anyone on the same Wi-Fi opens it in Chrome or Safari on their phone or laptop, taps Play as guest, picks a name and joins your Lagos. Nothing to install on their side.

If the Mac asks whether `node` may accept incoming connections, click Allow. Guest Wi-Fi and some office networks block devices from seeing each other; a hotspot from your phone works instead.

## Update

```
cd hustlelife
git pull
```

Then play again. Your world is in the `data` folder and is kept between updates.

## Good to know

- Money, land, shops and shares are saved in `data/hustlelife.db` on the computer running the game.
- Voice chat needs a secure connection, so it works on the host computer only for now.
- Payments run in test mode here. Nothing is ever charged.
- `node start.mjs --fresh` starts a new world (the old one is renamed, not deleted). `--port 9000` uses another port. `--no-open` skips opening the browser. `--logs` shows everything the server says.
- Add `?server=off` to the address to play offline on that device.

Source and dev tools live on the `hustlelife` branch. This branch is rebuilt from it with `node tools/release-play.mjs`.
