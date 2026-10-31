// Sports and property. Football pitches, basketball courts and stadiums on the map are ownable venues (ids from the
// map geometry, so every player derives the same ones). The Property Manager app lists anything you own (land, shops,
// venues) for sale yourself or through an agency, which takes a commission, finds NPC buyers over time and can rent it
// out. Property that is not listed shows no price and nobody can buy it. The Sports app books slots, opens fixtures
// with wagers held by the server and joins other players' fixtures. Matches play on their own screen (match.ts).
// Online the server owns all of it (server/src/property.ts, realtime/matches.ts); offline the same rules run on the save.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import { net } from '../../net/client';
import { AREA, SPORT } from '../../world/region';
import { obb, pointInPoly } from '../../world/geo';
import { bizType, plotPriceOf, worldHours } from '../../net/rules';
import { agencyFor, agentStep, askOk, MATCH_WAGERS, SLOT_AHEAD, slotNow, VENUES, venueId, venuePrice, type ListMode, type PropKind, type VenueKind } from '../../net/sports';
import { registerApp } from '../../ui/lifeHud';
import { lifeSystem, type Thing } from '../life';
import type { PieItem } from '../life/pie';
import { spend, earn } from '../money';
import { MatchScreen } from './match';

interface Venue { id: string; kind: VenueKind; name: string; x: number; z: number; L: number; W: number; ang: number; mesh?: THREE.Group; drawn?: string }
interface Owned { kind: PropKind; id: string; value: number; type?: string; fee?: number; earned?: number; listing: Listing | null }
interface Listing { kind: PropKind; id: string; owner: string; ownerName: string; mode: ListMode; agency: string | null; price: number; rent: boolean; log?: { d: number; t: string; n: number }[] }
interface Fixture { key: string; venue: string; slot: number; sport: 'football' | 'basketball'; wager: number; host: string; state: string; kickAt: number; members: { id: string; name: string; side: 0 | 1 }[] }
interface LocalSave { venues: Record<string, { fee: number; earned: number }>; listings: Record<string, Listing & { hour: number; log: { d: number; t: string; n: number }[] }> }
const fmt = (n: number) => '₦' + Math.round(n).toLocaleString();
const short = (n: number) => n >= 1e6 ? `₦${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}m` : n >= 1e3 ? `₦${Math.round(n / 1e3)}k` : fmt(n);
const KIND_NAME: Record<PropKind, string> = { plot: 'Land', biz: 'Shop', venue: 'Venue' };
const hourLabel = (h: number) => { const d = ((h % 24) + 24) % 24; return `${d % 12 || 12}${d < 12 ? 'am' : 'pm'}`; };

class Sports {
  venues = new Map<string, Venue>(); private seen = new Set<string>(); owners = new Map<string, { ownerName: string; fee: number; listed: boolean; mine?: boolean }>();
  mine: Owned[] = []; bookings: { venue: string; slot: number; fee: number }[] = []; market: Listing[] = []; fixtures: Fixture[] = []; myFx: Fixture | null = null;
  match: MatchScreen | null = null; private tab: 'mine' | 'market' = 'mine'; private scanT = 0; private drawT = 0; private gps: { x: number; z: number; label: string } | null = null; private busy = false;
  constructor(private ctx: GameCtx) {}
  get life() { return lifeSystem.api; }
  get S(): LocalSave { return ((this.ctx.save as any).sports ??= { venues: {}, listings: {} }); }
  private hours() { return net.active ? worldHours(net.epochNow) : this.ctx.view.atmo.day * 24 + this.ctx.view.atmo.hour; }

