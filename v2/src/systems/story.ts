// Story mode: "Last Stop, Oshodi". The chapters are ordinary missions (category "story" in content/missions.json, written
// by tools/gen_story.py), so the mission engine runs them, the map marks them and they work offline and online. This
// system adds what a story needs on top: the Story app (where you are, what you chose, the way to the next chapter),
// a chapter card when one starts, the next chapter's call a little after the last one ends, and the ending.
import type { GameCtx, GameSystem } from './registry';
import type { MissionDef } from '../content/schema';
import { registerApp } from '../ui/lifeHud';
import { missions } from './missions';
import { waypoints } from './waypoint';

const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const BOOK = 'Last Stop, Oshodi';

/** what each choice says about you, read back from the flags the chapters set */
const RECAP: [flag: string, line: string][] = [
  ['story_dues_paid', 'You paid Baba Ibeji his dues and kept your face clean.'],
  ['story_dues_talked', 'You talked your way past Baba Ibeji\'s boys.'],
  ['story_dues_fought', 'You refused Baba Ibeji\'s dues with your fists. He remembers.'],
  ['story_has_recording', 'You hold Kunle\'s voice notes: Kasumu selling one plot to five people.'],
];
const ENDINGS: [flag: string, title: string, line: string][] = [
  ['story_end_justice', 'Paper and voice', 'Kasumu is answering questions at Ikeja. The Ayobo plot is back in the right name, and Kunle opened his shop again.'],
  ['story_end_deal', 'Everybody happy', 'You took Kasumu\'s money. Kunle\'s debt is gone, the plot is still for sale, and Kasumu now owes you a favour. In Lagos that is also money.'],
  ['story_end_shame', 'Owambe scatter', 'You read the survey plan out over the DJ. The guests left with their rice. Nobody buys land from Kasumu any more.'],
  ['story_end_streets', 'Street justice', 'You kept the plan and Kasumu kept his distance. The park talks about you now.'],
];

const css = `
#appview:has(.st),#appview:has(.st) .list{background:#f6f1e7}
#appview .st{color:#1d1a16;font:400 14px/1.45 Inter,system-ui,sans-serif;display:flex;flex-direction:column;align-items:stretch;gap:14px;padding:4px 2px 12px;width:100%;box-sizing:border-box}
#appview .st ::selection{background:#e8b04a55}
#appview .st h1{font:700 30px/1 Oswald,'Arial Narrow',sans-serif;letter-spacing:.01em;text-transform:uppercase;margin:6px 4px 0;color:#1d1a16;text-wrap:balance}
#appview .st .lede{margin:0 4px;color:#5e5446}
#appview .st .now{background:#fff;border:1px solid #e4dccd;border-radius:18px;padding:16px;box-shadow:0 6px 18px rgba(60,44,20,.08)}
#appview .st .now .n{font:600 13px/1 Oswald,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#a0621a}
#appview .st .now h2{font:700 24px/1.05 Oswald,sans-serif;text-transform:uppercase;margin:6px 0 8px;text-wrap:balance}
#appview .st .now p{margin:0 0 10px;color:#3a332a}
#appview .st .now .where{display:flex;gap:6px;align-items:center;color:#5e5446;font-size:12.5px;margin-bottom:12px}
#appview .st .now .where svg{flex:none;width:15px;height:15px;stroke:#a0621a}
#appview .st .acts{display:flex;gap:8px;flex-wrap:wrap}
#appview .st button{font:700 13.5px Inter,sans-serif;border-radius:12px;padding:12px 16px;min-height:44px;cursor:pointer;pointer-events:auto;transition:transform .12s cubic-bezier(.2,.8,.2,1),background .15s}
#appview .st button:active{transform:scale(.97)}
#appview .st button:focus-visible{outline:3px solid #e8b04a;outline-offset:2px}
#appview .st .go{flex:1;background:#1d1a16;color:#fff8ea;border:0}
#appview .st .go:hover{background:#3a332a}
#appview .st .alt{background:transparent;color:#1d1a16;border:1.5px solid #cdbfa6}
#appview .st .alt:hover{background:#efe6d6}
#appview .st ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
#appview .st li{display:grid;grid-template-columns:34px 1fr;gap:10px;padding:11px 4px;border-top:1px solid #e4dccd}
#appview .st li .k{font:700 18px/1.2 Oswald,sans-serif;color:#b7a88e;font-variant-numeric:tabular-nums}
#appview .st li b{display:block;font:600 15px/1.25 Oswald,sans-serif;text-transform:uppercase;letter-spacing:.02em}
#appview .st li span{display:block;color:#6b604f;font-size:12.5px;margin-top:2px}
#appview .st li.done .k{color:#2f7d4f}
#appview .st li.cur{background:#fff7e6;border-radius:12px;border-top-color:transparent}
#appview .st li.cur .k{color:#a0621a}
#appview .st li.lock b{color:#a99c86}
#appview .st .you{margin:0 4px;padding:12px 14px;border-radius:14px;background:#efe6d6;color:#3a332a;font-size:13px}
#appview .st .you p{margin:4px 0 0}
#appview .st .end{background:#1d1a16;color:#fff8ea;border-radius:18px;padding:18px 16px}
#appview .st .end h2{font:700 26px/1.05 Oswald,sans-serif;text-transform:uppercase;margin:0 0 8px;color:#e8b04a}
#appview .st .end p{margin:0;color:#e9dfcb}
`;

