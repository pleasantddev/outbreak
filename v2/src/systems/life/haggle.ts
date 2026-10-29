// Haggling. Every trader has a price she opens with, a price she will never go below, patience, a temper and
// a memory of you. You offer, beg, buy two, pretend to walk away or just pay. Trade skill and Charm help.
export interface Good { id: string; label: string; fair: number; unit?: string; fx: GoodFx; fixed?: boolean; night?: boolean; qty2?: boolean }
export type GoodFx =
  | { k: 'eat'; hunger: number; mins: number; fun?: number; social?: number }
  | { k: 'drink'; hunger?: number; fun?: number; comfort?: number; bladder?: number }
  | { k: 'pantry'; n: number } | { k: 'takeaway'; n: number } | { k: 'outfit' } | { k: 'toilet' } | { k: 'bath' } | { k: 'data'; fun: number };

export interface Persona { name: string; stubborn: number; warmth: number; patience: number; female: boolean }
export interface Memory { regard: number; deals: number; banUntil: number }

export interface DealState {
  good: Good; qty: number; ask: number; reserve: number; patience: number; rounds: number; fair: number; done: boolean; price: number;
  log: { who: 'you' | 'her'; text: string }[]; called: boolean;
}

const r50 = (n: number) => Math.max(50, Math.round(n / 50) * 50);
const pick = <T>(l: T[]) => l[(Math.random() * l.length) | 0];

export const LINES = {
  open: ['Customer! Come buy. Na {p}, last price for you.', 'Fine boy, fine girl, come. {p}, I no go cheat you.', 'Ah my customer! Na {p} I dey sell am today.', 'Correct {i} be this. {p}.', 'Price don go up o. {p}, na wetin I fit do.'],
  openRegular: ['Ehen, my person don come! For you, {p}.', 'My regular customer! I go do you {p}.'],
  counter: ['Add small. Bring {p}.', 'No be like that. Make it {p}.', 'Hmm. {p}, and na because of your face.', 'You wan finish me? Okay, {p}.', 'Oya, {p}. My children must chop too.'],
  close: ['That one no reach. Make e be {p}.', 'Na market we dey, no be charity. {p}.', 'Ah, see as you price am. {p} or nothing.'],
  insult: ['You wan kill me? Wetin I go take pay transport?', 'Ehn! Who send you come? Go and price am for your papa shop!', 'You dey whine me? Comot hand for my market!', 'Abeg abeg, no come spoil my market for morning.'],
  accept: ['Oya bring money. You sabi price sha.', 'Take am, God go bless your hand.', 'Ehen! Na so. Make you come back o.', 'Okay o. Na you win today.'],
  acceptHigh: ['Thank you my customer! God bless you!', 'Ah, you no even price. Correct person!'],
  begOk: ['Hmm, because you talk am sweet... {p}.', 'You get mouth o! Okay, {p}.', 'For your sake. {p}.'],
  begNo: ['Begging no dey buy garri.', 'Sweet mouth no go pay my rent.', 'Na so all of una dey talk.'],
  callback: ['Customer! Come, come! Bring {p}!', 'Eh, wait! Wait! Oya {p}, come carry am.', 'No vex! Come back, {p} final!'],
  letgo: ['Go! Na your loss.', 'Oya waka. Another customer go buy am.'],
  angry: ['Comot for my front! I no sell for you again today.', 'You don waste my time. Go!'],
  fixed: ['Na fixed price. No price am.', 'This one no get price, na {p} everybody dey pay.'],
  two: ['Two? Okay, I go reduce small. {p} for both.', 'Ehen, buy plenty! {p} for the two.'],
};
const fmt = (s: string, p: number, i = '') => s.replace('{p}', '₦' + p.toLocaleString()).replace('{i}', i);

