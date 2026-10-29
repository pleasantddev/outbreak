// Casino games: blackjack (dealer stands on 17, blackjack pays 3:2, double down), European roulette with a spinning
// wheel, and a three-reel slot machine. Pure DOM; the casino venue opens them and settles the money.
export interface Wallet { get(): number; add(n: number, why: string): void }
export interface GameResult { net: number; big?: boolean }

const css = `
#cg{position:fixed;inset:0;z-index:10;display:none;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(4,30,22,.55),rgba(0,0,0,.78));font-family:Inter,sans-serif;color:#f3f5f8}
#cg.on{display:flex}
#cg .tb{width:min(760px,96vw);border-radius:26px;padding:18px 20px;background:radial-gradient(ellipse at 50% 30%,#0f6b4b,#08402d 70%);border:6px solid #3b2414;box-shadow:inset 0 0 60px rgba(0,0,0,.45),0 30px 80px rgba(0,0,0,.6);position:relative}
#cg .top{display:flex;align-items:center;gap:10px;margin-bottom:8px} #cg .top b{font:800 20px Rajdhani,Inter;letter-spacing:1.5px;color:#ffe082} #cg .top span{font-size:12px;color:#b2dfdb}
#cg .top .cash{margin-left:auto;font:700 18px Rajdhani,Inter;background:rgba(0,0,0,.3);padding:5px 12px;border-radius:999px} #cg .top .x{width:34px;height:34px;border-radius:10px;border:none;background:rgba(0,0,0,.35);color:#fff;font:700 15px Inter;cursor:pointer}
#cg .row{display:flex;gap:8px;justify-content:center;min-height:118px;align-items:center;margin:6px 0}
#cg .lbl{text-align:center;font-size:12px;color:#b2dfdb;letter-spacing:1px;text-transform:uppercase}
#cg .card{width:72px;height:104px;border-radius:9px;background:#fffdf7;color:#111;position:relative;box-shadow:0 6px 16px rgba(0,0,0,.4);font:800 22px Rajdhani,Inter;animation:cgdeal .3s cubic-bezier(.2,1.2,.4,1)}
#cg .card.red{color:#c62828} #cg .card .c1{position:absolute;left:7px;top:4px} #cg .card .c2{position:absolute;right:7px;bottom:4px;transform:rotate(180deg)} #cg .card .mid{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px}
#cg .card.back{background:repeating-linear-gradient(45deg,#7b1fa2 0 6px,#4a148c 6px 12px);border:3px solid #fff} @keyframes cgdeal{from{transform:translate(120px,-80px) rotate(20deg);opacity:0}}
#cg .msg{text-align:center;font:800 22px Rajdhani,Inter;letter-spacing:1px;min-height:30px;color:#ffe082;text-shadow:0 2px 8px rgba(0,0,0,.5)}
#cg .bar{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px}
#cg button.b{padding:11px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.35);color:#fff;font:700 13.5px Inter;cursor:pointer;min-width:92px}
#cg button.b.pri{background:linear-gradient(180deg,#ffca28,#ff8f00);color:#2a1700;border-color:#ffe082} #cg button.b:disabled{opacity:.35;cursor:default}
#cg .chips{display:flex;gap:8px;justify-content:center;margin-top:8px} #cg .chip{width:50px;height:50px;border-radius:50%;border:4px dashed rgba(255,255,255,.75);display:flex;align-items:center;justify-content:center;font:800 12px Rajdhani,Inter;cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,.4)}
#cg .chip.sel{transform:translateY(-5px);box-shadow:0 0 0 3px #ffe082,0 6px 14px rgba(0,0,0,.5)}
#cg .bet{text-align:center;font:700 15px Rajdhani,Inter;color:#fff;margin-top:6px}
#cg canvas{display:block;margin:0 auto}
#cg .rgrid{display:grid;grid-template-columns:repeat(12,1fr);gap:3px;margin-top:8px} #cg .rgrid div,#cg .routs div{padding:7px 0;text-align:center;border-radius:5px;font:700 13px Rajdhani,Inter;cursor:pointer;border:1px solid rgba(255,255,255,.18);position:relative}
#cg .rgrid .r{background:#b71c1c} #cg .rgrid .k{background:#1b1b1b} #cg .routs{display:grid;grid-template-columns:repeat(9,1fr);gap:3px;margin-top:3px} #cg .routs div{background:rgba(0,0,0,.3)}
#cg .on-bet::after{content:attr(data-b);position:absolute;right:-4px;top:-8px;background:#ffca28;color:#2a1700;border-radius:999px;font-size:10px;padding:1px 5px}
#cg .reels{display:flex;gap:10px;justify-content:center;margin:10px 0} #cg .reel{width:110px;height:132px;border-radius:14px;background:linear-gradient(180deg,#e0e0e0,#fff 30%,#fff 70%,#e0e0e0);overflow:hidden;position:relative;box-shadow:inset 0 0 18px rgba(0,0,0,.35)}
#cg .reel .s{height:132px;display:flex;align-items:center;justify-content:center;font-size:62px}
#cg .pay{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 14px;font-size:12px;color:#b2dfdb;max-width:520px;margin:6px auto 0}
`;
const SUITS = ['♠', '♥', '♦', '♣']; const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
type Card = { r: number; s: number };
const val = (h: Card[]) => { let t = 0, a = 0; for (const c of h) { const v = c.r === 0 ? 11 : c.r >= 9 ? 10 : c.r + 1; t += v; if (c.r === 0) a++; } while (t > 21 && a) { t -= 10; a--; } return t; };
const cardHtml = (c: Card | null) => c ? `<div class="card ${c.s === 1 || c.s === 2 ? 'red' : ''}"><span class="c1">${RANKS[c.r]}${SUITS[c.s]}</span><span class="mid">${SUITS[c.s]}</span><span class="c2">${RANKS[c.r]}${SUITS[c.s]}</span></div>` : '<div class="card back"></div>';
const CHIPS = [[500, '#e53935'], [1000, '#1e88e5'], [5000, '#43a047'], [20000, '#212121'], [100000, '#8e24aa']] as const;
const N = (n: number) => '₦' + Math.round(n).toLocaleString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CasinoGames {
  el: HTMLElement; open = false; private onClose: (() => void) | null = null; private chip = 1000; private sfx?: (k: string) => void;
  constructor(private wallet: Wallet, private onResult: (game: string, r: GameResult) => void) {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.el = document.createElement('div'); this.el.id = 'cg'; document.body.appendChild(this.el);
  }
  setSfx(f: (k: string) => void) { this.sfx = f; }
  close() { this.el.classList.remove('on'); this.el.innerHTML = ''; this.open = false; const f = this.onClose; this.onClose = null; f?.(); }
  private shell(title: string, sub: string, body: string) {
    this.el.innerHTML = `<div class="tb"><div class="top"><b>${title}</b><span>${sub}</span><span class="cash" id="cg-cash">${N(this.wallet.get())}</span><button class="x" id="cg-x">✕</button></div>${body}</div>`;
    this.el.querySelector('#cg-x')!.addEventListener('click', () => this.close()); this.el.classList.add('on'); this.open = true;
  }
  private cash() { const c = this.el.querySelector('#cg-cash'); if (c) c.textContent = N(this.wallet.get()); }
  private chipsHtml(min: number) { return `<div class="chips">${CHIPS.filter(([v]) => v >= min).map(([v, c]) => `<div class="chip ${v === this.chip ? 'sel' : ''}" data-c="${v}" style="background:${c}">${v >= 1000 ? v / 1000 + 'k' : v}</div>`).join('')}</div>`; }
  private wireChips(cb?: () => void) { this.el.querySelectorAll('[data-c]').forEach((d) => d.addEventListener('click', () => { this.chip = +(d as HTMLElement).dataset.c!; this.el.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('sel', x === d)); this.sfx?.('chip'); cb?.(); })); }

  // ---------------------------------------------------------------- blackjack
  blackjack(onClose: () => void, min = 500) {
    this.onClose = onClose; let bet = 0; let deck: Card[] = []; let ph: Card[] = [], dh: Card[] = []; let busy = false; let doubled = false;
    const shoe = () => { deck = []; for (let k = 0; k < 4; k++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) deck.push({ r, s }); for (let i = deck.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [deck[i], deck[j]] = [deck[j], deck[i]]; } };
    shoe();
    const draw = () => { if (deck.length < 30) shoe(); return deck.pop()!; };
    const view = (hide: boolean, msg = '', phase: 'bet' | 'play' | 'done' = 'bet') => {
      this.shell('BLACKJACK', `Dealer stands on 17 · Blackjack pays 3 to 2 · Min ${N(min)}`, `
        <div class="lbl">Dealer ${hide || !dh.length ? '' : '· ' + val(dh)}</div><div class="row">${dh.map((c, i) => cardHtml(hide && i === 1 ? null : c)).join('')}</div>
        <div class="msg">${msg}</div>
        <div class="row">${ph.map((c) => cardHtml(c)).join('')}</div><div class="lbl">You ${ph.length ? '· ' + val(ph) : ''}</div>
        ${phase === 'bet' || phase === 'done' ? this.chipsHtml(min) + `<div class="bet">Bet ${N(bet || this.chip)}</div>` : `<div class="bet">Bet ${N(bet)}</div>`}
        <div class="bar">${phase === 'play' ? `<button class="b pri" data-a="hit">Hit</button><button class="b" data-a="stand">Stand</button><button class="b" data-a="dbl" ${ph.length !== 2 || this.wallet.get() < bet ? 'disabled' : ''}>Double</button>` : `<button class="b pri" data-a="deal" ${this.wallet.get() < this.chip ? 'disabled' : ''}>Deal ${N(this.chip)}</button>`}</div>`);
      this.wireChips(() => view(hide, msg, phase));
      this.el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => act((b as HTMLElement).dataset.a!)));
    };
    const settle = async () => {
      busy = true; view(false, '', 'play');
      while (val(dh) < 17) { await sleep(600); dh.push(draw()); this.sfx?.('card'); view(false, '', 'play'); }
      await sleep(400); const p = val(ph), d = val(dh); let net = 0, msg = '';
      if (p > 21) { net = -bet; msg = 'BUST'; } else if (d > 21 || p > d) { net = bet; msg = d > 21 ? 'DEALER BUSTS · YOU WIN' : 'YOU WIN'; } else if (p === d) { net = 0; msg = 'PUSH'; } else { net = -bet; msg = 'DEALER WINS'; }
      finish(net, msg);
    };
    const finish = (net: number, msg: string) => { if (net + bet > 0) this.wallet.add(net + bet, 'blackjack'); this.onResult('blackjack', { net, big: net >= bet * 1.5 && bet >= 20000 }); this.sfx?.(net > 0 ? 'win' : net < 0 ? 'lose' : 'chip'); bet = 0; busy = false; doubled = false; view(false, msg + (net ? ` ${net > 0 ? '+' : '-'}${N(Math.abs(net))}` : ''), 'done'); };
    const act = async (a: string) => {
      if (busy) return;
      if (a === 'deal') {
        if (this.wallet.get() < this.chip) return; bet = this.chip; this.wallet.add(-bet, 'blackjack'); ph = []; dh = []; busy = true;
        for (let i = 0; i < 2; i++) { ph.push(draw()); this.sfx?.('card'); view(true, '', 'play'); await sleep(260); dh.push(draw()); this.sfx?.('card'); view(true, '', 'play'); await sleep(260); }
        busy = false;
        if (val(ph) === 21) { if (val(dh) === 21) return finish(0, 'BOTH BLACKJACK · PUSH'); return finish(Math.floor(bet * 1.5), 'BLACKJACK!'); }
        if (val(dh) === 21) return finish(-bet, 'DEALER BLACKJACK');
        view(true, '', 'play');
      }
      if (a === 'hit') { ph.push(draw()); this.sfx?.('card'); if (val(ph) > 21) return finish(-bet, 'BUST'); if (val(ph) === 21) return settle(); view(true, '', 'play'); }
      if (a === 'stand') return settle();
      if (a === 'dbl' && !doubled && this.wallet.get() >= bet) { this.wallet.add(-bet, 'blackjack'); bet *= 2; doubled = true; ph.push(draw()); this.sfx?.('card'); if (val(ph) > 21) return finish(-bet, 'BUST'); return settle(); }
    };
    view(false, 'Place your bet');
  }

  // ---------------------------------------------------------------- roulette
  roulette(onClose: () => void, min = 500) {
    this.onClose = onClose; const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
    const bets = new Map<string, number>(); let spinning = false; let angle = 0; let last: number[] = [];
    const pays = (k: string, n: number) => { if (k === 'n' + n) return 36; if (n === 0) return 0; const red = RED.has(n); if (k === 'red' && red) return 2; if (k === 'black' && !red) return 2; if (k === 'odd' && n % 2) return 2; if (k === 'even' && !(n % 2)) return 2; if (k === 'low' && n <= 18) return 2; if (k === 'high' && n > 18) return 2; if (k === 'd1' && n <= 12) return 3; if (k === 'd2' && n > 12 && n <= 24) return 3; if (k === 'd3' && n > 24) return 3; return 0; };
    const total = () => [...bets.values()].reduce((a, b) => a + b, 0);
    const draw = (cv: HTMLCanvasElement, ball: number | null) => {
      const x = cv.getContext('2d')!; const W = cv.width, R = W / 2 - 6; x.clearRect(0, 0, W, W); x.save(); x.translate(W / 2, W / 2);
      x.beginPath(); x.arc(0, 0, R + 4, 0, Math.PI * 2); x.fillStyle = '#4e2a12'; x.fill();
      const n = WHEEL.length; for (let i = 0; i < n; i++) { const a0 = angle + (i / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / n; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R, a0, a1); x.fillStyle = WHEEL[i] === 0 ? '#2e7d32' : RED.has(WHEEL[i]) ? '#c62828' : '#151515'; x.fill();
        x.save(); x.rotate((a0 + a1) / 2); x.fillStyle = '#fff'; x.font = '700 10px Rajdhani,Inter'; x.textAlign = 'center'; x.fillText(String(WHEEL[i]), R - 12, 4); x.restore(); }
      x.beginPath(); x.arc(0, 0, R * 0.55, 0, Math.PI * 2); x.fillStyle = '#6d3b17'; x.fill(); x.beginPath(); x.arc(0, 0, R * 0.18, 0, Math.PI * 2); x.fillStyle = '#d4a017'; x.fill();
      if (ball !== null) { x.beginPath(); x.arc(Math.cos(ball) * (R - 26), Math.sin(ball) * (R - 26), 6, 0, Math.PI * 2); x.fillStyle = '#fff'; x.shadowColor = '#000'; x.shadowBlur = 6; x.fill(); }
      x.restore();
    };
    const view = (msg = 'Place your chips') => {
      const cell = (k: string, label: string, cls = '') => `<div class="${cls} ${bets.has(k) ? 'on-bet' : ''}" data-k="${k}" data-b="${bets.has(k) ? (bets.get(k)! >= 1000 ? bets.get(k)! / 1000 + 'k' : bets.get(k)) : ''}">${label}</div>`;
      let grid = ''; for (let row = 0; row < 3; row++) for (let col = 0; col < 12; col++) { const n = col * 3 + (3 - row); grid += cell('n' + n, String(n), RED.has(n) ? 'r' : 'k'); }
      this.shell('ROULETTE', `Single zero · Straight up pays 35 to 1 · Min ${N(min)}`, `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;justify-content:center"><canvas id="cg-w" width="230" height="230"></canvas>
        <div style="flex:1;min-width:280px"><div class="msg" id="cg-m">${msg}</div><div class="lbl">Last: ${last.map((n) => `<b style="color:${n === 0 ? '#66bb6a' : RED.has(n) ? '#ef5350' : '#fff'}">${n}</b>`).join(' ') || '-'}</div>
        <div style="display:grid;grid-template-columns:34px 1fr;gap:3px;margin-top:8px">${cell('n0', '0', 'k" style="background:#2e7d32;display:flex;align-items:center;justify-content:center;border-radius:5px;cursor:pointer;font:700 13px Rajdhani')}<div class="rgrid" style="margin:0">${grid}</div></div>
        <div class="routs">${cell('d1', '1st 12')}${cell('d2', '2nd 12')}${cell('d3', '3rd 12')}${cell('low', '1-18')}${cell('even', 'Even')}${cell('red', 'Red', '" style="background:#b71c1c')}${cell('black', 'Black', '" style="background:#1b1b1b')}${cell('odd', 'Odd')}${cell('high', '19-36')}</div></div></div>
        ${this.chipsHtml(min)}<div class="bet">On the table ${N(total())}</div><div class="bar"><button class="b" data-a="clear" ${spinning || !bets.size ? 'disabled' : ''}>Clear</button><button class="b pri" data-a="spin" ${spinning || !bets.size ? 'disabled' : ''}>Spin</button></div>`);
      this.wireChips(); draw(this.el.querySelector('#cg-w') as HTMLCanvasElement, null);
      this.el.querySelectorAll('[data-k]').forEach((d) => d.addEventListener('click', () => { if (spinning) return; const k = (d as HTMLElement).dataset.k!; if (this.wallet.get() < this.chip) return; this.wallet.add(-this.chip, 'roulette'); bets.set(k, (bets.get(k) ?? 0) + this.chip); this.sfx?.('chip'); view(msg); }));
      this.el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => act((b as HTMLElement).dataset.a!)));
    };
    const act = (a: string) => {
      if (a === 'clear') { for (const v of bets.values()) this.wallet.add(v, 'roulette'); bets.clear(); return view(); }
      if (a !== 'spin' || spinning || !bets.size) return;
      spinning = true; view('No more bets'); const cv = this.el.querySelector('#cg-w') as HTMLCanvasElement;
      const res = WHEEL[(Math.random() * WHEEL.length) | 0]; const idx = WHEEL.indexOf(res); const n = WHEEL.length; const t0 = performance.now(); const dur = 4200;
      const a0 = angle; const wheelTurn = Math.PI * 2 * 3 + Math.random(); const ballStart = Math.random() * Math.PI * 2;
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 3); angle = a0 + wheelTurn * e;
        const pocket = angle + ((idx + 0.5) / n) * Math.PI * 2; const ball = ballStart - (1 - e) * Math.PI * 2 * 5 + (pocket - ballStart) * e;
        draw(cv, ball); if (k < 1) { if (Math.random() < 0.1) this.sfx?.('tick'); requestAnimationFrame(step); } else done();
      };
      const done = () => {
        let back = 0, staked = 0; for (const [k, v] of bets) { staked += v; back += v * pays(k, res); }
        if (back) this.wallet.add(back, 'roulette'); const net = back - staked; last = [res, ...last].slice(0, 8); bets.clear(); spinning = false;
        this.onResult('roulette', { net, big: back >= staked * 10 && staked >= 5000 }); this.sfx?.(net > 0 ? 'win' : 'lose');
        view(`${res} ${res === 0 ? 'GREEN' : RED.has(res) ? 'RED' : 'BLACK'} · ${net > 0 ? 'YOU WIN ' + N(net) : net < 0 ? 'HOUSE TAKES ' + N(-net) : 'YOU BROKE EVEN'}`);
      };
      requestAnimationFrame(step);
    };
    view();
  }

  // ---------------------------------------------------------------- slots
  slots(onClose: () => void) {
    this.onClose = onClose; const SYM = ['🌶️', '🍚', '🥥', '🚌', '👑', '7️⃣']; const W = [30, 26, 20, 13, 7, 4]; const PAY: Record<number, number> = { 0: 5, 1: 8, 2: 12, 3: 25, 4: 80, 5: 300 };
    let bet = 500; let spinning = false;
    const roll = () => { let r = Math.random() * W.reduce((a, b) => a + b, 0); for (let i = 0; i < W.length; i++) { if ((r -= W[i]) < 0) return i; } return 0; };
    const view = (res: number[] = [5, 4, 3], msg = 'Three of a kind pays big. Any pair gives your stake back.') => {
      this.shell('JACKPOT 7', 'Three reels · Pays back about 95%', `<div class="reels">${res.map((s, i) => `<div class="reel"><div class="s" id="cg-r${i}">${SYM[s]}</div></div>`).join('')}</div>
        <div class="msg" id="cg-m">${msg}</div><div class="pay">${SYM.map((s, i) => `<span>${s}${s}${s} pays ${PAY[i]}x</span>`).join('')}</div>
        <div class="bar">${[500, 1000, 5000, 20000].map((b) => `<button class="b ${b === bet ? 'pri' : ''}" data-b="${b}">${N(b)}</button>`).join('')}<button class="b pri" data-a="spin" style="min-width:140px" ${spinning || this.wallet.get() < bet ? 'disabled' : ''}>Pull</button></div>`);
      this.el.querySelectorAll('[data-b]').forEach((d) => d.addEventListener('click', () => { if (spinning) return; bet = +(d as HTMLElement).dataset.b!; view(res, msg); }));
      this.el.querySelector('[data-a=spin]')!.addEventListener('click', () => spin());
    };
    const spin = async () => {
      if (spinning || this.wallet.get() < bet) return; spinning = true; this.wallet.add(-bet, 'slots'); this.cash(); this.sfx?.('lever');
      const res = [roll(), roll(), roll()]; (this.el.querySelector('[data-a=spin]') as HTMLButtonElement).disabled = true;
      for (let i = 0; i < 3; i++) { const el = this.el.querySelector('#cg-r' + i) as HTMLElement; const until = performance.now() + 700 + i * 450; while (performance.now() < until) { el.textContent = SYM[(Math.random() * SYM.length) | 0]; await sleep(60); } el.textContent = SYM[res[i]]; this.sfx?.('reel'); }
      let win = 0; if (res[0] === res[1] && res[1] === res[2]) win = bet * PAY[res[0]]; else if (res[0] === res[1] || res[1] === res[2] || res[0] === res[2]) win = bet;
      if (win) this.wallet.add(win, 'slots'); spinning = false;
      this.onResult('slots', { net: win - bet, big: win >= bet * 20 }); this.sfx?.(win > bet ? 'win' : win ? 'chip' : 'lose');
      view(res, win > bet * 20 ? `JACKPOT! ${N(win)}` : win ? `You win ${N(win)}` : 'Try again');
    };
    view();
  }
}
