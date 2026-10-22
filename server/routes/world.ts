// The shared world: who owns which plot, the NIN registry and registered vehicles (hooks for the identity and garage systems).
import { randomBytes, randomUUID } from 'node:crypto';
import type { Api } from '../src/api.ts';
import { HttpError } from '../src/auth.ts';
import { all, one, run } from '../src/db.ts';

const LGAS = ['Ikeja', 'Oshodi-Isolo', 'Mushin', 'Agege', 'Alimosho', 'Ifako-Ijaiye', 'Kosofe', 'Surulere', 'Lagos Island', 'Eti-Osa', 'Ikorodu', 'Ajeromi-Ifelodun', 'Apapa', 'Somolu', 'Amuwo-Odofin', 'Badagry', 'Epe', 'Ibeju-Lekki', 'Lagos Mainland', 'Ojo'];

export function register(api: Api) {
  const eco = api.economy; const db = api.db;

  // ---------------------------------------------------------------- land
  // Owners inside a box: ?minx&minz&maxx&maxz (metres). The client asks for the area around the LANDMAP and keeps live changes from the socket.
  api.get('/api/world/plots', (req) => {
    const n = (k: string, d: number) => { const v = Number(req.query[k]); return Number.isFinite(v) ? v : d; };
    const rows = req.query.all ? eco.allPlots() : eco.plotsIn(n('minx', -1e9), n('minz', -1e9), n('maxx', 1e9), n('maxz', 1e9));
    return { items: rows.map((r) => ({ id: r.id, owner: r.owner_id, ownerName: r.owner_name })) };
  }, { rate: { limit: 120, windowMs: 60_000 } });
  api.get('/api/world/plots/:id', (req) => {
    const p = eco.plotRow(req.params.id); if (!p) return { id: req.params.id, owner: null, ownerName: null, price: eco.plots.map.get(req.params.id)?.price ?? null };
    return { id: p.id, owner: p.owner_id, ownerName: p.owner_name, price: p.price, boughtAt: p.bought_at };
  });
  api.get('/api/me/plots', (req) => ({ items: eco.plotsOf(req.account!.id).map((p) => ({ id: p.id, pts: p.pts ? JSON.parse(p.pts) : null, price: p.price, boughtAt: p.bought_at })) }), { auth: 'user' });

  // ---------------------------------------------------------------- NIN (National Identification Number), issued at LGA offices
  api.get('/api/nin/me', (req) => {
    const r = one<{ nin: string; full_name: string; lga: string; issued_at: number }>(db, 'SELECT * FROM nin_registry WHERE account_id=?', req.account!.id);
    return r ? { nin: r.nin, fullName: r.full_name, lga: r.lga, issuedAt: r.issued_at } : { nin: null };
  }, { auth: 'user' });
  api.post('/api/nin', (req) => {
    const id = req.account!.id; const prof = api.accounts.profile(id);
    if (!prof) throw new HttpError(400, 'Create your hustler first.');
    if (one(db, 'SELECT 1 FROM nin_registry WHERE account_id=?', id)) throw new HttpError(409, 'You already have a NIN.', { code: 'nin_exists' });
    const lga = LGAS.includes(String(req.body.lga)) ? String(req.body.lga) : 'Ikeja';
    const fee = Math.max(0, Math.min(100000, Math.floor(Number(req.body.fee) || 0)));
    let nin = '';
    for (let i = 0; i < 20; i++) { nin = String(BigInt('0x' + randomBytes(6).toString('hex')) % 100000000000n).padStart(11, '0'); if (!one(db, 'SELECT 1 FROM nin_registry WHERE nin=?', nin)) break; }
    db.transaction(() => {
      if (fee) eco.adjust(id, -fee, 0, 'nin.fee', { ref: lga, silent: false });
      run(db, 'INSERT INTO nin_registry(nin,account_id,full_name,lga,issued_at) VALUES(?,?,?,?,?)', nin, id, prof.name, lga, Date.now());
    })();
    return { nin, fullName: prof.name, lga };
  }, { auth: 'user', rate: { limit: 10, windowMs: 60_000 } });

  // ---------------------------------------------------------------- vehicle registry (register to your name, report stolen, tracker)
  const vrow = (r: Record<string, unknown>) => ({ id: r.id, vkey: r.vkey, kind: r.kind, plate: r.plate, paint: safeJson(r.paint), registeredAt: r.registered_at, stolen: !!r.stolen, stolenAt: r.stolen_at, tracker: !!r.tracker, nin: r.nin });
  api.get('/api/vehicles/mine', (req) => ({ items: all<Record<string, unknown>>(db, 'SELECT * FROM vehicle_registry WHERE owner_id=? ORDER BY registered_at', req.account!.id).map(vrow) }), { auth: 'user' });
  api.post('/api/vehicles/register', (req) => {
    const id = req.account!.id; const b = req.body;
    const vkey = String(b.vkey ?? '').slice(0, 64); const kind = String(b.kind ?? '').slice(0, 20);
    if (!vkey || !kind) throw new HttpError(400, 'vkey and kind are required.');
    const nin = one<{ nin: string }>(db, 'SELECT nin FROM nin_registry WHERE account_id=?', id);
    if (!nin) throw new HttpError(400, 'You need a NIN to register a vehicle.', { code: 'no_nin' });
    if (one(db, 'SELECT 1 FROM vehicle_registry WHERE vkey=?', vkey)) throw new HttpError(409, 'That vehicle is already registered.', { code: 'registered' });
    const count = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM vehicle_registry WHERE owner_id=?', id)!.n;
    if (count >= 25) throw new HttpError(400, 'Vehicle limit reached.');
    let plate = typeof b.plate === 'string' ? b.plate.toUpperCase().replace(/[^A-Z0-9\- ]/g, '').trim().slice(0, 10) : '';
    if (plate && one(db, 'SELECT 1 FROM vehicle_registry WHERE plate=?', plate)) throw new HttpError(409, 'That plate number is taken.', { code: 'plate_taken' });
    if (!plate) plate = genPlate(db);
    const fee = Math.max(0, Math.min(5_000_000, Math.floor(Number(b.fee) || 0)));
    const rid = randomUUID();
    db.transaction(() => {
      if (fee) eco.adjust(id, -fee, 0, 'vehicle.register', { ref: vkey });
      run(db, 'INSERT INTO vehicle_registry(id,vkey,owner_id,nin,kind,plate,paint,registered_at) VALUES(?,?,?,?,?,?,?,?)', rid, vkey, id, nin.nin, kind, plate, JSON.stringify(b.paint ?? {}).slice(0, 2000), Date.now());
    })();
    return vrow(one<Record<string, unknown>>(db, 'SELECT * FROM vehicle_registry WHERE id=?', rid)!);
  }, { auth: 'user', rate: { limit: 20, windowMs: 60_000 } });
  api.post('/api/vehicles/:vkey/stolen', (req) => {
    const r = one<Record<string, unknown>>(db, 'SELECT * FROM vehicle_registry WHERE vkey=? AND owner_id=?', req.params.vkey, req.account!.id);
    if (!r) throw new HttpError(404, 'You do not own that vehicle.');
    run(db, 'UPDATE vehicle_registry SET stolen=?, stolen_at=? WHERE id=?', req.body.stolen === false ? 0 : 1, req.body.stolen === false ? null : Date.now(), r.id);
    return vrow(one<Record<string, unknown>>(db, 'SELECT * FROM vehicle_registry WHERE id=?', r.id)!);
  }, { auth: 'user' });
  api.post('/api/vehicles/:vkey/tracker', (req) => {
    const r = one<Record<string, unknown>>(db, 'SELECT * FROM vehicle_registry WHERE vkey=? AND owner_id=?', req.params.vkey, req.account!.id);
    if (!r) throw new HttpError(404, 'You do not own that vehicle.');
    const fee = Math.max(0, Math.min(1_000_000, Math.floor(Number(req.body.fee) || 0)));
    if (!r.tracker && fee) eco.adjust(req.account!.id, -fee, 0, 'vehicle.tracker', { ref: req.params.vkey });
    run(db, 'UPDATE vehicle_registry SET tracker=1 WHERE id=?', r.id);
    return vrow(one<Record<string, unknown>>(db, 'SELECT * FROM vehicle_registry WHERE id=?', r.id)!);
  }, { auth: 'user' });
  // police / anyone can look up a plate: owner name and stolen status, no account ids
  api.get('/api/vehicles/lookup', (req) => {
    const plate = String(req.query.plate ?? '').toUpperCase().trim();
    const r = one<Record<string, unknown> & { owner_name: string | null }>(db, 'SELECT v.*, p.name AS owner_name FROM vehicle_registry v LEFT JOIN profiles p ON p.account_id=v.owner_id WHERE v.plate=?', plate);
    if (!r) return { found: false };
    return { found: true, plate: r.plate, kind: r.kind, stolen: !!r.stolen, owner: r.owner_name };
  });
}

function safeJson(s: unknown) { try { return JSON.parse(String(s)); } catch { return {}; } }
function genPlate(db: Api['db']): string {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let i = 0; i < 50; i++) {
    const b = randomBytes(6);
    const p = `${L[b[0] % 24]}${L[b[1] % 24]}${L[b[2] % 24]}-${String(((b[3] << 8) | b[4]) % 1000).padStart(3, '0')}${L[b[5] % 24]}${L[(b[5] >> 3) % 24]}`;
    if (!one(db, 'SELECT 1 FROM vehicle_registry WHERE plate=?', p)) return p;
  }
  return randomUUID().slice(0, 8).toUpperCase();
}
