// Small businesses on real shop fronts (rules in net/rules.ts, run by the server's business.ts).
//   Sites: every 400 m cell with shops may get one site, picked by a hash of the building, so every player finds
//   the same "SHOP TO LET" signs no matter which regions loaded first. The site id carries its street position.
//   On the street: a painted signboard and a roller shutter on the wall. To let: walk up, press E, pick a trade.
//   Yours: collect the till in person, restock, see the books. Somebody else's: buy what they sell, the money goes
//   into their till and they get a text. The phone's Business app lists yours with stock, till, wages and the street log.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from './registry';
import { net } from '../net/client';
import { BIZ_TYPES, BIZ_MAX, bizType, siteId, siteTraffic, worldHours, type BizType } from '../net/rules';
import { registerApp } from '../ui/lifeHud';
import { lifeSystem, type Thing } from './life';
import type { PieItem } from './life/pie';
import { addMoodlet } from './life/needs';
import { G, groups } from '../sim/physics';

interface Site { id: string; x: number; z: number; yaw: number; snapped?: boolean; mesh?: THREE.Group; drawn?: string }
interface Biz { site: string; type: string; owner: string; ownerName: string; stock: number; till: number; debt: number; log: { d: number; t: string; n: number }[]; open: boolean }
const fmt = (n: number) => '₦' + Math.round(n).toLocaleString();
const COL: Record<string, [string, string]> = { kiosk: ['#1d4ed8', '#fde047'], pos: ['#0f766e', '#ffffff'], salon: ['#7c3aed', '#ffffff'], buka: ['#b91c1c', '#fef3c7'], carwash: ['#0369a1', '#e0f2fe'] };
const hash01 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

class Business {
  sites = new Map<string, Site>(); private seenRegions = new Set<string>();
  /** owner and trade of every bought site (public), and my own businesses in full */
  owners = new Map<string, { type: string; ownerName: string }>(); mine: Biz[] = [];
  private scanT = 0; private drawT = 0; private gps: Site | null = null; private busy = false;
  constructor(private ctx: GameCtx) {}
  get life() { return lifeSystem.api; }

  init() {
    registerApp('Business', 'M3 10h18l-2-5H5l-2 5zM5 10v10h14V10M9 20v-5h6v5', 'linear-gradient(160deg,#f59e0b,#b45309)', () => this.html());
    (window as any).__biz = this;
  }
  start() {
    this.life?.providers.push(() => this.things());
    net.on('biz', (m: any) => { this.owners.set(m.site, { type: m.type, ownerName: m.ownerName }); const s = this.sites.get(m.site); if (s) s.drawn = ''; });
    net.on('welcome', () => void this.refresh());
    void this.refresh();
  }
  async refresh() {
    if (!net.active) return;
    const a = await net.act('biz.all'); if (a.ok) { this.owners.clear(); for (const b of (a as any).list) this.owners.set(b.site, { type: b.type, ownerName: b.ownerName }); for (const s of this.sites.values()) s.drawn = ''; }
    const m = await net.act('biz.mine'); if (m.ok) this.mine = (m as any).list;
  }