  init() {
    registerApp('Property', 'M3 11l9-7 9 7v9H3zM9 20v-6h6v6M13 8h2', 'linear-gradient(160deg,#10b981,#065f46)', () => this.propHtml());
    registerApp('Sports', 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18M3 12h18M5.6 5.6c3.5 3 3.5 9.8 0 12.8M18.4 5.6c-3.5 3-3.5 9.8 0 12.8', 'linear-gradient(160deg,#f97316,#9a3412)', () => this.sportsHtml());
    (window as any).__sports = this;
  }
  start() {
    this.life?.providers.push(() => this.things());
    net.on('prop', (m: any) => { if (m.kind === 'venue') { if (m.owner) this.owners.set(m.id, { ownerName: m.ownerName, fee: this.owners.get(m.id)?.fee ?? 0, listed: false, mine: m.owner === net.account?.id }); else this.owners.delete(m.id); const v = this.venues.get(m.id); if (v) v.drawn = ''; } void this.refresh(); });
    net.on('fixture', (m: any) => this.onFixture(m));
    net.on('mx', (m: any) => this.match?.onRemote(m.from, m.d));
    net.on('welcome', () => void this.refresh());
    void this.refresh();
  }

  // ---------------------------------------------------------------- server or the local save
  async act(a: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; err?: string; [k: string]: any }> {
    if (net.active) return net.act(a, args);
    return this.offline(a, args);
  }
  private valueOf(kind: PropKind, id: string) {
    if (kind === 'venue') return venuePrice(id);
    if (kind === 'biz') { const b = (this.ctx.save as any).biz?.list?.find((r: any) => r.site === id); return bizType(b?.type ?? '')?.price ?? 0; }
    const p = this.ctx.land.plot(id); return p ? Math.max(1_500_000, plotPriceOf(p.area, p.zone, p.rich, p.cx, p.cz)) : 1_500_000;
  }
  private ownedLocal(): Owned[] {
    const c = this.ctx; const out: Owned[] = [];
    for (const id of c.land.owned()) out.push({ kind: 'plot', id, value: this.valueOf('plot', id), listing: null });
    for (const b of ((c.save as any).biz?.list ?? [])) out.push({ kind: 'biz', id: b.site, type: b.type, value: bizType(b.type)?.price ?? 0, listing: null });
    for (const [id, v] of Object.entries(this.S.venues)) out.push({ kind: 'venue', id, value: venuePrice(id), fee: v.fee, earned: v.earned, listing: null });
    for (const o of out) o.listing = this.S.listings[`${o.kind}|${o.id}`] ?? null;
    return out;
  }
  /** agency listings on the save: rent and NPC buyers, same maths as the server */
  private tickLocal() {
    const h = this.hours();
    for (const [k, l] of Object.entries(this.S.listings)) {
      if (l.mode !== 'agent') continue; const r = agentStep(l, { mode: l.mode, price: l.price, value: this.valueOf(l.kind, l.id), rent: l.rent }, h, Math.random);
      if (r.paid) earn(this.ctx, r.paid, 'reward');
      if (r.sold) { delete this.S.listings[k]; this.releaseLocal(l.kind, l.id); this.ctx.hud.toast('Property sold', `${l.agency} sold your ${KIND_NAME[l.kind].toLowerCase()} for ${fmt(l.price)}. Their 5% is taken.`, 'linear-gradient(160deg,#10b981,#065f46)', 'cash', 5); }
    }
    this.ctx.persist();
  }
  private releaseLocal(kind: PropKind, id: string) {
    const c = this.ctx as any;
    if (kind === 'plot') { const o = c.land.owned() as string[]; const i = o.indexOf(id); if (i >= 0) o.splice(i, 1); }
    else if (kind === 'biz') { const L = c.save.biz?.list as any[] | undefined; if (L) { const i = L.findIndex((r) => r.site === id); if (i >= 0) L.splice(i, 1); } const B = (c.systems.get('business') as any)?.api; if (B) { B.owners.delete(id); B.mine = B.mine.filter((b: any) => b.site !== id); } }
    else { delete this.S.venues[id]; this.owners.delete(id); const v = this.venues.get(id); if (v) v.drawn = ''; }
  }
  private offline(a: string, m: Record<string, unknown>): { ok: boolean; err?: string; [k: string]: any } {
    const c = this.ctx; const kind = String(m.kind ?? '') as PropKind, id = String(m.id ?? '');
    this.tickLocal();
    if (a === 'prop.mine') return { ok: true, list: this.ownedLocal(), bookings: [] };
    if (a === 'prop.market') return { ok: true, list: [] }; // nobody else in a single player Lagos
    if (a === 'venue.all') return { ok: true, list: Object.entries(this.S.venues).map(([vid, v]) => ({ id: vid, ownerName: 'You', fee: v.fee, listed: !!this.S.listings[`venue|${vid}`] })) };
    if (a === 'venue.buy') { if (this.S.venues[id]) return { ok: false, err: 'Already yours.' }; const price = venuePrice(id); if (!spend(c, price)) return { ok: false, err: 'Not enough cash on you.' }; const v = this.venues.get(id); this.S.venues[id] = { fee: VENUES[v?.kind ?? 'pitch'].fee, earned: 0 }; c.persist(); return { ok: true, price }; }
    if (a === 'venue.fee') { const v = this.S.venues[id]; if (!v) return { ok: false, err: 'Not your venue.' }; v.fee = Math.round(Number(m.fee)); c.persist(); return { ok: true, fee: v.fee }; }
    const own = this.ownedLocal().find((o) => o.kind === kind && o.id === id);
    if (a === 'prop.list') {
      if (!own) return { ok: false, err: 'That property is not yours.' }; const mode: ListMode = m.mode === 'agent' ? 'agent' : 'self'; const price = Math.round(Number(m.price));
      if (!askOk(mode, price, own.value)) return { ok: false, err: 'The agency will not list at that price.' };
      const l = { kind, id, owner: 'me', ownerName: 'You', mode, agency: mode === 'agent' ? agencyFor(id) : null, price, rent: mode === 'agent' && !!m.rent, hour: Math.floor(this.hours()), log: [] };
      this.S.listings[`${kind}|${id}`] = l; c.persist(); return { ok: true, listing: l };
    }
    if (a === 'prop.unlist') { delete this.S.listings[`${kind}|${id}`]; c.persist(); return { ok: true }; }
    if (a === 'venue.get') return { ok: true, venue: { id, owner: this.S.venues[id] ? 'me' : null, fee: this.S.venues[id]?.fee ?? 0, bookings: [], info: this.S.venues[id] ? { owned: true, listed: false } : { owned: false, listed: true, price: venuePrice(id), seller: 'Lagos State Sports Commission' } }, fixtures: [] };
    return { ok: false, err: 'You need to be online for that.' };
  }
  async refresh() {
    const v = await this.act('venue.all'); if (v.ok) { this.owners.clear(); for (const x of v.list) this.owners.set(x.id, { ownerName: x.ownerName, fee: x.fee, listed: x.listed }); for (const s of this.venues.values()) s.drawn = ''; }
    const m = await this.act('prop.mine'); if (m.ok) { this.mine = m.list; this.bookings = m.bookings ?? []; for (const o of this.mine) if (o.kind === 'venue') { const w = this.owners.get(o.id); if (w) w.mine = true; } }
    const k = await this.act('prop.market'); if (k.ok) this.market = k.list;
    if (net.active) { const f = await net.act('fx.open'); if (f.ok) this.fixtures = (f as any).list; }
  }

  // ---------------------------------------------------------------- venues from the map
  private scan() {
    for (const [k, r] of this.ctx.store.regions) {
      if (this.seen.has(k)) continue; this.seen.add(k);
      for (const a of r.areas) {
        if (a.kind !== AREA.pitch) continue; const name = a.name ?? '';
        const o = obb(a.pts); const L = o.hl * 2, W = o.hw * 2; if (L < 12) continue;
        let kind: VenueKind | null = null;
        if (/stadium/i.test(name) || (a.sub === SPORT.athletics && L > 90)) kind = 'stadium';
        else if (a.sub === SPORT.soccer && L >= 20) kind = 'pitch';
        else if (a.sub === SPORT.basketball) kind = 'court';
        if (!kind) continue;
        if (kind !== 'stadium' && r.buildings.some((b) => Math.abs(b.cx - o.cx) < 25 && Math.abs(b.cz - o.cz) < 25 && b.area > 0.5 * L * W && pointInPoly(o.cx, o.cz, b.pts))) continue;
        const id = venueId(kind, o.cx, o.cz, L); if (this.venues.has(id)) continue;
        this.venues.set(id, { id, kind, name: name || VENUES[kind].name, x: o.cx, z: o.cz, L, W, ang: o.ang });
      }
    }
  }
  /** a board at the gate: owner or FOR SALE, and the slot fee */
  private draw(v: Venue) {
    const o = this.owners.get(v.id); const key = JSON.stringify(o ?? null); if (v.drawn === key && v.mesh) return; v.drawn = key;
    v.mesh?.removeFromParent(); v.mesh?.traverse((x: any) => { x.geometry?.dispose?.(); x.material?.map?.dispose?.(); x.material?.dispose?.(); });
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const k = cv.getContext('2d')!;
    k.fillStyle = v.kind === 'court' ? '#9a3412' : '#14532d'; k.fillRect(0, 0, 512, 256); k.fillStyle = '#fff'; k.textAlign = 'center'; k.textBaseline = 'middle';
    k.font = '900 44px Oswald, Impact, sans-serif'; k.fillText((v.name.length > 22 ? VENUES[v.kind].name : v.name).toUpperCase(), 256, 58, 490);
    k.font = '700 30px Inter, sans-serif';
    if (!o) { k.fillStyle = '#fde047'; k.fillText('FOR SALE BY LASG SPORTS', 256, 128, 490); k.fillStyle = '#fff'; k.fillText(`${short(venuePrice(v.id))} · free to play`, 256, 186, 490); }
    else { k.fillText(`${o.mine ? 'YOUR' : o.ownerName.toUpperCase() + "'S"} ${v.kind === 'court' ? 'COURT' : 'PITCH'}`, 256, 128, 490); k.fillStyle = '#fde047'; k.fillText(`Book a slot: ${short(o.fee)} / hour`, 256, 186, 490); }
    k.font = '600 20px Inter, sans-serif'; k.fillStyle = 'rgba(255,255,255,.75)'; k.fillText('Press E · Sports app on your phone', 256, 232);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25, side: THREE.DoubleSide })); b.position.y = 2.1; g.add(b);
    for (const x of [-1.1, 1.1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.6 })); p.position.set(x, 1.1, -0.02); g.add(p); }
    const s = this.board(v); g.position.set(s.x, 0, s.z); g.rotation.y = s.yaw; this.ctx.view.scene.add(g); v.mesh = g;
  }
  /** the board stands just outside the long side, facing out */
  private board(v: Venue) { const nx = -Math.sin(v.ang), nz = Math.cos(v.ang); const d = v.W / 2 + 2.6; return { x: v.x + nx * d, z: v.z + nz * d, yaw: Math.atan2(nx, nz) }; }

  // ---------------------------------------------------------------- E at the board
  private things(): Thing[] {
    const me = this.ctx.sim.local; const out: Thing[] = [];
    for (const v of this.venues.values()) {
      const s = this.board(v); if (Math.abs(s.x - me.pos.x) > 5 || Math.abs(s.z - me.pos.z) > 5) continue; const o = this.owners.get(v.id);
      const verb = o ? (o.mine ? `Your ${VENUES[v.kind].name.toLowerCase()}` : `${o.ownerName}'s ${VENUES[v.kind].name.toLowerCase()}`) : `${v.name}`;
      out.push({ id: 'venue', name: verb, x: s.x + Math.sin(s.yaw) * 0.8, z: s.z + Math.cos(s.yaw) * 0.8, yaw: s.yaw, actions: [], kind: 'object', reach: 2.8, verb, open: () => void this.menu(v) });
    }
    return out;
  }
  private async menu(v: Venue) {
    const L = this.life; if (!L || this.busy) return; this.busy = true; const g = await this.act('venue.get', { id: v.id }); this.busy = false;
    if (!g.ok) { this.ctx.hud.toast('Venue', g.err ?? 'Try again.', 'var(--red)', 'msg', 3); return; }
    const info = g.venue.info; const mineV = g.venue.owner && (g.venue.owner === net.account?.id || g.venue.owner === 'me'); const sport = VENUES[v.kind].sport;
    const items: PieItem[] = [{ id: 'play', label: sport === 'football' ? 'Kick ball with the boys (5-a-side vs AI)' : 'Run 3 on 3 with the area boys', hint: 'Practice match, no money' }];
    if (net.active) items.push({ id: 'book', label: 'Book a slot and challenge people', hint: g.venue.owner && !mineV ? `${fmt(g.venue.fee)} an hour to ${g.venue.ownerName}` : 'Opens the Sports app' });
    if (!info.owned) items.push({ id: 'buy', label: `Buy this ${VENUES[v.kind].name.toLowerCase()}`, hint: `From ${info.seller}`, cost: info.price, disabled: this.ctx.sim.cash + (net.active ? net.wallet.bank : 0) < info.price ? 'No money' : undefined });
    else if (mineV) items.push({ id: 'manage', label: 'Manage: slot fee, sell, rent out', hint: 'Property Manager' });
    else if (info.listed) items.push({ id: 'buylisted', label: `Buy from ${info.seller}`, hint: info.mode === 'agent' ? 'Agency listing' : 'Owner is selling', cost: info.price });
    else items.push({ id: 'nope', label: 'Not for sale', hint: `${info.ownerName} has not listed it`, disabled: 'Unlisted' });
    L.pie.show(v.name, info.owned ? (mineV ? 'Yours' : `Owned by ${info.ownerName}`) : 'Public venue', items, { x: innerWidth / 2, y: innerHeight / 2 }, (id) => void this.pick(v, id, info));
  }
  private async pick(v: Venue, id: string, info: any) {
    const c = this.ctx;
    if (id === 'play') { this.practice(v); return; }
    if (id === 'book' || id === 'manage') { c.input.releasePointer(); c.hud.openAppByName(id === 'book' ? 'Sports' : 'Property'); return; }
    if (id === 'buy') { const r = await this.act('venue.buy', { id: v.id }); if (!r.ok) { c.hud.toast('Venue', r.err ?? 'It did not go through.', 'var(--red)', 'msg', 4); return; } c.hud.title('VENUE OWNER', `${v.name} is yours. Set the slot fee in Property Manager.`, 4); await this.refresh(); v.drawn = ''; return; }
    if (id === 'buylisted') { const r = await this.act('prop.buy', { kind: 'venue', id: v.id, price: info.price }); if (!r.ok) { c.hud.toast('Property', r.err ?? 'It did not go through.', 'var(--red)', 'msg', 4); return; } c.hud.title('SOLD TO YOU', `${v.name} for ${fmt(info.price)}.`, 4); await this.refresh(); v.drawn = ''; }
  }

  // ---------------------------------------------------------------- matches
  private dims(v: { kind: VenueKind; L: number; W: number } | null): [number, number] {
    if (!v || v.kind === 'court') return [15, 14];
    if (v.kind === 'stadium') return [46, 28];
    const L = Math.max(30, Math.min(44, v.L)); return [L, Math.max(18, Math.min(26, Math.min(v.W, L * 0.62)))];
  }
  practice(v: Venue | null, sport0?: 'football' | 'basketball') {
    if (this.match) return; const sport = sport0 ?? (v ? VENUES[v.kind].sport : 'football'); const [L, W] = this.dims(v);
    const me = this.ctx.profile?.name || 'You';
    this.match = new MatchScreen(this.ctx, { sport, title: v?.name ?? 'Practice', L, W, stadium: v?.kind === 'stadium', humans: [], me: 'me', host: 'me', online: false, teams: [`${me.split(' ')[0].slice(0, 10)} FC`, sport === 'football' ? 'Area Boys' : 'Ajegunle Ballers'],
      onEnd: (s, quit) => { if (!quit && s[0] > s[1]) { this.ctx.hud.toast('Match', 'You won. Small respect for your name on the street.', 'linear-gradient(160deg,#f97316,#9a3412)', 'cash', 4); (this.ctx as any).grantXp?.(25); } } });
  }
  private onFixture(m: Fixture & { score?: [number, number]; winSide?: number; void?: string; paid?: { id: string; n: number }[] }) {
    const me = net.account?.id; if (!me) return;
    const inIt = m.members.some((x) => x.id === me);
    if (m.state === 'done') {
      this.myFx = null;
      if (m.void) this.ctx.hud.toast('Match', m.void, 'var(--red)', 'msg', 5);
      else if (m.score) { const side = m.members.find((x) => x.id === me)?.side ?? 0; const won = m.winSide === side; const p = m.paid?.find((x) => x.id === me); this.ctx.hud.toast('Full time', `${m.score[0]} : ${m.score[1]}. ${m.winSide === -1 ? 'Draw, stakes back.' : won ? `You won${p ? ` ${fmt(p.n)}` : ''}!` : 'You lost this one.'}`, 'linear-gradient(160deg,#f97316,#9a3412)', 'cash', 5); }
      void this.refresh(); return;
    }
    if (!inIt) return; this.myFx = m;
    if (m.state === 'live' && !this.match) this.startOnline(m);
    this.ctx.hud.refreshApp?.();
  }
  private startOnline(f: Fixture) {
    const me = net.account!.id; const v = this.venues.get(f.venue) ?? null; const [L, W] = this.dims(v);
    const cap = (side: number) => { const h = f.members.find((x) => x.side === side); return h ? `${h.name.split(' ')[0].slice(0, 10)}'s side` : 'Side ' + (side + 1); };
    this.match = new MatchScreen(this.ctx, { sport: f.sport, title: v?.name ?? 'Fixture', L, W, stadium: v?.kind === 'stadium', humans: f.members, me, host: f.host, online: true, teams: [cap(0), cap(1)], wager: f.wager,
      send: (d) => net.send({ t: 'mx', d }),
      onEnd: (s, quit) => { if (quit) void net.act('fx.leave'); else void net.act('fx.report', { sa: s[0], sb: s[1] }); } });
  }

  // ---------------------------------------------------------------- phone: Property Manager
  private propHtml() {
    void this.refresh(); const tabs = `<div class="row"><button class="btn" data-app="Property" data-id="tab:mine">${this.tab === 'mine' ? '● ' : ''}My property</button> <button class="btn" data-app="Property" data-id="tab:market">${this.tab === 'market' ? '● ' : ''}For sale in Lagos</button></div>`;
    if (this.tab === 'market') {
      const list = this.market.filter((l) => l.owner !== net.account?.id && l.owner !== 'me');
      const rows = list.map((l) => `<div class="row"><b>${KIND_NAME[l.kind]} · ${fmt(l.price)}</b>${l.mode === 'agent' ? `Through ${l.agency}` : `Sold by ${l.ownerName}`}<br><button class="btn" data-app="Property" data-id="buy:${l.kind}|${l.id}|${l.price}">Buy</button> <button class="btn" data-app="Property" data-id="gps:${l.kind}|${l.id}">GPS</button></div>`).join('');
      return tabs + (rows || `<div class="row"><b>Nothing on the market</b>${net.active ? 'When other players list land, shops or venues, they show here with the price. Unlisted property has no price and nobody can buy it.' : 'Go online to buy from other players. Offline, agencies still sell your listings to NPC buyers.'}</div>`);
    }
    const rows = this.mine.map((o) => {
      const l = o.listing; const k = `${o.kind}|${o.id}`; const name = o.kind === 'biz' ? bizType(o.type ?? '')?.name ?? 'Shop' : o.kind === 'venue' ? (this.venues.get(o.id)?.name ?? VENUES[o.id.split(':')[1] as VenueKind]?.name ?? 'Venue') : 'Plot of land';
      const status = !l ? '<span style="opacity:.7">Not listed: no price shows, nobody can buy it</span>' : l.mode === 'agent' ? `Listed with ${l.agency} at <b>${fmt(l.price)}</b>${l.rent ? ' · rented out' : ''}` : `For sale by you at <b>${fmt(l.price)}</b>`;
      const log = (l?.log ?? []).slice(-2).reverse().map((x) => `<div style="font-size:11.5px;opacity:.8;margin-top:3px">${x.t}${x.n ? ` <b style="color:#59d98e">+${fmt(x.n)}</b>` : ''}</div>`).join('');
      const extra = o.kind === 'venue' ? `<div style="font-size:12px;margin-top:3px">Slot fee ${fmt(o.fee ?? 0)} · earned ${fmt(o.earned ?? 0)}</div><button class="btn" data-app="Property" data-id="fee:${o.id}:0.8">Fee -20%</button> <button class="btn" data-app="Property" data-id="fee:${o.id}:1.25">Fee +25%</button> ` : '';
      const btns = l ? `<button class="btn" data-app="Property" data-id="unlist:${k}">Take it off the market</button>` :
        `<button class="btn" data-app="Property" data-id="list:${k}|self|1">Sell myself ${short(o.value)}</button> <button class="btn" data-app="Property" data-id="list:${k}|self|1.3">Ask ${short(o.value * 1.3)}</button> <button class="btn" data-app="Property" data-id="list:${k}|agent|1">Agent sells (5%)</button> <button class="btn" data-app="Property" data-id="list:${k}|rent|1">Agent rents it out</button>`;
      return `<div class="row"><b>${name} · worth ${short(o.value)}</b>${status}${log}${extra}<br>${btns}</div>`;
    }).join('');
    return tabs + (rows || `<div class="row"><b>You no get property yet</b>Buy land in the Land app, a shop front with a SHOP TO LET sign, or a pitch or court with a LASG board. Then list it here.</div>`) +
      `<div class="row" style="opacity:.75;font-size:12px">Agencies take 5% when they sell and 15% of rent. They find buyers faster when your price is fair.</div>`;
  }
  // ---------------------------------------------------------------- phone: Sports
  private sportsHtml() {
    void this.refresh(); const me = this.ctx.sim.local; const h = Math.floor(this.hours()); const out: string[] = [];
    const f = this.myFx;
    if (f) {
      const host = f.host === net.account?.id; const sides = [0, 1].map((s) => f.members.filter((m) => m.side === s).map((m) => m.name).join(', ') || 'nobody yet');
      out.push(`<div class="row"><b>Your ${f.sport} match · ${hourLabel(f.slot)}${f.wager ? ` · ${short(f.wager)} a head` : ''}</b>Green: ${sides[0]}<br>Red: ${sides[1]}<br>${f.state === 'open' ? (host ? `<button class="btn" data-app="Sports" data-id="kick">Kick off now</button> ` : '') + `<button class="btn" data-app="Sports" data-id="leave">Leave (stake back)</button>` : 'Live!'}</div>`);
    }
    if (net.active) {
      const open = this.fixtures.filter((x) => x.state === 'open' && !x.members.some((m) => m.id === net.account?.id));
      for (const x of open.slice(0, 6)) { const v = this.venues.get(x.venue); out.push(`<div class="row"><b>${x.sport === 'football' ? 'Football' : 'Basketball'} · ${v?.name ?? 'Venue'} · ${hourLabel(x.slot)}</b>${x.wager ? `${fmt(x.wager)} stake, winners split the pot` : 'Friendly, no stake'} · ${x.members.length} in<br><button class="btn" data-app="Sports" data-id="join:${x.key}:0">Join green</button> <button class="btn" data-app="Sports" data-id="join:${x.key}:1">Join red</button></div>`); }
      for (const b of this.bookings) { const v = this.venues.get(b.venue); const has = f && f.venue === b.venue && f.slot === b.slot; if (has) continue; out.push(`<div class="row"><b>Booked: ${v?.name ?? 'Venue'} · ${hourLabel(b.slot)}${b.slot === h ? ' (now)' : ''}</b>Open a match on it and people can join. Pick the stake:<br>${MATCH_WAGERS.map((w) => `<button class="btn" data-app="Sports" data-id="fx:${b.venue}:${b.slot}:${w}">${w ? short(w) : 'Friendly'}</button>`).join(' ')}</div>`); }
    }
    const near = [...this.venues.values()].sort((a, b) => Math.hypot(a.x - me.pos.x, a.z - me.pos.z) - Math.hypot(b.x - me.pos.x, b.z - me.pos.z)).slice(0, 4);
    for (const v of near) {
      const o = this.owners.get(v.id); const d = Math.round(Math.hypot(v.x - me.pos.x, v.z - me.pos.z));
      const book = net.active ? [h + 1, h + 2, h + 4].filter((s) => s <= h + SLOT_AHEAD).map((s) => `<button class="btn" data-app="Sports" data-id="book:${v.id}:${s}">Book ${hourLabel(s)}</button>`).join(' ') : '';
      out.push(`<div class="row"><b>${v.name} · ${d < 1000 ? d + ' m' : (d / 1000).toFixed(1) + ' km'}</b>${o ? `${o.mine ? 'Yours' : o.ownerName + "'s"} · ${fmt(o.fee)} a slot` : 'Public, free to book'}<br><button class="btn" data-app="Sports" data-id="gps:${v.id}">GPS</button> ${book}</div>`);
    }
    if (!near.length) out.push(`<div class="row"><b>No pitch near here</b>Walk or drive around: pitches and courts show up as the map loads.</div>`);
    out.push(`<div class="row"><b>Practice</b>Quick match against AI, right now.<br><button class="btn" data-app="Sports" data-id="practice:football">Football 5-a-side</button> <button class="btn" data-app="Sports" data-id="practice:basketball">Basketball 3v3</button></div>`);
    return out.join('');
  }
  onAction(app: string, id: string) {
    if (app !== 'Property' && app !== 'Sports') return false; const c = this.ctx; const [op, ...rest] = id.split(':'); const arg = rest.join(':');
    const done = (r: { ok: boolean; err?: string }, okMsg: string) => { if (r.ok) c.hud.toast(app, okMsg, 'linear-gradient(160deg,#10b981,#065f46)', 'msg', 3.5); else c.hud.toast(app, r.err ?? 'Try again.', 'var(--red)', 'msg', 4); void this.refresh().then(() => c.hud.refreshApp()); };
    if (op === 'tab') { this.tab = arg as 'mine' | 'market'; c.hud.refreshApp(); return true; }
    if (op === 'list') { const [kind, pid, mode, mul] = arg.split('|'); const o = this.mine.find((x) => x.kind === kind && x.id === pid); if (!o) return true; const price = Math.round(o.value * Number(mul) / 1000) * 1000;
      void this.act('prop.list', { kind, id: pid, mode: mode === 'rent' ? 'agent' : mode, price, rent: mode === 'rent' }).then((r) => done(r, mode === 'self' ? `Listed at ${fmt(price)}. Other players can see the price now.` : `${agencyFor(pid)} has it${mode === 'rent' ? ' and will find a tenant' : ''}. They take their cut.`)); return true; }
    if (op === 'unlist') { const [kind, pid] = arg.split('|'); void this.act('prop.unlist', { kind, id: pid }).then((r) => done(r, 'Off the market. No price shows now.')); return true; }
    if (op === 'buy') { const [kind, pid, price] = arg.split('|'); void this.act('prop.buy', { kind, id: pid, price: Number(price) }).then((r) => done(r, `Bought for ${fmt(Number(price))}. E don land.`)); return true; }
    if (op === 'fee') { const i = arg.lastIndexOf(':'); const vid = arg.slice(0, i), k = Number(arg.slice(i + 1)); const o = this.mine.find((x) => x.id === vid); void this.act('venue.fee', { id: vid, fee: Math.round((o?.fee ?? 0) * k / 500) * 500 }).then((r) => done(r, 'Slot fee updated.')); return true; }
    if (op === 'gps') { const [kind, pid] = arg.includes('|') ? arg.split('|') : ['venue', arg]; const v = this.venues.get(pid); if (v) this.gps = { x: v.x, z: v.z, label: v.name }; else if (kind === 'plot') { const p = c.land.plot(pid); if (p) this.gps = { x: p.cx, z: p.cz, label: 'Plot' }; } else if (kind === 'biz') { const m = /^s:(-?\d+):(-?\d+)$/.exec(pid); if (m) this.gps = { x: +m[1], z: +m[2], label: 'Shop' }; }
      c.hud.toast('GPS', this.gps ? 'Route set.' : 'That place has not loaded on your map yet.', 'linear-gradient(160deg,#f97316,#9a3412)', 'pin', 3); return true; }
    if (op === 'practice') { c.hud.togglePhone?.(false); this.practice(null, arg as any); return true; }
    if (op === 'book') { const i = arg.lastIndexOf(':'); const vid = arg.slice(0, i), slot = Number(arg.slice(i + 1)); void net.act('venue.book', { id: vid, slot }).then((r) => done(r, `Booked for ${hourLabel(slot)}${(r as any).fee ? `, ${fmt((r as any).fee)} paid` : ''}. Open a match on it.`)); return true; }
    if (op === 'fx') { const p = arg.split(':'); const w = Number(p.pop()), slot = Number(p.pop()), vid = p.join(':'); const v = this.venues.get(vid); const sport = v ? VENUES[v.kind].sport : vid.startsWith('v:court') ? 'basketball' : 'football';
      void net.act('fx.create', { venue: vid, slot, sport, wager: w }).then((r) => { if (r.ok) this.myFx = (r as any).fixture; done(r, `Match open for ${hourLabel(slot)}. Tell your people to join in the Sports app.`); }); return true; }
    if (op === 'join') { const p = arg.split(':'); const side = Number(p.pop()); const key = p.join(':'); void net.act('fx.join', { key, side }).then((r) => { if (r.ok) this.myFx = (r as any).fixture; done(r, 'You are in. Kick-off at the slot time.'); }); return true; }
    if (op === 'kick') { void net.act('fx.start').then((r) => done(r, 'Kick off!')); return true; }
    if (op === 'leave') { void net.act('fx.leave').then((r) => { if (r.ok) this.myFx = null; done(r, 'You left. Stake refunded.'); }); return true; }
    return true;
  }
  goal() { const g = this.gps; if (!g) return null; const me = this.ctx.sim.local; if (Math.hypot(g.x - me.pos.x, g.z - me.pos.z) < 12) { this.gps = null; return null; } return g; }
  blips(out: { x: number; z: number; c: string; r?: number }[]) { for (const v of this.venues.values()) { const o = this.owners.get(v.id); if (o?.mine) out.push({ x: v.x, z: v.z, c: '#f97316', r: 8 }); } }

  frame(dt: number) {
    if (this.match) { this.match.frame(dt); if (this.match.closed) this.match = null; return; }
    this.scanT -= dt; if (this.scanT <= 0) { this.scanT = 2; this.scan(); }
    this.drawT -= dt; if (this.drawT > 0) return; this.drawT = 0.5; const me = this.ctx.sim.local;
    for (const v of this.venues.values()) { const d = Math.max(Math.abs(v.x - me.pos.x), Math.abs(v.z - me.pos.z)); if (d < 180) this.draw(v); else if (v.mesh && d > 240) { v.mesh.removeFromParent(); v.mesh = undefined; v.drawn = ''; } }
  }
}

let SP: Sports | null = null;
export const sportsSystem: GameSystem & { get api(): Sports | null } = {
  id: 'sports', get api() { return SP; },
  init(ctx) { SP = new Sports(ctx); SP.init(); },
  start() { SP?.start(); },
  frame(_c, dt) { SP?.frame(dt); },
  onAction(_c, app, id) { return SP?.onAction(app, id) ?? false; },
  goal() { return SP?.goal() ?? null; },
  blips(_c, out) { SP?.blips(out); },
};
