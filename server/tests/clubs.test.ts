import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boot, http, makePlayer, TestClient, type TestServer } from './helpers.ts';
import { BOTTLE_PRICE, COVER, VIP_MIN, VIP_PRICE, coverFor, nightOf, CLUB_RULES, SHUTDOWN_MIN, promoQuote, shiftPay, sprayNet, clubHours, audioKind, cleanTrack, DJ_PAY } from '../../v2/src/net/clubs.ts';

let s: TestServer;
beforeAll(async () => { s = await boot(); });
afterAll(async () => { await s.close(); });
const CLUBS = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../v2/src/data/clubs.json'), 'utf8')) as any[];
const Z = CLUBS.find((c) => c.id === 'zilox');
const mk = async (name: string) => { const p = await makePlayer(s, name); return { ...p, c: await new TestClient(s, p.token).connect() }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const put = async (p: { accountId: string; c: TestClient }, x: number, z: number) => { s.hub.teleport(p.accountId, x, z); await sleep(60); p.c.state(x, z); await sleep(80); };
const K = () => s.hub.clubs!;
/** teleported test clients never send a state the server accepts (it waits for the correction), so mark them in the world */
const tick = () => { for (const c of s.hub.conns.values()) (c as any).haveState = !(c as any).dead; s.hub.clubTick(); };
const wallet = (id: string) => s.api.economy.wallet(id);
/** a tiny file that starts like an MP3 (ID3 tag) */
const fakeMp3 = () => 'data:audio/mpeg;base64,' + Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4000, 7)]).toString('base64');