class Story {
  private callAt = 0; private nudged = false; private lastDone = 0;
  constructor(private ctx: GameCtx) {}
  /** count what was done before this session so finishing nothing does not ring anybody */
  sync() { this.lastDone = this.chapters.filter((m) => this.done(m)).length; }
  init() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    registerApp('Story', 'M5 4h9a5 5 0 0 1 5 5v11H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6', 'linear-gradient(160deg,#e8b04a,#8a4b0f)', () => this.html());
    (window as any).__story = this;
  }
  /** the chapters, in order */
  get chapters(): MissionDef[] { return (missions.content?.missions ?? []).filter((m) => m.category === 'story').sort((a, b) => a.id.localeCompare(b.id)); }
  done(m: MissionDef) { return !!missions.sv.done[m.id]; }
  flag(f: string) { return missions.sv.flags.includes(f); }
  /** the first chapter not finished yet, or null when the book is closed */
  current(): MissionDef | null { return this.chapters.find((m) => !this.done(m)) ?? null; }
  numberOf(m: MissionDef) { return this.chapters.indexOf(m) + 1; }

  html() {
    const ch = this.chapters; if (!ch.length) return `<div class="st"><p class="lede">The story is still loading.</p></div>`;
    const cur = this.current(); const doneN = ch.filter((m) => this.done(m)).length; const run = missions.run;
    let h = `<div class="st"><h1>${esc(BOOK)}</h1><p class="lede">${cur ? `Chapter ${this.numberOf(cur)} of ${ch.length}. Your cousin Kunle owes a land grabber two and half million naira, and somebody has to sort it out.` : 'The story is done. Lagos is still here.'}</p>`;
    if (cur) {
      const onIt = run?.def.id === cur.id; const p = missions.anchor(cur); const d = p ? missions.dist(p) : -1;
      const dist = d < 0 ? '' : d >= 1000 ? `${(d / 1000).toFixed(1)} km away` : `${Math.round(d / 10) * 10} m away`;
      const how = cur.offer?.giver ? `${esc(cur.offer.giver.name)} is waiting${p?.name ? ` at ${esc(p.name)}` : ''}` : `${esc(cur.giver)} will call you${p?.name ? `. It starts at ${esc(p.name)}` : ''}`;
      const locked = missions.locked(cur);
      h += `<section class="now"><div class="n">Chapter ${this.numberOf(cur)}</div><h2>${esc(cur.title)}</h2><p>${esc(cur.blurb)}</p>`;
      h += `<div class="where"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg><span>${onIt ? esc(run!.text) : `${how}${dist ? ` · ${dist}` : ''}`}</span></div>`;
      if (onIt) h += `<div class="acts"><button class="go" data-app="Story" data-id="way">Show me the way</button><button class="alt" data-app="Hustles" data-id="drop">Drop it for now</button></div>`;
      else if (run) h += `<div class="acts"><button class="alt" data-app="Story" data-id="way">Show me where it starts</button></div><p class="lede" style="margin:8px 0 0">Finish "${esc(run.def.title)}" first, then the story picks up.</p>`;
      else if (locked && locked !== 'Done') h += `<p class="lede" style="margin:0">Not yet: ${esc(locked)}.</p>`;
      else h += `<div class="acts"><button class="go" data-app="Story" data-id="${cur.offer?.giver ? 'way' : 'start'}">${cur.offer?.giver ? 'Show me the way' : 'Start this chapter'}</button>${cur.offer?.giver ? `<button class="alt" data-app="Story" data-id="start">Start now</button>` : ''}</div>`;
      h += `</section>`;
    } else {
      const e = ENDINGS.find(([f]) => this.flag(f));
      h += `<section class="end"><h2>${esc(e?.[1] ?? 'The end')}</h2><p>${esc(e?.[2] ?? 'Kunle is free of Kasumu. What you do in Lagos now is up to you.')}</p></section>`;
    }
    const recap = RECAP.filter(([f]) => this.flag(f)).map(([, l]) => l);
    if (recap.length) h += `<div class="you"><b>What you have done</b>${recap.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
    h += `<ol>${ch.map((m, i) => { const d = this.done(m), c = m === cur; return `<li class="${d ? 'done' : c ? 'cur' : 'lock'}"><span class="k">${i + 1}</span><div><b>${d || c ? esc(m.title) : 'Locked'}</b><span>${d ? 'Done' : c ? esc(m.area) : `After chapter ${i}`}</span></div></li>`; }).join('')}</ol>`;
    return h + `<p class="lede" style="font-size:12px">${doneN} of ${ch.length} chapters. Hustles you take between chapters keep paying the bills.</p></div>`;
  }

  onAction(app: string, id: string) {
    if (app !== 'Story') return false;
    const cur = this.current(); if (!cur) return true;
    if (id === 'way') { const p = missions.anchor(cur); if (p) { missions.tracked = cur.id; waypoints.set({ x: p.x, z: p.z, label: `Chapter ${this.numberOf(cur)}` }); } this.ctx.hud.togglePhone?.(false); }
    if (id === 'start') { if (missions.startMission(cur.id, { force: true })) this.ctx.hud.togglePhone?.(false); }
    this.ctx.hud.refreshApp(); return true;
  }

  frame(dt: number) {
    const ch = this.chapters; if (!ch.length || !missions.content) return;
    const doneN = ch.filter((m) => this.done(m)).length;
    // a chapter just ended: the next one calls you after a breather (or its giver appears on the map)
    if (doneN > this.lastDone) {
      const next = this.current();
      if (next && next.offer?.call) this.callAt = 45;
      else if (!next) { const e = ENDINGS.find(([f]) => this.flag(f)); this.ctx.hud.toast('The end', `${BOOK}: ${e?.[1] ?? 'done'}. Open Story to read how it ended.`, 'linear-gradient(160deg,#e8b04a,#8a4b0f)', 'pin', 7); }
      this.lastDone = doneN;
    }
    if (this.callAt > 0 && !missions.run && !this.ctx.hud.ringing) {
      this.callAt -= dt;
      if (this.callAt <= 0) { const next = this.current(); if (next && !missions.locked(next)) missions.offer(next.id); else this.callAt = 0; }
    }
    // a new arrival who has not found the story yet gets one nudge towards Mama Titi
    if (!this.nudged && doneN === 0 && !missions.run && this.ctx.sim.time > 75) {
      this.nudged = true; const first = ch[0];
      this.ctx.hud.toast('Mama Titi', 'Somebody at the buka is asking for Kunle\'s cousin. Open Story on your phone.', 'linear-gradient(160deg,#e8b04a,#8a4b0f)', 'pin', 6);
      if (!missions.tracked) missions.tracked = first.id;
    }
  }
}

let S: Story | null = null;
export const storySystem: GameSystem = {
  id: 'story',
  init(ctx) { S = new Story(ctx); S.init(); },
  start() { S?.sync(); },
  frame(_ctx, dt) { S?.frame(dt); },
  onAction(_ctx, app, id) { return S?.onAction(app, id) ?? false; },
};
