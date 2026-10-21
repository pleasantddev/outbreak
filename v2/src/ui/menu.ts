// Lobby, Operators, Armory, Dossier and Settings screens.
import { ARCHETYPES, WEAPONS, ATTACHMENTS, type ArchetypeId, type WeaponId, type AttachmentSlot } from '../data/balance';
import { PALETTE, PATTERNS, TOPS, HEADGEAR, HAIRS, SKIN_TONES, WEAPON_SKINS, type CharacterLook } from '../data/cosmetics';
import { saveProfile, currentOperator, levelOf, type Profile } from '../data/profile';
import { LORE, LOADING_TIPS } from '../data/copy';
import type { MenuScene } from '../render/menuScene';
import { audio } from '../audio/audio';

const SKIN_LEVEL: Record<string, number> = { night: 3, blood: 5, bone: 7, gold: 10 };
const h = (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((a, str, i) => a + str + (i < v.length ? String(v[i]) : ''), '');

export class Menu {
  root: HTMLElement;
  p: Profile;
  scene: MenuScene;
  screen: 'lobby' | 'operators' | 'armory' | 'dossier' | 'settings' = 'lobby';
  opTab = 'body';
  weapon: WeaponId = 'ar';
  onPlay: () => void;
  private dragging = false;
  private lastX = 0;

  constructor(root: HTMLElement, profile: Profile, scene: MenuScene, onPlay: () => void) {
    this.root = root; this.p = profile; this.scene = scene; this.onPlay = onPlay;
    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('mouseover', (e) => { if ((e.target as HTMLElement).closest('button')) audio.ui('hover'); });
    root.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).classList.contains('stage')) { this.dragging = true; this.lastX = e.clientX; } });
    window.addEventListener('pointermove', (e) => { if (this.dragging) { this.scene.dragYaw += (e.clientX - this.lastX) * 0.01; this.lastX = e.clientX; } });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    root.addEventListener('input', (e) => this.input(e));
    this.render();
  }

  private get op() { return currentOperator(this.p); }
  private save() { saveProfile(this.p); }

  render() {
    const op = this.op;
    const lv = levelOf(this.p.xp);
    const wl = this.p.armory[this.weapon];
    this.scene.setShot(this.screen === 'operators' ? 'operator' : this.screen === 'armory' ? 'armory' : 'lobby');
    const arch = ARCHETYPES[this.p.archetype];
    this.scene.setLook(op.look, this.screen === 'armory' ? null : arch.primary, { ...this.p.armory[arch.primary] });
    if (this.screen === 'armory') this.scene.showWeapon(this.weapon, wl); else this.scene.showWeapon(null);

    const top = h`
      <div class="topbar">
        <div class="season">Season 1 / The Awakening</div>
        <div class="spacer"></div>
        <div class="currency">₦ ${this.p.naira.toLocaleString()}</div>
        <div class="profile"><div class="lvl">${lv.level}</div><div><div class="name">${esc(this.p.callsign)}</div><div class="xpbar"><i style="width:${(lv.progress * 100).toFixed(0)}%"></i></div></div></div>
      </div>`;
    let body = '';
    if (this.screen === 'lobby') {
      body = h`
        <div class="logo"><div class="word">NIGHT<span class="red">FALL</span><span class="drip" style="left:62%"></span><span class="drip" style="left:81%;animation-delay:1.7s"></span></div>
          <div class="sub">Lagos was already dangerous. Then something woke up.</div></div>
        <nav class="nav">
          ${[['play', 'Play'], ['operators', 'Operators'], ['armory', 'Armory'], ['dossier', 'Dossier'], ['settings', 'Settings']].map(([id, t], i) => h`<button data-go="${id}" class="${i === 0 ? 'active' : ''}"><span class="brush"></span><span class="n">0${i + 1}</span><span class="t">${t}</span></button>`).join('')}
        </nav>
        <div class="modecard panel cut ticks">
          <div class="label">Battle Royale / Prototype</div>
          <div class="title">Oshodi: Night of the Heart</div>
          <div class="row"><span class="tag">Solo</span><span class="tag dim">12 Survivors</span><span class="tag dim">${this.p.settings.matchMinutes} Min</span><span class="tag sodium">The Heart</span></div>
          <div class="desc">Loot the terminal, the market and the flyover. When the Heart wakes, take it to an extraction point, or hunt whoever has it.</div>
          <div class="label" style="margin-top:14px">Archetype</div>
          <div class="archchips">${(Object.keys(ARCHETYPES) as ArchetypeId[]).map((a) => h`<button data-arch="${a}" class="${this.p.archetype === a ? 'on' : ''}">${ARCHETYPES[a].name}</button>`).join('')}</div>
          <div class="perk">${arch.perk}</div>
        </div>
        <button class="playbtn" data-go="play"><span class="big">DEPLOY</span><span class="small">${esc(op.name.split(' ')[0])}<br>${arch.name} / ${WEAPONS[arch.primary].name}</span></button>
        <div class="squad">
          <div class="slot panel cut"><div class="label">You</div><div class="op">${esc(op.name.split('"')[0])}</div></div>
          <div class="slot panel cut empty"><div class="label">Squad</div><div class="op">Solo only</div></div>
        </div>
        <div class="ticker"><span>${LOADING_TIPS.join('   /   ')}   /   ${LORE.map((l) => l.title + ': ' + l.body).join('   /   ')}</span></div>`;
    } else if (this.screen === 'operators') {
      body = h`<div class="screen">
        <div class="col left">
          <button class="back" data-go="lobby">&#8592; Lobby</button>
          <h2>Operators</h2>
          <div class="label">Choose who you drop as</div>
          <div style="margin-top:12px">${this.p.operators.map((o) => h`<button class="opcard ${o.id === op.id ? 'on' : ''}" data-op="${o.id}"><div class="nm">${esc(o.name)}</div><div class="ar">${ARCHETYPES[o.archetype].name} specialist</div></button>`).join('')}</div>
          <p class="bio">${esc(op.bio)}</p>
          <div class="optrow"><div class="label">Callsign</div><input data-callsign value="${esc(this.p.callsign)}" maxlength="16" style="width:100%;margin-top:8px;padding:10px;background:rgba(232,224,208,0.05);border:1px solid var(--line2);color:var(--bone);font-family:var(--display);letter-spacing:0.1em;text-transform:uppercase"></div>
        </div>
        <div class="col stage" style="position:relative;cursor:grab"><div class="preview-hint">Drag to turn</div></div>
        <div class="col right">
          <div class="label">Customize</div>
          <div class="tabs">${['body', 'head', 'top', 'bottom', 'gear', 'marks'].map((t) => h`<button data-optab="${t}" class="${this.opTab === t ? 'on' : ''}">${t}</button>`).join('')}</div>
          ${this.opPanel(op.look)}
        </div>
      </div>`;
    } else if (this.screen === 'armory') {
      const w = WEAPONS[this.weapon];
      const slots: AttachmentSlot[] = ['optic', 'muzzle', 'mag', 'grip'];
      body = h`<div class="screen">
        <div class="col left">
          <button class="back" data-go="lobby">&#8592; Lobby</button>
          <h2>Armory</h2>
          <div class="label">Your skins and attachments follow you onto any gun you pick up in the city</div>
          <div class="weaplist" style="margin-top:14px">${(Object.keys(WEAPONS) as WeaponId[]).map((id) => h`<button class="${id === this.weapon ? 'on' : ''}" data-weapon="${id}"><span class="wn">${WEAPONS[id].name}</span><span class="wc">${WEAPONS[id].slot}</span></button>`).join('')}</div>
        </div>
        <div class="col stage" style="position:relative;cursor:grab"><div class="preview-hint">Drag to turn</div></div>
        <div class="col right">
          <div class="label">${w.slot} / ${w.ammo} ammo</div>
          <h2 style="font-size:28px">${w.name}</h2>
          ${this.stats(this.weapon)}
          <div class="label" style="margin-top:18px">Finish</div>
          <div class="chips">${WEAPON_SKINS.map((s) => { const need = SKIN_LEVEL[s.id] ?? 0; const locked = lv.level < need; return h`<button data-skin="${s.id}" class="${wl.skin === s.id ? 'on' : ''}" ${locked ? 'disabled' : ''}>${s.name}${locked ? h` <span class="lock">Lv${need}</span>` : ''}</button>`; }).join('')}</div>
          ${this.weapon === 'machete' ? '' : slots.map((slot) => {
            const opts = ATTACHMENTS.filter((a) => a.slot === slot && a.fits.includes(this.weapon));
            if (!opts.length) return '';
            const cur = wl[slot];
            const curDef = opts.find((a) => a.id === cur);
            return h`<div class="attslot"><div class="s">${slot}</div><div class="chips"><button data-att="${slot}:" class="${!cur ? 'on' : ''}">None</button>${opts.map((a) => h`<button data-att="${slot}:${a.id}" class="${cur === a.id ? 'on' : ''}">${a.name}</button>`).join('')}</div>${curDef ? h`<div class="tradeoff">${curDef.desc}</div>` : ''}</div>`;
          }).join('')}
          <div class="chips" style="margin-top:12px"><button data-charm class="${wl.charm ? 'on' : ''}">Blood charm</button></div>
        </div>
      </div>`;
    } else if (this.screen === 'dossier') {
      body = h`<div class="screen" style="grid-template-columns:1fr;overflow-y:auto;background:rgba(6,5,7,0.88)">
        <div class="dossier">
          <button class="back" data-go="lobby">&#8592; Lobby</button>
          <h2>Dossier</h2>
          <div class="label" style="margin-bottom:18px">Recovered notes / Oshodi sector</div>
          ${LORE.map((l) => h`<article><h3>${l.title}</h3><p>${l.body}</p></article>`).join('')}
          <article><h3>How to win</h3><p>Carry the Heart into an open extraction and hold it for thirty seconds. If nobody gets it out, the last survivor wins. Finish your secret contract and you can slip out alone through any extraction.</p></article>
          <article><h3>Controls</h3><div class="keys">
            <div><kbd>WASD</kbd>Move</div><div><kbd>Mouse</kbd>Look, <kbd>LMB</kbd>Fire, <kbd>RMB</kbd>Aim</div>
            <div><kbd>Shift</kbd>Sprint / Horn</div><div><kbd>Space</kbd>Jump, vault, handbrake</div>
            <div><kbd>C</kbd>Crouch</div><div><kbd>R</kbd>Reload</div>
            <div><kbd>E</kbd>Pick up, enter or leave vehicles, take the Heart</div><div><kbd>1 2 3</kbd>Weapons (seats in vehicles)</div>
            <div><kbd>Q</kbd><kbd>X</kbd>Abilities</div><div><kbd>G</kbd>Frag, <kbd>H</kbd>Heal</div>
            <div><kbd>V</kbd>Awaken (needs an artifact)</div><div><kbd>L</kbd>Flashlight</div>
            <div><kbd>M</kbd>Map</div><div><kbd>Tab</kbd>Inventory</div>
          </div></article>
        </div></div>`;
    } else {
      const s = this.p.settings;
      body = h`<div class="screen" style="grid-template-columns:1fr;background:rgba(6,5,7,0.88)">
        <div class="dossier">
          <button class="back" data-go="lobby">&#8592; Lobby</button>
          <h2>Settings</h2>
          ${[['sensitivity', 'Look sensitivity', 0.2, 3, 0.05], ['fov', 'Field of view', 55, 95, 1], ['volume', 'Master volume', 0, 1, 0.05], ['music', 'Score volume', 0, 1, 0.05], ['matchMinutes', 'Match length (minutes)', 6, 20, 1]].map(([k, l, a, b, st]) => h`<div class="optrow"><div class="label">${l}: <span style="color:var(--bone)">${(s as any)[k as string]}</span></div><input class="slider" type="range" data-set="${k}" min="${a}" max="${b}" step="${st}" value="${(s as any)[k as string]}"></div>`).join('')}
          <div class="optrow"><div class="label">Graphics</div><div class="chips">${(['low', 'medium', 'high'] as const).map((q) => h`<button data-quality="${q}" class="${s.quality === q ? 'on' : ''}">${q}</button>`).join('')}</div></div>
          <div class="optrow"><div class="label">Touch controls</div><div class="chips">${(['auto', 'on', 'off'] as const).map((q) => h`<button data-touch="${q}" class="${s.touchControls === q ? 'on' : ''}">${q}</button>`).join('')}</div></div>
          <div class="optrow"><div class="chips"><button data-toggle="invertY" class="${s.invertY ? 'on' : ''}">Invert Y</button><button data-toggle="showFps" class="${s.showFps ? 'on' : ''}">Show FPS</button><button data-toggle="gore" class="${s.gore ? 'on' : ''}">Blood and gore</button></div></div>
          <div class="label" style="margin-top:20px">Profile: ${this.p.matches} matches / ${this.p.wins} wins / ${this.p.kills} kills</div>
        </div></div>`;
    }
    this.root.innerHTML = `<div class="shade"></div>${top}${body}`;
  }

  private opPanel(l: CharacterLook) {
    const sw = (key: keyof CharacterLook, cur: string) => h`<div class="swatches">${PALETTE.map((c) => h`<button data-look="${key}" data-val="${c}" class="${cur === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>`;
    const chips = (key: keyof CharacterLook, list: { id: string; name: string }[], cur: string) => h`<div class="chips">${list.map((o) => h`<button data-look="${key}" data-val="${o.id}" class="${cur === o.id ? 'on' : ''}">${o.name}</button>`).join('')}</div>`;
    switch (this.opTab) {
      case 'body': return h`
        <div class="optrow"><div class="label">Build</div>${chips('body', [{ id: 'male', name: 'Masculine' }, { id: 'female', name: 'Feminine' }], l.body)}</div>
        <div class="optrow"><div class="label">Skin</div><div class="swatches">${SKIN_TONES.map((c, i) => h`<button data-look="skin" data-val="${i}" class="${l.skin === i ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div></div>
        <div class="optrow"><div class="label">Wear and blood</div><input class="slider" type="range" min="0" max="1" step="0.05" value="${l.scars}" data-lookrange="scars"></div>`;
      case 'head': return h`
        <div class="optrow"><div class="label">Hair</div>${chips('hair', HAIRS, l.hair)}</div>
        <div class="optrow"><div class="label">Beard</div>${chips('beard', [{ id: 'false', name: 'None' }, { id: 'true', name: 'Full beard' }], String(l.beard))}</div>
        <div class="optrow"><div class="label">Headgear</div>${chips('head', HEADGEAR, l.head)}</div>`;
      case 'top': return h`
        <div class="optrow"><div class="label">Style</div>${chips('top', TOPS, l.top)}</div>
        <div class="optrow"><div class="label">Print</div>${chips('topPattern', PATTERNS, l.topPattern)}</div>
        <div class="optrow"><div class="label">Main colour</div>${sw('topColor', l.topColor)}</div>
        <div class="optrow"><div class="label">Accent</div>${sw('topAccent', l.topAccent)}</div>`;
      case 'bottom': return h`
        <div class="optrow"><div class="label">Trousers</div>${chips('pants', PATTERNS.filter((p) => ['solid', 'camo_urban', 'camo_night', 'adire', 'kente'].includes(p.id)), l.pants)}</div>
        <div class="optrow"><div class="label">Trouser colour</div>${sw('pantsColor', l.pantsColor)}</div>
        <div class="optrow"><div class="label">Shoes</div>${sw('shoes', l.shoes)}</div>`;
      case 'gear': return h`
        <div class="optrow"><div class="label">Plate carrier</div>${chips('vest', [{ id: 'false', name: 'None' }, { id: 'true', name: 'Vest' }], String(l.vest))}</div>
        <div class="optrow"><div class="label">Pack</div>${chips('backpack', [{ id: 'false', name: 'None' }, { id: 'true', name: 'Backpack' }], String(l.backpack))}</div>
        <div class="optrow"><div class="label">Archetype</div><div class="chips">${(Object.keys(ARCHETYPES) as ArchetypeId[]).map((a) => h`<button data-arch="${a}" class="${this.p.archetype === a ? 'on' : ''}">${ARCHETYPES[a].name}</button>`).join('')}</div>
          <div class="perk">${ARCHETYPES[this.p.archetype].tagline} ${ARCHETYPES[this.p.archetype].perk}</div></div>`;
      default: return h`<div class="optrow"><div class="label">Face</div>${chips('facePaint', [{ id: 'none', name: 'Clean' }, { id: 'tribal', name: 'Marks' }, { id: 'skull', name: 'Bone paint' }, { id: 'ash', name: 'Ash' }], l.facePaint)}</div>`;
    }
  }

  private stats(id: WeaponId) {
    const w = WEAPONS[id];
    if (id === 'machete') return h`<div class="stat"><span>Damage</span><div class="bar"><i style="width:55%"></i></div><span class="v">${w.damage}</span></div>`;
    const l = this.p.armory[id];
    const mod = (k: string) => Object.entries(l).filter(([s]) => ['optic', 'muzzle', 'mag', 'grip'].includes(s)).map(([, v]) => ATTACHMENTS.find((a) => a.id === v)).reduce((m, a) => m * ((a?.mods as any)?.[k] ?? 1), 1);
    const rows: [string, number, number][] = [
      ['Damage', (w.damage * w.pellets) / 120, (w.damage * w.pellets) / 120],
      ['Fire rate', w.rpm / 900, w.rpm / 900],
      ['Range', w.maxRange / 400, (w.maxRange * mod('maxRange')) / 400],
      ['Control', 1 - w.recoil * 10, 1 - w.recoil * mod('recoil') * 10],
      ['Accuracy', 1 - w.adsSpread * 12, 1 - w.adsSpread * mod('adsSpread') * 12],
      ['Magazine', w.mag / 45, (w.mag * mod('mag')) / 45],
      ['Stealth', 1 - w.noise / 200, 1 - (w.noise * mod('noise')) / 200],
    ];
    return rows.map(([n, base, now]) => { const b = clamp01(base), c = clamp01(now); return h`<div class="stat"><span>${n}</span><div class="bar"><i style="width:${(Math.min(b, c) * 100).toFixed(0)}%"></i>${c > b ? h`<b style="left:${(b * 100).toFixed(0)}%;width:${((c - b) * 100).toFixed(0)}%;background:var(--toxic)"></b>` : c < b ? h`<b style="left:${(c * 100).toFixed(0)}%;width:${((b - c) * 100).toFixed(0)}%"></b>` : ''}</div><span class="v">${Math.round(c * 100)}</span></div>`; }).join('');
  }

  private click(e: Event) {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    audio.init(); audio.ui('click');
    const d = t.dataset;
    if (d.go) { if (d.go === 'play') { this.onPlay(); return; } this.screen = d.go as any; this.scene.dragYaw = 0; }
    if (d.arch) { this.p.archetype = d.arch as ArchetypeId; }
    if (d.op) { this.p.operatorId = d.op; const o = this.op; this.p.archetype = o.archetype; }
    if (d.optab) this.opTab = d.optab;
    if (d.look) {
      const look = this.op.look as any;
      const v = d.val!;
      look[d.look] = d.look === 'skin' ? +v : v === 'true' ? true : v === 'false' ? false : v;
      if (d.look === 'body') { look.hair = v === 'female' ? 'buns' : 'buzzed'; if (v === 'female') look.beard = false; }
    }
    if (d.weapon) this.weapon = d.weapon as WeaponId;
    if (d.skin) this.p.armory[this.weapon].skin = d.skin as any;
    if (d.att) { const [slot, id] = d.att.split(':'); (this.p.armory[this.weapon] as any)[slot] = id || null; }
    if (d.charm !== undefined) this.p.armory[this.weapon].charm = !this.p.armory[this.weapon].charm;
    if (d.quality) this.p.settings.quality = d.quality as any;
    if (d.touch) this.p.settings.touchControls = d.touch as any;
    if (d.toggle) (this.p.settings as any)[d.toggle] = !(this.p.settings as any)[d.toggle];
    this.save();
    this.render();
  }
  private input(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.set) { (this.p.settings as any)[t.dataset.set] = +t.value; audio.setVolume(this.p.settings.volume, this.p.settings.music); this.save(); const lab = t.previousElementSibling?.querySelector('span'); if (lab) lab.textContent = t.value; }
    if (t.dataset.lookrange) { (this.op.look as any)[t.dataset.lookrange] = +t.value; this.save(); this.scene.setLook(this.op.look, ARCHETYPES[this.p.archetype].primary, this.p.armory[ARCHETYPES[this.p.archetype].primary]); }
    if (t.dataset.callsign !== undefined) { this.p.callsign = t.value.replace(/[^\w\s.-]/g, '').slice(0, 16) || 'Survivor'; this.save(); }
  }
}

function clamp01(v: number) { return Math.max(0.02, Math.min(1, v)); }
export function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
