// Measures what a player downloads during an online race: one socket, a twelve car room (one human, eleven AI),
// bytes on the wire with and without the socket's compression.   node tools/bandwidth.mjs ws://localhost:8787/ws
import WebSocket from 'ws';
const url = process.argv[2] ?? 'ws://localhost:8787/ws';
async function measure(deflate) {
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  let payload = 0, snaps = 0, t0 = 0;
  const card = { id: '', name: 'Meter', crew: 'Test', color: '#ffffff', level: 1, carId: 'tokunbo', livery: {} };
  await new Promise((r) => ws.on('open', r));
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'welcome') ws.send(JSON.stringify({ t: 'create', config: { aiFill: 11, laps: 3, traffic: 2 } }));
    if (m.t === 'room' && m.room.phase === 'waiting' && !t0) ws.send(JSON.stringify({ t: 'start' }));
    if (m.t === 'snap' && m.rt > 2) { if (!t0) { t0 = Date.now(); payload = 0; snaps = 0; ws._wire0 = ws._socket.bytesRead; } payload += d.length; snaps++; }
  });
  ws.send(JSON.stringify({ t: 'hello', v: 2, card }));
  await new Promise((r) => { const iv = setInterval(() => { if (t0 && Date.now() - t0 > 10000) { clearInterval(iv); r(); } }, 200); });
  const secs = (Date.now() - t0) / 1000, wire = ws._socket.bytesRead - ws._wire0;
  ws.close();
  return { deflate, secs: +secs.toFixed(1), snapsPerSec: +(snaps / secs).toFixed(1), jsonKBps: +(payload / secs / 1024).toFixed(1), wireKBps: +(wire / secs / 1024).toFixed(1), perSnapBytes: Math.round(payload / snaps) };
}
console.log(JSON.stringify(await measure(false)));
console.log(JSON.stringify(await measure(true)));
process.exit(0);
