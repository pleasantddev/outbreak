import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, makePlayer, TestClient, type TestServer } from './helpers.ts';
import { ILLNESSES, HOSPITAL_BILL, TRAITS, luckOf, carrierChance } from '../../v2/src/net/rules.ts';

let s: TestServer;
beforeAll(async () => { s = await boot(); });
afterAll(async () => { await s.close(); });
const mk = async (name: string) => { const p = await makePlayer(s, name); return { ...p, c: await new TestClient(s, p.token).connect() }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const body = () => s.hub.body;
const put = async (p: { accountId: string }, x: number, z: number) => { s.hub.teleport(p.accountId, x, z); await sleep(60); };

describe('luck and karma', () => {
  it('karma pulls the hidden luck; luck makes carrying more likely', () => {
    expect(luckOf(1000, 0.3, 0)).toBeGreaterThan(luckOf(-1000, 0.3, 0) + 90);
    expect(Math.abs(luckOf(0, 0.1, 5e9))).toBeLessThan(31);
    expect(carrierChance(80)).toBeGreaterThan(carrierChance(-80));
  });
});

describe('the body over the network', () => {
  it('rolls traits once, hides luck, karma and what you carry, and spreads between people standing close', async () => {
    const a = await mk('Sneezy Sola'); const b = await mk('Close Kemi'); const far = await mk('Far Funmi');
    const v = a.c.welcome.body; expect(v).toBeTruthy(); expect(v.traits.length).toBeLessThanOrEqual(2); for (const t of v.traits) expect(TRAITS[t as keyof typeof TRAITS]).toBeTruthy();
    expect(v).not.toHaveProperty('karma'); expect(v).not.toHaveProperty('luck');
    expect((await a.c.act('body.me')).body.traits).toEqual(v.traits); // rolled once
    // a carrier feels nothing and is told nothing
    body().infect(a.accountId, 'apollo', Date.now(), true);
    expect(body().view(a.accountId).ill).toEqual([]); expect(body().admin(a.accountId).ill[0]).toMatchObject({ id: 'apollo', carrier: true });
    // standing close for long enough passes it on; far away does not
    const now = Date.now();
    const r = body().tick([{ accountId: a.accountId, x: 0, z: 0, space: '' }, { accountId: b.accountId, x: 1.5, z: 0, space: '' }, { accountId: far.accountId, x: 50, z: 0, space: '' }], now, 1000);
    expect(body().ills(b.accountId).map((i) => i.id)).toEqual(['apollo']); expect(body().ills(far.accountId)).toEqual([]);
    if (!body().ills(b.accountId)[0].carrier) expect(r.changed).toContain(b.accountId);
    // someone in another room does not catch it
    const room = await mk('Indoor Ife');
    body().tick([{ accountId: a.accountId, x: 0, z: 0, space: '' }, { accountId: room.accountId, x: 0.5, z: 0, space: 'casino' }], now, 1000);
    expect(body().ills(room.accountId)).toEqual([]);
    a.c.close(); b.c.close(); far.c.close(); room.c.close();
  }, 20000);

  it('chemists, clinics and labs: the wrong drug does nothing, the right one cures, a test finds what you carry', async () => {
    const p = await mk('Patient Pat'); const chem = body().places.find((x) => x.kind === 'pharmacy')!; const clinic = body().places.find((x) => x.kind === 'clinic')!;
    s.api.economy.adjust(p.accountId, 100_000, 0, 'test');
    body().infect(p.accountId, 'malaria', Date.now(), false); body().infect(p.accountId, 'flu', Date.now(), true);
    await put(p, chem.x + 3, chem.z);
    let v = (await p.c.act('body.me')).body; expect(v.ill).toHaveLength(1); expect(v.ill[0].name).toBeNull(); expect(v.ill[0].symptoms).toContain('fever');
    const wrong = await p.c.act('body.treat', { where: 'pharmacy', drug: 'antacid' }); expect(wrong.ok).toBe(true); expect(wrong.said).toMatch(/Nothing changed/);
    const ease = await p.c.act('body.treat', { where: 'pharmacy', drug: 'paracetamol' }); expect(ease.said).toMatch(/edge off/); expect(ease.body.ill[0].eased).toBe(true);
    const cure = await p.c.act('body.treat', { where: 'pharmacy', drug: 'antimalarial' }); expect(cure.said).toMatch(/worked/); expect(cure.body.ill).toEqual([]);
    // far from a chemist you cannot buy drugs
    await put(p, chem.x + 900, chem.z + 900);
    expect((await p.c.act('body.treat', { where: 'pharmacy', drug: 'ors' })).ok).toBe(false);
    await put(p, clinic.x + 2, clinic.z);
    const test = await p.c.act('body.treat', { where: 'clinic', op: 'test' }); expect(test.said).toMatch(/Flu \(you carry it/);
    const treat = await p.c.act('body.treat', { where: 'clinic', op: 'treat' }); expect(treat.ok).toBe(true); expect(body().ills(p.accountId)).toEqual([]);
    p.c.close();
  }, 20000);

  it('death: the nearest hospital, a bill, and if you cannot pay you leave in your underwear with a debt your earnings pay off', async () => {
    const rich = await mk('Rich Remi'); const broke = await mk('Broke Bayo');
    const gh = body().places.find((x) => x.kind === 'hospital' && /General Hospital/.test(x.name))!;
    s.api.economy.adjust(rich.accountId, 200_000, 0, 'test');
    await put(rich, gh.x + 30, gh.z + 20); await put(broke, gh.x - 30, gh.z);
    const w0 = s.api.economy.wallet(rich.accountId);
    const r = await rich.c.act('body.died'); expect(r.ok).toBe(true); expect(r.hospital.id).toBe(gh.id); expect(r.bill).toBe(HOSPITAL_BILL.general); expect(r.stripped).toBe(false);
    expect(s.api.economy.wallet(rich.accountId).cash).toBe(w0.cash - HOSPITAL_BILL.general);
    expect((await rich.c.act('body.died')).ok).toBe(false); // not twice in a row
    const wb = s.api.economy.wallet(broke.accountId); const have = wb.cash + wb.bank;
    const d = await broke.c.act('body.died'); expect(d.stripped).toBe(true); expect(d.owe).toBe(HOSPITAL_BILL.general - have); expect(d.body.debt).toBe(HOSPITAL_BILL.general - have);
    expect(s.api.economy.wallet(broke.accountId)).toEqual({ cash: 0, bank: 0 });
    // half of the next earnings goes to the debt
    s.api.economy.adjust(broke.accountId, 10_000, 0, 'job.pay'); s.api.economy.emit('income', broke.accountId, 10_000, 'job');
    expect(s.api.economy.wallet(broke.accountId).cash).toBe(5_000); expect(body().view(broke.accountId).debt).toBe(HOSPITAL_BILL.general - have - 5_000);
    // clothes from a market stall
    const mkt = body().places.find((x) => x.kind === 'market')!; await put(broke, mkt.x + 5, mkt.z);
    const dr = await broke.c.act('body.dress'); expect(dr.ok).toBe(true); expect(dr.body.stripped).toBe(false);
    rich.c.close(); broke.c.close();
  }, 20000);

  it('untreated malaria gets worse until you collapse; untreated flu passes and leaves you immune for a while', () => {
    const id = 'x-' + Math.random(); s.api.economy.ensurePlayer; // a bare row is enough for the course of an illness
    const acct = s.api.accounts as any; void acct;
    const b = body(); const now = Date.now();
    const p = { accountId: id, x: 0, z: 0, space: '' };
    s.db.prepare("INSERT INTO accounts(id,email,pw_hash,is_guest,role,created_at,last_login,last_ip) VALUES(?,?,?,0,'player',?,?,?)").run(id, id + '@x.y', 'x', now, now, '');
    b.infect(id, 'malaria', now - (ILLNESSES.malaria.hours + 1) * 120_000, false);
    b.tick([p], now); expect(b.ills(id)[0].sev).toBe(2);
    const ills = b.ills(id); ills[0].at = now - (ILLNESSES.malaria.hours + 1) * 120_000; s.db.prepare('UPDATE player_body SET ill=? WHERE account_id=?').run(JSON.stringify(ills), id);
    const r = b.tick([p], now); expect(r.collapsed).toContain(id);
    b.infect(id, 'flu', now - (ILLNESSES.flu.hours + 1) * 120_000, false); b.tick([p], now);
    expect(b.ills(id).some((i) => i.id === 'flu')).toBe(false); expect(b.infect(id, 'flu', now)).toBe(false);
  });
});
