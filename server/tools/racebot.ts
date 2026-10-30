// A scripted second racer for testing street race lobbies against a running server.
// usage: npx tsx tools/racebot.ts http://127.0.0.1:8787 <meetKey> <x> <z> [finishMs]
import WebSocket from 'ws';
import { PROTOCOL_VERSION, encodeState, F } from '../../v2/src/net/protocol.ts';
const [api, key, xs, zs, fms] = process.argv.slice(2); const x = Number(xs), z = Number(zs); const finishMs = Number(fms ?? 9000);
const post = async (p: string, b: unknown, tok?: string) => (await fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b) })).json();
const s = await post('/api/auth/signup', { identifier: `bot${Date.now()}@test.dev`, password: 'hunter2hunter2' });
await post('/api/profile', { name: 'Bot' + (Date.now() % 1000), model: 'survivor', skin: 2, outfit: 'street' }, s.token);
const ws = new WebSocket(api.replace('http', 'ws') + '/ws'); let n = 0; const acks = new Map<number, (m: any) => void>(); let seq = 0;
const act = (a: string, args: object = {}) => new Promise<any>((res) => { const k = ++n; acks.set(k, res); ws.send(JSON.stringify({ t: 'act', n: k, a, ...args })); });
const state = () => ws.send(encodeState({ seq: ++seq, flags: F.ALIVE | F.GROUND, x, y: 0.05, z, yaw: 0, pitch: 0, speed: 0, anim: 0, weapon: 0, veh: null }));
ws.on('message', (d, bin) => { if (bin) return; const m = JSON.parse(d.toString()); if (m.t === 'ack') acks.get(m.n)?.(m); if (m.t === 'lobby') { console.log('lobby', m.state, m.members?.length, m.results ? JSON.stringify(m.results) : ''); if (m.state === 'open' && (m.members?.length ?? 0) >= 2) void act('race.start', { len: 420 }).then((r) => console.log('start', r.ok, r.err ?? '')); if (m.state === 'countdown') setTimeout(async () => console.log('finish', JSON.stringify(await act('race.finish', { ms: finishMs, len: 420 }))), (m.startIn ?? 6000) + finishMs + 300); if (m.results) setTimeout(() => process.exit(0), 500); } });
await new Promise((r) => ws.once('open', r)); ws.send(JSON.stringify({ t: 'hello', token: s.token, v: PROTOCOL_VERSION }));
await new Promise((r) => setTimeout(r, 800));
console.log('reward', (await act('cash.delta', { d: 20000, why: 'reward' })).cash);
console.log('tp', (await act('tp')).ok); state(); await new Promise((r) => setTimeout(r, 400)); setInterval(state, 200);
for (let i = 0; i < 600; i++) { const r = await act('race.join', { key, x, z, type: 'drag', wager: 5000 }); if (r.ok) { console.log('joined', r.lobby.members.length); break; } if (i % 10 === 0) console.log('join wait', r.err); await new Promise((r2) => setTimeout(r2, 2000)); }
setTimeout(() => process.exit(1), 15 * 60_000);
