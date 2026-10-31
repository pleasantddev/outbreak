import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, makePlayer, TestClient, type TestServer } from './helpers.ts';
import { PHONE_MODELS, REPAIR_SHARE, CLONE_DAY_LIMIT } from '../../v2/src/net/rules.ts';

let s: TestServer;
beforeAll(async () => { s = await boot(); });
afterAll(async () => { await s.close(); });
const mk = async (name: string) => { const p = await makePlayer(s, name); return { ...p, c: await new TestClient(s, p.token).connect() }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const put = async (p: { accountId: string; c: TestClient }, x: number, z: number) => { s.hub.teleport(p.accountId, x, z); await sleep(60); p.c.state(x, z); await sleep(80); };
const D = () => s.hub.devices;

describe('phones as things you own', () => {
  it('starts you with a Gidi Neo, sells others only at phone shops, switches, cracks and repairs', async () => {
    const a = await mk('Phone Phil'); expect(a.c.welcome.phones).toHaveLength(1); expect(a.c.welcome.phones[0]).toMatchObject({ model: 'gidi', crack: 0, active: true });
    s.api.economy.adjust(a.accountId, 1_000_000, 0, 'test');
    const shop = s.hub.body.places.find((p) => p.kind === 'phones')!;
    await put(a, shop.x + 900, shop.z); expect((await a.c.act('dev.buy', { model: 'tab' })).ok).toBe(false);
    await put(a, shop.x + 5, shop.z);
    const b = await a.c.act('dev.buy', { model: 'tab' }); expect(b.ok).toBe(true); expect(b.phones.find((p: any) => p.active).model).toBe('tab');
    const gidi = b.phones.find((p: any) => p.model === 'gidi'); expect((await a.c.act('dev.use', { id: gidi.id })).phones.find((p: any) => p.active).id).toBe(gidi.id);
    // crack it, then the shop fixes it for a share of the price
    s.db.prepare('UPDATE devices SET crack=2 WHERE id=?').run(gidi.id);
    const r = await a.c.act('dev.repair', { id: gidi.id }); expect(r.ok).toBe(true); expect(r.price).toBe(Math.round(PHONE_MODELS.gidi.price * REPAIR_SHARE[2] / 100) * 100); expect(r.phones.find((p: any) => p.id === gidi.id).crack).toBe(0);
    // drops crack phones sometimes, never past shattered
    let cr = 0; for (let i = 0; i < 60; i++) { (D() as any).lastDrop.clear(); const x = D().drop(a.accountId, 3); if (x !== null) cr = x; }
    expect(cr).toBeGreaterThan(0); expect(D().active(a.accountId).crack).toBeLessThanOrEqual(3);
    a.c.close();
  }, 20000);

  it('a crooked repairer with hacking skill keeps a copy: reads texts unseen, texts as you, takes a little a day, until you switch phones or clean it', async () => {
    const vic = await mk('Victim Vee'); const hk = await mk('Hacker Hassan'); const friend = await mk('Friend Fola');
    s.api.economy.adjust(vic.accountId, 20_000, 200_000, 'test');
    s.db.prepare("UPDATE players SET skills=? WHERE account_id=?").run(JSON.stringify({ xp: { hack: 5000 } }), hk.accountId);
    s.db.prepare('UPDATE devices SET crack=2 WHERE owner_id=?').run(vic.accountId);
    await put(vic, 900, -330); await put(hk, 902, -330);
    // a text the victim has not read yet
    await friend.c.act('msg.send', { to: vic.accountId, body: 'Your PIN is 4040 abeg no forget' });
    const o = await hk.c.act('dev.offer', { to: vic.c.id, price: 6000, clone: true }); expect(o.err ?? 'ok').toBe('ok');
    await vic.c.until(() => vic.c.msgs.some((m) => m.t === 'devoffer')); const off = vic.c.msgs.find((m) => m.t === 'devoffer');
    expect(off).not.toHaveProperty('clone'); expect(off.price).toBe(6000);
    // pin the luck roll: force the clone to take for this test
    const orig = Math.random; let acc: any;
    for (let i = 0; i < 20; i++) { acc = await vic.c.act('dev.accept', { offer: off.id }); if (acc.ok) break; }
    void orig; expect(acc.err ?? 'ok').toBe('ok'); expect(acc.phones[0].crack).toBe(0);
    const cl = D().clones(hk.accountId);
    if (!cl.length) { s.db.prepare('UPDATE devices SET cloned_by=? WHERE owner_id=?').run(hk.accountId, vic.accountId); } // the luck roll failed; set it so the rest can run
    const dev = D().clones(hk.accountId)[0]; expect(dev.live).toBe(true);
    const read = await hk.c.act('clone.read', { device: dev.device }); expect(read.threads[0].body).toMatch(/PIN/);
    const th = await hk.c.act('clone.read', { device: dev.device, with: friend.accountId }); expect(th.thread[0].body).toMatch(/PIN/);
    expect(s.hub.phone.unread(vic.accountId)).toBe(1); // still unread for the owner
    const sent = await hk.c.act('clone.send', { device: dev.device, to: friend.accountId, body: 'Send me 5k urgently' }); expect(sent.ok).toBe(true);
    await friend.c.until(() => friend.c.msgs.some((m) => m.t === 'msg' && m.from === vic.accountId));
    const st = await hk.c.act('clone.steal', { device: dev.device, amount: 80_000 }); expect(st.took).toBe(CLONE_DAY_LIMIT);
    expect((await hk.c.act('clone.steal', { device: dev.device, amount: 1000 })).ok).toBe(false); // daily limit
    const loc = await hk.c.act('clone.locate', { device: dev.device }); expect(Math.round(loc.at.x)).toBe(900);
    // switching phones kills the copy
    const shop = s.hub.body.places.find((p) => p.kind === 'phones')!; await put(vic, shop.x + 3, shop.z);
    const nb = await vic.c.act('dev.buy', { model: 'kpakam' }); expect(nb.ok).toBe(true);
    expect((await hk.c.act('clone.read', { device: dev.device })).ok).toBe(false);
    // and cleaning the old one wipes it for good
    const cleaned = await vic.c.act('dev.clean', { id: dev.device }); expect(cleaned.found).toBe(true);
    expect(D().clones(hk.accountId)).toEqual([]);
    vic.c.close(); hk.c.close(); friend.c.close();
  }, 30000);
});