  // ---------------------------------------------------------------- sites from the map, one per region at most
  private scan() {
    // regions are 2 km; inside each, one candidate per 400 m cell (cells never straddle regions), kept by a hash
    for (const [k, r] of this.ctx.store.regions) {
      if (this.seenRegions.has(k)) continue; this.seenRegions.add(k);
      const best = new Map<string, { b: (typeof r.buildings)[number]; h: number }>();
      for (const b of r.buildings) {
        if (b.dead || b.kind !== 2 || b.area < 70 || b.area > 1600) continue;
        const cell = `${Math.floor(b.cx / 400)},${Math.floor(b.cz / 400)}`; const h = hash01(`${Math.round(b.cx)}:${Math.round(b.cz)}`);
        const cur = best.get(cell); if (!cur || h > cur.h) best.set(cell, { b, h });
      }
      for (const [cell, { b }] of best) {
        if (hash01(cell + ':biz') > 0.5) continue;
        const pts = b.pts; const n = pts.length / 2; let bl = 0, door: { x: number; z: number; yaw: number } | null = null;
        for (let i = 0; i < n; i++) {
          const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1]; const L = Math.hypot(bx - ax, bz - az); if (L < 5 || L <= bl) continue;
          let nx = -(bz - az) / L, nz = (bx - ax) / L; const mx = (ax + bx) / 2, mz = (az + bz) / 2; if ((mx - b.cx) * nx + (mz - b.cz) * nz < 0) { nx = -nx; nz = -nz; }
          bl = L; door = { x: mx + nx * 0.2, z: mz + nz * 0.2, yaw: Math.atan2(nx, nz) };
        }
        if (!door) continue; const id = siteId(door.x, door.z); this.sites.set(id, { id, ...door });
      }
    }
  }
  /** sit the sign on the wall that actually got built (declutter trims footprints a little) */
  private snap(s: Site) {
    const ph = this.ctx.sim.phys; const nx = Math.sin(s.yaw), nz = Math.cos(s.yaw);
    const hit = ph.ray({ x: s.x + nx * 6, y: 1.4, z: s.z + nz * 6 }, { x: -nx, y: 0, z: -nz }, 12, groups(0xffff, G.WORLD));
    if (hit && hit.t > 1) { s.x = hit.point.x + nx * 0.05; s.z = hit.point.z + nz * 0.05; s.mesh?.position.set(s.x, 0, s.z); }
    s.snapped = true;
  }

  // ---------------------------------------------------------------- the shop front: signboard and shutter
  private signTex(s: Site) {
    const o = this.owners.get(s.id); const t = o ? bizType(o.type) : null;
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const k = cv.getContext('2d')!;
    if (!o || !t) {
      k.fillStyle = '#f4f1ea'; k.fillRect(0, 0, 512, 128); k.strokeStyle = '#1b1b1b'; k.lineWidth = 6; k.strokeRect(5, 5, 502, 118);
      k.fillStyle = '#c1121f'; k.font = '900 58px Oswald, Rajdhani, Impact, sans-serif'; k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillText('SHOP TO LET', 256, 52);
      k.fillStyle = '#1b1b1b'; k.font = '700 24px Inter, sans-serif'; k.fillText('ENQUIRIES: 0800 HUSTLE', 256, 100);
    } else {
      const [bg, fg] = COL[t.id] ?? ['#111', '#fff']; k.fillStyle = bg; k.fillRect(0, 0, 512, 128);
      k.fillStyle = 'rgba(255,255,255,.12)'; k.fillRect(0, 0, 512, 8); k.fillStyle = fg; k.textAlign = 'center'; k.textBaseline = 'middle';
      const who = `${o.ownerName.toUpperCase()}'S`; k.font = '800 30px Inter, sans-serif'; k.fillText(who.length > 22 ? who.slice(0, 21) + '…' : who, 256, 34);
      k.font = '900 50px Oswald, Rajdhani, Impact, sans-serif'; k.fillText(t.sign, 256, 86, 490);
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
  }
  private draw(s: Site) {
    const key = JSON.stringify(this.owners.get(s.id) ?? null) + this.isOpen(s); if (s.drawn === key && s.mesh) return; s.drawn = key;
    s.mesh?.removeFromParent(); s.mesh?.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
    const g = new THREE.Group(); const tex = this.signTex(s);
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.86, 0.08), [0, 1, 2, 3].map(() => new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 })).concat([new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.65 }), new THREE.MeshStandardMaterial({ color: 0x2a2a2a })]) as any);
    board.position.set(0, 3.25, 0.1); board.name = 'board'; g.add(board);
    for (const x of [-1.5, 1.5]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.5 })); p.position.set(x, 3.6, 0.06); g.add(p); }
    // roller shutter: down when shut or to let, rolled up over a warm lit shop when open
    const open = this.isOpen(s); const h = open ? 0.55 : 2.5;
    const sh = new THREE.Mesh(new THREE.BoxGeometry(2.6, h, 0.06), new THREE.MeshStandardMaterial({ color: 0x8d949b, metalness: 0.55, roughness: 0.45 })); sh.position.set(0, 2.75 - h / 2, 0.05); g.add(sh);
    for (let i = 0; i < Math.round(h / 0.12); i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.015, 0.075), new THREE.MeshStandardMaterial({ color: 0x5f666d })); r.position.set(0, 2.75 - i * 0.12 - 0.06, 0.06); g.add(r); }
    if (open) { const inside = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), new THREE.MeshBasicMaterial({ color: 0xffc98a, toneMapped: false })); inside.position.set(0, 1.1, 0.03); inside.name = 'glow'; g.add(inside); }
    g.position.set(s.x, 0, s.z); g.rotation.y = s.yaw; this.ctx.view.scene.add(g); s.mesh = g;
  }
  private isOpen(s: Site) {
    const o = this.owners.get(s.id); if (!o) return false; const t = bizType(o.type); if (!t) return false;
    const mine = this.mine.find((b) => b.site === s.id); if (mine) return mine.open;
    const h = this.hour(); return h >= t.open[0] && h < t.open[1];
  }
  private hour() { return net.active ? worldHours(net.epochNow) % 24 : this.ctx.view.atmo.hour; }

  // ---------------------------------------------------------------- street interactions (through the life system's E list)
  private things(): Thing[] {
    const me = this.ctx.sim.local; const out: Thing[] = [];
    for (const s of this.sites.values()) {
      if (Math.abs(s.x - me.pos.x) > 4 || Math.abs(s.z - me.pos.z) > 4) continue;
      const o = this.owners.get(s.id); const t = o ? bizType(o.type) : null; const mine = this.mine.find((b) => b.site === s.id);
      const verb = !o ? 'Shop to let' : mine ? `Your ${t?.name ?? 'shop'} · till ${fmt(mine.till)}` : `${o.ownerName}'s ${t?.name ?? 'shop'}`;
      out.push({ id: 'biz', name: verb, x: s.x + Math.sin(s.yaw) * 0.8, z: s.z + Math.cos(s.yaw) * 0.8, yaw: s.yaw, actions: [], kind: 'object', reach: 2.6, verb, open: () => void this.menu(s) });
    }
    return out;
  }
  private async menu(s: Site) {
    const L = this.life; if (!L || this.busy) return; const c = this.ctx;
    if (!net.active) { c.hud.toast('Business', 'Shops are run on the server. Play online to own one.', 'var(--pur)', 'msg', 4); return; }
    const o = this.owners.get(s.id);
    if (!o) {
      const items: PieItem[] = BIZ_TYPES.map((t) => ({ id: t.id, label: t.name, hint: `${fmt(t.gross * siteTraffic(s.id))}/day before wages`, cost: t.price, disabled: this.mine.length >= BIZ_MAX ? `Max ${BIZ_MAX}` : c.sim.cash < t.price ? 'No money' : undefined }));
      L.pie.show('Shop to let', `Foot traffic ${Math.round(siteTraffic(s.id) * 100)}% · pick a trade`, items, { x: innerWidth / 2, y: innerHeight / 2 }, (id) => void this.buy(s, id));
      return;
    }
    this.busy = true; const g = await net.act('biz.get', { site: s.id }); this.busy = false; const b = (g as any).biz as Biz | null; const t = bizType(o.type)!;
    if (!g.ok || !b) { c.hud.toast('Business', g.err ?? 'Try again.', 'var(--red)', 'msg', 3); return; }
    if (b.owner === net.account?.id) {
      const goods = Math.round(t.restock * (100 - b.stock) / 100) + b.debt;
      const items: PieItem[] = [
        { id: 'collect', label: `Collect the till`, hint: `${fmt(b.till)} of ${fmt(t.till)}`, disabled: b.till <= 0 ? 'Empty' : undefined },
        { id: 'restock', label: b.debt > 0 ? 'Pay staff and restock' : 'Restock the shelves', hint: `Stock ${b.stock}%${b.debt ? `, wages owed ${fmt(b.debt)}` : ''}`, cost: goods, disabled: goods <= 0 ? 'Full' : c.sim.cash < goods ? 'No money' : undefined },
        { id: 'books', label: 'Check the books', hint: 'Phone · Business' },
      ];
      L.pie.show(`${t.name}`, b.open ? 'Open for business' : b.debt >= t.upkeep * 3 ? 'Shut: staff on strike' : b.stock <= 0 ? 'Shut: empty shelves' : `Shut till ${t.open[0]}:00`, items, { x: innerWidth / 2, y: innerHeight / 2 }, (id) => void this.ownerAct(s, id));
      return;
    }
    const pos = t.id === 'pos';
    const items: PieItem[] = [{ id: 'buy', label: pos ? 'Cash out ₦5,000 from your bank' : t.sells.label, hint: pos ? '₦300 charge goes to the agent' : `${o.ownerName}'s shop`, cost: t.sells.price, disabled: !b.open ? 'Closed' : pos ? (net.wallet.bank < 5_300 ? 'Bank too low' : undefined) : c.sim.cash < t.sells.price ? 'No money' : undefined }];
    L.pie.show(`${o.ownerName}'s ${t.name}`, b.open ? 'Open' : 'Closed right now', items, { x: innerWidth / 2, y: innerHeight / 2 }, () => void this.serve(s, t));
  }
  private async buy(s: Site, type: string) {
    const c = this.ctx; const t = bizType(type)!; const r = await net.act('biz.buy', { site: s.id, type });
    if (!r.ok) { c.hud.toast('Business', r.err ?? 'It did not go through.', 'var(--red)', 'msg', 4); return; }
    this.owners.set(s.id, { type, ownerName: net.name || 'You' }); this.mine.push((r as any).biz); s.drawn = '';
    c.hud.title('BUSINESS OWNER', `${t.name}. Keep it stocked, wages go out at 6pm.`, 4);
    const L = this.life; if (L) addMoodlet(L.needs, 'biz', 'Became a business owner', 12, 18);
  }
  private async ownerAct(s: Site, id: string) {
    const c = this.ctx;
    if (id === 'books') { c.input.releasePointer(); c.hud.openAppByName('Business'); return; }
    const r = await net.act(id === 'collect' ? 'biz.collect' : 'biz.restock', { site: s.id });
    if (!r.ok) { c.hud.toast('Business', r.err ?? 'Try again.', 'var(--red)', 'msg', 3.5); return; }
    const b = (r as any).biz as Biz; this.mine = this.mine.map((x) => (x.site === b.site ? b : x)); s.drawn = '';
    if (id === 'collect') c.hud.toast('Till', `${fmt((r as any).amount)} collected.`, 'linear-gradient(160deg,#59d98e,#14a05a)', 'cash', 4);
    else c.hud.toast('Restocked', `Shelves full${(r as any).cost ? ` for ${fmt((r as any).cost)}` : ''}.`, 'linear-gradient(160deg,#f59e0b,#b45309)', 'cash', 3.5);
  }
  private async serve(s: Site, t: BizType) {
    const c = this.ctx; const r = await net.act('biz.serve', { site: s.id });
    if (!r.ok) { c.hud.toast(t.name, r.err ?? 'Try again.', 'var(--red)', 'msg', 3.5); return; }
    const L = this.life; if (!L) return; const it = t.sells;
    if (t.id === 'pos') { c.hud.toast('POS', '₦5,000 cash in hand. ₦300 charge.', 'linear-gradient(160deg,#59d98e,#14a05a)', 'cash', 3.5); return; }
    L.doAction({ id: 'biz', label: it.label, gain: {}, minutes: 0, clip: t.id === 'buka' || t.id === 'kiosk' ? 'Idle_Loop' : 'Idle_Loop', spot: [0, 0, 0], secs: it.mins * 3, give: it.gain } as any, { name: t.name, x: s.x + Math.sin(s.yaw) * 1.2, z: s.z + Math.cos(s.yaw) * 1.2, yaw: s.yaw + Math.PI });
    if (t.id === 'salon') addMoodlet(L.needs, 'freshcut', 'Fresh cut', 8, 24);
  }

  // ---------------------------------------------------------------- phone app
  private html() {
    if (!net.active) return `<div class="row"><b>Offline</b>Businesses live on the server. Play online to buy a shop.</div>`;
    void this.refresh();
    const day = Math.floor(worldHours(net.epochNow) / 24);
    const rows = this.mine.map((b) => {
      const t = bizType(b.type)!; const log = b.log.slice(-3).reverse().map((l) => `<div style="font-size:11.5px;opacity:.8;margin-top:3px">${l.d === day ? 'Today' : l.d === day - 1 ? 'Yesterday' : `Day ${l.d}`} · ${l.t}${l.n ? ` <b style="color:${l.n > 0 ? '#59d98e' : '#ff8a94'}">${l.n > 0 ? '+' : ''}${fmt(l.n)}</b>` : ''}</div>`).join('');
      const bar = `<div style="height:5px;border-radius:3px;background:rgba(255,255,255,.1);margin-top:6px;overflow:hidden"><i style="display:block;height:100%;width:${b.stock}%;background:${b.stock < 25 ? '#ff4d5e' : 'linear-gradient(90deg,#f59e0b,#2de0c8)'}"></i></div>`;
      return `<div class="row"><b>${t.name} · ${b.open ? 'open' : 'shut'}</b>Till ${fmt(b.till)} of ${fmt(t.till)} · stock ${b.stock}%${b.debt ? ` · <span style="color:#ff8a94">wages owed ${fmt(b.debt)}</span>` : ''}${bar}${log}
        <br><button class="btn" data-app="Business" data-id="gps:${b.site}">GPS</button> <button class="btn" data-app="Business" data-id="restock:${b.site}">Restock (delivery +15%)</button></div>`;
    }).join('');
    const me = this.ctx.sim.local; const free = [...this.sites.values()].filter((s) => !this.owners.has(s.id)).sort((a, b) => Math.hypot(a.x - me.pos.x, a.z - me.pos.z) - Math.hypot(b.x - me.pos.x, b.z - me.pos.z)).slice(0, 3);
    const tolet = free.map((s) => `<div class="row"><b>Shop to let · ${Math.round(Math.hypot(s.x - me.pos.x, s.z - me.pos.z))} m</b>Foot traffic ${Math.round(siteTraffic(s.id) * 100)}%<br><button class="btn" data-app="Business" data-id="gps:${s.id}">GPS</button></div>`).join('');
    return (rows || `<div class="row"><b>No business yet</b>Look for SHOP TO LET signs on shop fronts. A kiosk is ₦250,000; a car wash is ₦2.5m. Wages and light go out at 6pm every day.</div>`) + tolet;
  }
  onAction(app: string, id: string) {
    if (app !== 'Business') return false; const c = this.ctx;
    const [op, site] = [id.split(':')[0], id.slice(id.indexOf(':') + 1)];
    if (op === 'gps') { const s = this.sites.get(site); if (s) { this.gps = s; c.hud.toast('GPS', 'Route set to the shop.', 'linear-gradient(160deg,#f59e0b,#b45309)', 'pin', 3); } return true; }
    if (op === 'restock') void net.act('biz.restock', { site }).then((r) => { if (r.ok) { const b = (r as any).biz as Biz; this.mine = this.mine.map((x) => (x.site === b.site ? b : x)); c.hud.toast('Restocked', `Delivered for ${fmt((r as any).cost)}.`, 'linear-gradient(160deg,#f59e0b,#b45309)', 'cash', 3.5); c.hud.refreshApp(); } else c.hud.toast('Business', r.err ?? 'Try again.', 'var(--red)', 'msg', 3); });
    return true;
  }
  goal() { const s = this.gps; if (!s) return null; const me = this.ctx.sim.local; if (Math.hypot(s.x - me.pos.x, s.z - me.pos.z) < 8) { this.gps = null; return null; } return { x: s.x, z: s.z, label: 'Shop' }; }
  blips(out: { x: number; z: number; c: string; r?: number }[]) { for (const b of this.mine) { const s = this.sites.get(b.site); if (s) out.push({ x: s.x, z: s.z, c: '#f59e0b', r: 8 }); } }

  frame(dt: number) {
    this.scanT -= dt; if (this.scanT <= 0) { this.scanT = 2; this.scan(); }
    this.drawT -= dt; const me = this.ctx.sim.local;
    if (this.drawT <= 0) {
      this.drawT = 0.5;
      for (const s of this.sites.values()) {
        const d = Math.max(Math.abs(s.x - me.pos.x), Math.abs(s.z - me.pos.z));
        if (d < 160) { this.draw(s); if (!s.snapped && d < 90) this.snap(s); }
        else if (s.mesh && d > 220) { s.mesh.removeFromParent(); s.mesh = undefined; s.drawn = ''; }
      }
      // signs light up at night
      const h = this.ctx.view.atmo.hour; const night = h >= 18.5 || h < 6.5 ? 0.85 : 0;
      for (const s of this.sites.values()) { const b = s.mesh?.getObjectByName('board') as THREE.Mesh | undefined; if (b) { const m = (b.material as THREE.MeshStandardMaterial[])[4]; if (m) m.emissiveIntensity = night * (this.owners.has(s.id) ? 1 : 0.35); } }
    }
  }
}

let B: Business | null = null;
export const businessSystem: GameSystem & { get api(): Business | null } = {
  id: 'business', get api() { return B; },
  init(ctx) { B = new Business(ctx); B.init(); },
  start() { B?.start(); },
  frame(_c, dt) { B?.frame(dt); },
  onAction(_c, app, id) { return B?.onAction(app, id) ?? false; },
  goal() { return B?.goal() ?? null; },
  blips(_c, out) { B?.blips(out); },
};