describe('club rules', () => {
  it('pays more at night and for a fuller room, sniffs audio, cleans tracks, prices promotion', () => {
    const night = clubHours(0) - (clubHours(0) % 24) + 23; const noon = night - 11;
    expect(shiftPay('dj', 0, night)).toBe(DJ_PAY.base); expect(shiftPay('dj', 5, night)).toBe(DJ_PAY.base + 5 * DJ_PAY.perHead);
    expect(shiftPay('dj', 500, night)).toBe(DJ_PAY.base + DJ_PAY.heads * DJ_PAY.perHead); expect(shiftPay('dj', 0, noon)).toBeLessThan(DJ_PAY.base);
    expect(audioKind(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('audio/mpeg');
    expect(audioKind(new TextEncoder().encode('OggS\0\0\0\0\0\0\0\0'))).toBe('audio/ogg');
    expect(audioKind(new TextEncoder().encode('<html><body>'))).toBeNull();
    expect(cleanTrack({ src: 'audius', id: 'abc12', title: '<b>Gbese</b>', artist: 'X', secs: 9999 }, 1)).toMatchObject({ title: 'bGbese/b', secs: 600 });
    expect(cleanTrack({ src: 'audius', id: '../etc', title: 'x' }, 1)).toBeNull(); expect(cleanTrack({ src: 'spotify', id: 'a' }, 1)).toBeNull();
    expect(promoQuote('zilox', 1)!.total).toBe(CLUB_RULES.zilox.promoDay); expect(promoQuote('gele', 2)).toBeNull();
    expect(promoQuote('all', 7)!.total).toBeLessThan(promoQuote('all', 1)!.total * 7);
  });
});

describe('clubs online', () => {
  it('one DJ at a time on the decks, only the DJ picks the song, the house pays by the minute, walking off ends the shift', async () => {
    const dj = await mk('Deejay Dami'); const rival = await mk('Rival Rex');
    await put(dj, Z.dj.x + 40, Z.dj.z); expect((await dj.c.act('club.decks', { club: 'zilox' })).ok).toBe(false);
    await put(dj, Z.dj.x, Z.dj.z + 1); const r = await dj.c.act('club.decks', { club: 'zilox' }); expect(r.err ?? 'ok').toBe('ok'); expect(r.club.dj.name).toBe('Deejay Dami');
    await put(rival, Z.dj.x + 1, Z.dj.z + 1); const r2 = await rival.c.act('club.decks', { club: 'zilox' }); expect(r2.ok).toBe(false); expect(r2.err).toMatch(/Deejay Dami/);
    expect((await rival.c.act('club.play', { club: 'zilox', track: { src: 'audius', id: 'aB12', title: 'Gbedu', artist: 'Somebody', secs: 200 } })).ok).toBe(false);
    const p = await dj.c.act('club.play', { club: 'zilox', track: { src: 'audius', id: 'aB12', title: 'Gbedu', artist: 'Somebody', secs: 200 } });
    expect(p.club.track).toMatchObject({ src: 'audius', id: 'aB12', by: 'Deejay Dami' });
    await rival.c.until(() => rival.c.msgs.some((m) => m.t === 'club' && m.club.track?.id === 'aB12'));
    // a minute on the decks with a crowd of two
    const before = wallet(dj.accountId).cash; const d = K().live.get('zilox')!.dj!; d.paidTo -= 60_000;
    tick(); const got = wallet(dj.accountId).cash - before;
    const want = shiftPay('dj', 2, clubHours(Date.now())); expect(got).toBeGreaterThanOrEqual(want); expect(got).toBeLessThan(want * 1.05);
    // walk off: the shift ends and the house says what it paid
    await put(dj, Z.dj.x + 60, Z.dj.z); tick();
    expect(K().live.get('zilox')!.dj).toBeNull();
    await dj.c.until(() => dj.c.msgs.some((m) => m.t === 'toast' && m.title === 'Off the decks'));
    // nobody on the decks: the house set takes over
    expect(K().live.get('zilox')!.track?.src === 'house' || K().live.get('zilox')!.track?.id === 'aB12').toBe(true);
    dj.c.close(); rival.c.close();
  }, 20000);

  it('pole stage shifts, spraying the workers (the house keeps a cut), no spraying yourself or people who are not working', async () => {
    const dancer = await mk('Stage Sade'); const fan = await mk('Big Spender'); const pole = Z.poles[0];
    s.api.economy.adjust(fan.accountId, 200_000, 0, 'test');
    await put(dancer, pole.x, pole.z + 0.5); const r = await dancer.c.act('club.pole', { club: 'zilox', pole: pole.id }); expect(r.err ?? 'ok').toBe('ok');
    expect(r.club.poles[pole.id].name).toBe('Stage Sade');
    await put(fan, Z.floor.x, Z.floor.z);
    K().admit(fan.accountId, 'zilox', 'guest'); // a wristband, so the test runs the same at any Lagos hour
    const a0 = wallet(fan.accountId).cash, b0 = wallet(dancer.accountId).cash;
    const sp = await fan.c.act('club.spray', { club: 'zilox', to: dancer.accountId, amount: 5000 }); expect(sp.err ?? 'ok').toBe('ok');
    expect(wallet(fan.accountId).cash).toBe(a0 - 5000); expect(wallet(dancer.accountId).cash).toBe(b0 + sprayNet(5000));
    await dancer.c.until(() => dancer.c.msgs.some((m) => m.t === 'spray' && m.amount === 5000));
    expect((await fan.c.act('club.spray', { club: 'zilox', to: dancer.accountId, amount: 777 })).ok).toBe(false);
    await sleep(800); expect((await fan.c.act('club.spray', { club: 'zilox', to: fan.accountId, amount: 1000 })).ok).toBe(false);
    await sleep(800); expect((await fan.c.act('club.spray', { club: 'zilox', to: 'floor', amount: 1000 })).ok).toBe(true);
    // a player sent out of hospital in underwear cannot take a stage
    const L = K(); await expect(async () => L.takePole('x', 'X', 'zilox', Z.poles[1].id, { x: Z.poles[1].x, z: Z.poles[1].z }, true)).rejects.toThrow(/dress/);
    // leaving ends the shift
    const lv = await dancer.c.act('club.leave'); expect(lv.ended.job).toBe('pole'); expect(K().live.get('zilox')!.poles[pole.id]).toBeUndefined();
    dancer.c.close(); fan.c.close();
  }, 20000);

  it('shutting a club down costs big, tells the whole city, makes the bar free, and only one at a time', async () => {
    const boss = await mk('Odogwu Boss'); const other = await mk('Small Boy');
    await put(boss, Z.floor.x, Z.floor.z); await put(other, Z.floor.x + 1, Z.floor.z);
    K().admit(boss.accountId, 'zilox', 'guest'); K().admit(other.accountId, 'zilox', 'guest');
    s.api.economy.adjust(other.accountId, 10_000, 0, 'test');
    const bar = await other.c.act('club.bar'); expect(bar.price).toBe(CLUB_RULES.zilox.bar);
    expect((await boss.c.act('club.shutdown', { club: 'zilox' })).ok).toBe(false); // broke
    s.api.economy.adjust(boss.accountId, 5_000_000, CLUB_RULES.zilox.shutdown, 'test');
    const r = await boss.c.act('club.shutdown', { club: 'zilox' }); expect(r.err ?? 'ok').toBe('ok');
    expect(r.club.shutdown.name).toBe('Odogwu Boss'); expect(r.club.shutdown.until).toBeGreaterThan(Date.now() + (SHUTDOWN_MIN - 1) * 60_000);
    await other.c.until(() => other.c.msgs.some((m) => m.t === 'chat' && /shut down ZILOX/.test(m.text)));
    expect((await other.c.act('club.bar')).price).toBe(0);
    s.api.economy.adjust(other.accountId, 0, CLUB_RULES.zilox.shutdown, 'test');
    const again = await other.c.act('club.shutdown', { club: 'zilox' }); expect(again.ok).toBe(false); expect(again.err).toMatch(/Odogwu Boss/);
    K().live.get('zilox')!.shutdown!.until = Date.now() - 1; tick(); expect(K().view('zilox').shutdown).toBeNull();
    boss.c.close(); other.c.close();
  }, 20000);

  it('songs: owners attest, hear their own, staff clear them, promotion is real money and puts them in rotation', async () => {
    const art = await mk('Artiste Ayo'); const dj = await mk('Crate Digger');
    expect((await http(s, 'POST', '/api/songs', { data: fakeMp3(), title: 'Eko Love', artist: 'Ayo', secs: 180 }, art.token)).status).toBe(400); // no attest
    expect((await http(s, 'POST', '/api/songs', { data: 'data:audio/mpeg;base64,' + Buffer.from('<html>not a song at all</html>').toString('base64'), title: 'x', artist: 'y', secs: 180, attest: true }, art.token)).status).toBe(400);
    const up = await http(s, 'POST', '/api/songs', { data: fakeMp3(), title: 'Eko Love', artist: 'Ayo', secs: 180, attest: true }, art.token);
    expect(up.status).toBe(200); expect(up.json.status).toBe('review'); const id = up.json.id as string;
    expect((await http(s, 'GET', `/api/songs/${id}/audio`)).status).toBe(404); // not cleared: only the owner hears it
    const mine = await http(s, 'GET', `/api/songs/${id}/audio`, undefined, art.token); expect(mine.status).toBe(200); expect(mine.headers.get('content-type')).toBe('audio/mpeg');
    // a DJ cannot play an uncleared song, and it cannot be promoted yet
    await put(dj, Z.dj.x, Z.dj.z); await dj.c.act('club.decks', { club: 'zilox' });
    expect((await dj.c.act('club.play', { club: 'zilox', track: { src: 'song', id, secs: 180 } })).ok).toBe(false);
    expect((await http(s, 'POST', '/api/pay/start', { sku: `song:${id}`, meta: { club: 'zilox', days: 3 } }, art.token)).status).toBe(409);
    await s.api.clubs.review(id, 'approve');
    expect((await http(s, 'GET', `/api/songs/${id}/audio`, undefined, undefined, { range: 'bytes=0-9' })).status).toBe(206);
    // only the owner can promote it, and the server prices it
    expect((await http(s, 'POST', '/api/pay/start', { sku: `song:${id}`, meta: { club: 'zilox', days: 3 } }, dj.token)).status).toBe(404);
    const o = await http(s, 'POST', '/api/pay/start', { sku: `song:${id}`, meta: { club: 'zilox', days: 3 } }, art.token);
    expect(o.status).toBe(200); expect(o.json.amountKobo).toBe(promoQuote('zilox', 3)!.total * 100);
    const paid = await http(s, 'POST', `/api/pay/status/${o.json.ref}/test-complete`, {}, art.token); expect(paid.json.status).toBe('paid');
    expect(K().promoted('zilox').map((x) => x.id)).toContain(id); expect(K().promoted('gele')).toHaveLength(0);
    // the DJ crate lists it first, marked promoted; playing it counts a play
    const crate = await dj.c.act('club.crate', { club: 'zilox' }); expect(crate.list[0]).toMatchObject({ id, promo: true });
    const pl = await dj.c.act('club.play', { club: 'zilox', track: { src: 'song', id, secs: 1 } }); expect(pl.err ?? 'ok').toBe('ok'); expect(pl.club.track).toMatchObject({ title: 'Eko Love', promo: true, secs: 180 });
    expect(K().song(id)!.plays).toBe(1);
    // without a DJ the house drops promoted songs between its own tracks
    await dj.c.act('club.leave'); const L = K().live.get('zilox')!; const seen = new Set<string>();
    for (let i = 0; i < 6; i++) { L.track = null; tick(); seen.add(L.track!.src); }
    expect(seen.has('song')).toBe(true); expect(seen.has('house')).toBe(true);
    // turning a song down refunds its promotion
    await s.api.clubs.review(id, 'reject', 'Sample not cleared'); expect(K().promoted('zilox')).toHaveLength(0);
    const mineAfter = await http(s, 'GET', '/api/songs/mine', undefined, art.token); expect(mineAfter.json.list[0]).toMatchObject({ status: 'rejected', note: 'Sample not cleared' });
    art.c.close(); dj.c.close();
  }, 20000);
});

/** an epoch ms near now when the Lagos clock reads hour h (one game hour is two real minutes) */
const atHour = (h: number) => { const b = Date.now(); return b + (((h - (clubHours(b) % 24)) % 24 + 24) % 24) * 120_000; };

describe('the door and VIP tables', () => {
  it('rules: cover only at night, never during a shutdown; one wristband lasts the whole night', () => {
    const night = clubHours(atHour(23)), late = clubHours(atHour(23) + 8 * 120_000), day = clubHours(atHour(14));
    expect(coverFor('zilox', night, false)).toBe(COVER.zilox); expect(coverFor('zilox', night, true)).toBe(0); expect(coverFor('gele', day, false)).toBe(0);
    expect(nightOf(night)).toBe(nightOf(clubHours(atHour(23) + 4 * 120_000))); // 11pm and 3am are the same night
    expect(nightOf(late)).toBe(nightOf(night)); expect(nightOf(night + 14)).toBe(nightOf(night) + 1);
  });

  it('the bouncer charges cover once a night, turns away people in underwear, staff walk in free but cannot buy, and services need a wristband', async () => {
    const L = K(); const a = (await makePlayer(s, 'Door Dayo')).accountId; const d2 = (await makePlayer(s, 'Day Dupe')).accountId;
    const n = atHour(23); const door = { x: Z.door.x, z: Z.door.z - 2 }, floor = { x: Z.floor.x, z: Z.floor.z };
    expect(() => L.enter(a, 'zilox', 'guest', { x: Z.door.x + 80, z: Z.door.z }, false, n)).toThrow(/bouncer/);
    expect(() => L.enter(a, 'zilox', 'guest', door, true, n)).toThrow(/dress/);
    expect(() => L.enter(a, 'zilox', 'guest', door, false, n)).toThrow(/Cover/); // broke
    s.api.economy.adjust(a, 50_000, 0, 'test'); const c0 = wallet(a).cash;
    // no wristband: the bar, spraying and VIP all send you to the door
    expect(() => L.buyDrink(a, floor, n)).toThrow(/Wristband/);
    expect(() => L.spray(a, 'A', 'zilox', 'floor', 1000, floor, n)).toThrow(/Wristband/);
    expect(L.enter(a, 'zilox', 'staff', door, false, n)).toMatchObject({ pass: 'staff', paid: 0 }); expect(wallet(a).cash).toBe(c0);
    expect(() => L.buyDrink(a, floor, n)).toThrow(/Wristband/); // staff band: here to work, not to drink
    expect(L.enter(a, 'zilox', 'guest', door, false, n)).toMatchObject({ pass: 'guest', paid: COVER.zilox }); expect(wallet(a).cash).toBe(c0 - COVER.zilox);
    expect(L.enter(a, 'zilox', 'guest', door, false, n + 6 * 120_000)).toMatchObject({ paid: 0 }); // still the same night at 5am
    expect(L.buyDrink(a, floor, n).price).toBe(CLUB_RULES.zilox.bar);
    expect(() => L.buyDrink(a, { x: CLUBS.find((c) => c.id === 'gele').floor.x, z: CLUBS.find((c) => c.id === 'gele').floor.z }, n)).toThrow(/Wristband/); // a band is per club
    // by day the door is open
    expect(L.enter(d2, 'gele', 'guest', { x: CLUBS[1].door.x, z: CLUBS[1].door.z }, false, atHour(15))).toMatchObject({ paid: 0 });
  });

  it('VIP: costs big, one table each, the name is on it, bottles for the host only, the table frees itself', async () => {
    const host = await mk('Table Tunde'); const guest = await mk('Guest Gbenga');
    await put(host, Z.floor.x, Z.floor.z); await put(guest, Z.floor.x + 1, Z.floor.z);
    K().admit(host.accountId, 'zilox', 'guest'); K().admit(guest.accountId, 'zilox', 'guest');
    const t1 = Z.vip[0].id, t2 = Z.vip[1].id;
    expect((await host.c.act('club.vip', { club: 'zilox', table: t1 })).ok).toBe(false); // broke
    s.api.economy.adjust(host.accountId, 100_000, VIP_PRICE.zilox + BOTTLE_PRICE.zilox, 'test'); const w0 = wallet(host.accountId);
    const r = await host.c.act('club.vip', { club: 'zilox', table: t1 }); expect(r.err ?? 'ok').toBe('ok');
    expect(r.club.vip[t1]).toMatchObject({ name: 'Table Tunde' }); expect(r.club.vip[t1].until).toBeGreaterThan(Date.now() + (VIP_MIN - 1) * 60_000);
    const w1 = wallet(host.accountId); expect(w0.cash + w0.bank - (w1.cash + w1.bank)).toBe(VIP_PRICE.zilox); expect(w1.cash).toBe(0); // cash first, then bank
    await guest.c.until(() => guest.c.msgs.some((m) => m.t === 'clubfx' && m.kind === 'vip' && m.name === 'Table Tunde'));
    s.api.economy.adjust(guest.accountId, 0, VIP_PRICE.zilox, 'test');
    const taken = await guest.c.act('club.vip', { club: 'zilox', table: t1 }); expect(taken.ok).toBe(false); expect(taken.err).toMatch(/Table Tunde/);
    expect((await host.c.act('club.vip', { club: 'zilox', table: t2 })).err).toMatch(/already have a table/);
    expect((await guest.c.act('club.bottle', { club: 'zilox' })).ok).toBe(false); // not your table
    const L = K().live.get('zilox')!; L.vip[t1].lastBottle -= 60_000;
    const b = await host.c.act('club.bottle', { club: 'zilox' }); expect(b.err ?? 'ok').toBe('ok'); expect(b.bottles).toBe(2);
    expect((await host.c.act('club.bottle', { club: 'zilox' })).err).toMatch(/never finish/);
    await guest.c.until(() => guest.c.msgs.some((m) => m.t === 'clubfx' && m.kind === 'bottle'));
    L.vip[t1].until = Date.now() - 1; tick(); expect(K().view('zilox').vip![t1]).toBeUndefined();
    expect((await guest.c.act('club.vip', { club: 'zilox', table: t1 })).err ?? 'ok').toBe('ok');
    host.c.close(); guest.c.close();
  }, 20000);
});