export function openDeal(g: Good, fair: number, who: Persona, mem: Memory, tradeLvl: number): DealState {
  const reg = Math.max(-0.5, Math.min(1, mem.regard));
  const ask = g.fixed ? r50(fair) : r50(fair * (1.35 + 0.5 * who.stubborn + Math.random() * 0.15) * (1 - reg * 0.15));
  const reserve = g.fixed ? ask : r50(fair * (0.8 + 0.2 * who.stubborn) * (1 - reg * 0.08) * (1 - Math.min(10, tradeLvl) * 0.012));
  const d: DealState = { good: g, qty: 1, ask, reserve: Math.min(reserve, ask), patience: who.patience + (reg > 0.4 ? 1 : 0), rounds: 0, fair, done: false, price: 0, log: [], called: false };
  d.log.push({ who: 'her', text: g.fixed ? fmt(pick(LINES.fixed), ask) : fmt(pick(mem.deals > 2 && reg > 0.2 ? LINES.openRegular : LINES.open), ask, g.label.toLowerCase()) });
  return d;
}

export type Move = { k: 'offer'; n: number } | { k: 'beg'; charm: number } | { k: 'two' } | { k: 'walk' } | { k: 'pay' };
export type Outcome = 'deal' | 'counter' | 'angry' | 'gone' | 'same';

export function play(d: DealState, m: Move, who: Persona): Outcome {
  if (d.done) return 'same';
  const say = (t: string) => d.log.push({ who: 'her', text: t }); const me = (t: string) => d.log.push({ who: 'you', text: t });
  const deal = (p: number) => { d.done = true; d.price = p; say(pick(p >= d.fair * d.qty * 1.1 ? LINES.acceptHigh : LINES.accept)); return 'deal' as const; };
  const lose = (n = 1) => { d.patience -= n; if (d.patience <= 0) { d.done = true; say(pick(LINES.angry)); return true; } return false; };
  d.rounds++;
  if (m.k === 'pay') { me(pick(['Okay, I go pay.', 'No wahala, take your money.'])); return deal(d.ask); }
  if (d.good.fixed && m.k !== 'walk') { say(fmt(pick(LINES.fixed), d.ask)); return 'same'; }
  if (m.k === 'two') {
    if (d.qty === 2 || !d.good.qty2) return 'same';
    me('If I buy two nko?'); d.qty = 2; d.ask = r50(d.ask * 2 * 0.93); d.reserve = r50(d.reserve * 2 * 0.92); say(fmt(pick(LINES.two), d.ask)); return 'counter';
  }
  if (m.k === 'beg') {
    me(pick(['Mummy abeg, na customer price I want.', 'Mama, consider me now. Things hard.', 'Abeg do am for me, I go dey come back.']));
    const ok = Math.random() < 0.3 + m.charm * 0.04 + who.warmth * 0.3 - d.rounds * 0.04;
    if (ok && d.ask > d.reserve) { d.ask = Math.max(d.reserve, r50(d.ask - (d.ask - d.reserve) * 0.35)); say(fmt(pick(LINES.begOk), d.ask)); return 'counter'; }
    say(pick(LINES.begNo)); return lose() ? 'angry' : 'same';
  }
  if (m.k === 'walk') {
    me(pick(['Okay, I go check another person.', 'Na wa o. Make I dey go.']));
    const room = (d.ask - d.reserve) / Math.max(1, d.fair * d.qty);
    if (!d.good.fixed && room > 0.06 && d.patience > 1 && Math.random() < 0.55 + room) { d.called = true; d.ask = Math.max(d.reserve, r50(d.ask * (0.84 - Math.random() * 0.05))); say(fmt(pick(LINES.callback), d.ask)); return 'counter'; }
    d.done = true; say(pick(LINES.letgo)); return 'gone';
  }
  const o = r50(m.n); me(`I go pay ₦${o.toLocaleString()}.`);
  if (o >= d.ask) return deal(o);
  if (o < d.reserve * 0.55) { say(pick(LINES.insult)); return lose(2) ? 'angry' : 'same'; }
  if (o >= d.reserve) {
    const near = 1 - (d.ask - o) / Math.max(1, d.ask - d.reserve);
    if (Math.random() < 0.2 + 0.45 * near + d.rounds * 0.07 - who.stubborn * 0.15) return deal(o);
    d.ask = Math.max(o + 50, r50(d.ask - (d.ask - o) * (0.35 + 0.25 * (1 - who.stubborn)))); say(fmt(pick(LINES.counter), d.ask)); lose(0.5); return 'counter';
  }
  d.ask = Math.max(d.reserve, r50(d.ask - (d.ask - d.reserve) * 0.22)); say(fmt(pick(LINES.close), d.ask));
  return lose() ? 'angry' : 'counter';
}
