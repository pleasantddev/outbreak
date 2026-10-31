# HustleLife server

Node 22 + TypeScript. `ws` for realtime, plain `node:http` for REST, SQLite (`better-sqlite3`) for storage. No other runtime dependencies.

```
cd server
npm install
npm run dev              # tsx watch, port 8787
npm test                 # vitest: protocol, accounts, economy, content, realtime
npm run loadtest -- --bots 60 --seconds 30
```

The game turns multiplayer on with `?server=ws://host:8787` (remembered in localStorage). Without it the game is the offline single player build.

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | 8787, 0.0.0.0 | listen address |
| `DATA_DIR` | `server/data` | database, secret, content files |
| `JWT_SECRET` | generated into `DATA_DIR/secret.key` | token signing key |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | none | creates or promotes this account to admin at boot |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` | none | real payments through Paystack (set the dashboard webhook URL to `https://<host>/api/pay/paystack/webhook`) |
| `PAY_TEST` | on without a secret key, off when `NODE_ENV=production` | fake checkouts for dev; never turn on in production |
| `PAY_CALLBACK_URL` | none | the game URL Paystack returns players to (it adds `?reference=`) |
| `TICK_HZ` | 15 | snapshot rate (5 to 30) |
| `MAX_PLAYERS` | 500 | socket cap |
| `INTEREST_RINGS` | 3 | area of interest radius in 250 m cells |
| `START_CASH` | 1850 | cash of a new account |
| `ALLOW_ORIGINS` | `*` | CORS, comma separated origins |
| `STATIC_DIR`, `ADMIN_DIR` | none | serve the built game at `/` and the admin app at `/admin` |
| `GUEST_ACCOUNTS` | true | allow guests |
| `ANTI_CHEAT` | enforce | `enforce`, `log` or `off` |
| `TRUST_PROXY` | false | read the client IP from `X-Forwarded-For` (set behind nginx or a tunnel) |
| `PLOTS_FILE` | `DATA_DIR/plots.bin` | map plot index for server side prices (`npm run build-plots`) |

## Route plug-ins (for the admin workstream)

Every file in `server/routes/*.ts` that exports `register(api)` is loaded at boot (a build loads `*.js`). Add `server/routes/admin*.ts` and
export `register`; nothing else needs editing.

```ts
import type { Api } from '../src/api.ts';
export function register(api: Api) {
  api.get('/api/admin/accounts', (req) => api.accounts.list({ q: req.query.q }), { auth: 'admin' });
  api.post('/api/admin/ban', (req) => { api.accounts.ban(req.body.accountId, { reason: req.body.reason, until: req.body.until ?? null, by: req.account!.id }); return { ok: true }; }, { auth: 'admin' });
}
```

Handlers get `{ method, path, params, query, body (parsed JSON), headers, ip, account, raw, res }`. Return an object for JSON 200, `undefined` for 204,
`reply(status, body, headers)` for anything else, or throw `new HttpError(status, message, extra)`. Auth levels: `none`, `user`, `mod`, `admin`.
Options: `{ auth, rate: { limit, windowMs }, bodyLimit }`.

What `api` gives you:

| Member | Use |
|---|---|
| `api.db` | the better-sqlite3 handle. Tables: accounts, sessions, profiles, players, plots, tx_log, purchases, bans, chat_log, cheat_flags, nin_registry, vehicle_registry, kv |
| `api.accounts` | `list`, `byId`, `profile`, `ban(id, {reason, until, by})`, `unban`, `mute`, `unmute`, `setRole`, `adminSetPassword`, `banHistory`, `updateProfile` |
| `api.economy` | `wallet`, `adjust(id, dCash, dBank, kind, {ref, note, clamp})` (the only way money moves, logged to tx_log, pushed live), `grant`, `history`, `plotsOf`, `plotsIn`, `setPlotOwner(plotId, ownerId or null)`, `flags`, `wages` |
| `api.content` | `read(kind)`, `write(kind, doc, {by})`, `history`, `restore`, `resetToSeed`, `registerKind(name)` |
| `api.online` | `list()`, `isOnline`, `kick(accountId, reason)`, `broadcast(text)`, `toast(accountId, title, body)`, `teleport(accountId, x, z)`, `rooms()`, `stats()` |
| `api.events` | emits `signup`, `login`, `ban`, `unban`, `wallet`, `plot`, `flag`, `content` |
| `api.cfg`, `api.log` | configuration and logger |

The purchases ledger table (`purchases`) is yours to fill from IAP webhooks. Fulfil with `api.economy.grant(accountId, cash, 'iap', providerRef)`; a unique
index on `(provider, provider_ref)` makes webhooks idempotent.

## Payments (src/payments.ts, routes/pay.ts)
Every real-money purchase: `POST /api/pay/start {sku, meta}` (server prices it, returns Paystack's checkout URL),
`GET /api/pay/status/:ref` (verifies with Paystack while pending), the signed webhook settles it, goods are handed over
once. Products: `iap:<id>` from content/iap.json (cash and bank packs today). Other systems call
`api.payments.register(kind, { quote, fulfil })`. Ledger: `GET /api/pay/ledger` (admin) and the admin Store page.

## Core endpoints

Auth: `POST /api/auth/signup|login|guest|upgrade|logout|password`, `GET /api/auth/me` (`identifier` is an email or a phone number).
Profile (one per account, enforced by the primary key): `GET|POST|PATCH /api/profile`, `GET /api/players/:name`.
Money and state: `GET /api/me/wallet|history|state|plots`, `PUT /api/me/state`, `POST /api/me/bank`.
World: `GET /api/world/plots?minx&minz&maxx&maxz`, `GET /api/world/plots/:id`.
Registry hooks: `GET|POST /api/nin`, `GET /api/vehicles/mine`, `POST /api/vehicles/register`, `POST /api/vehicles/:vkey/stolen|tracker`, `GET /api/vehicles/lookup?plate=`.
Content: `GET /api/content`, `GET /api/content/:kind` (public, ETag), `PUT /api/content/:kind` (admin, `If-Match` supported, keeps 30 backups),
`GET /api/content/:kind/history`, `POST /api/content/:kind/restore`, `POST /api/content/:kind/reset`.
Ops: `GET /api/health` (public), `GET /api/stats|rooms|online` (mod).
