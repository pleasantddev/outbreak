// Loading screen behaviour. The markup and its look live in index.html so it paints before any script runs:
// key art shot inside our own Lagos, the logo, a progress bar and tips. This class only drives it.
const TIPS = [
  'Press T for your phone. Hustles, bank and land all live in there.',
  'Rain fills the potholes. Drive slow or lose your tyre.',
  'Land is the real money. Open the LANDMAP with M and find a plot.',
  'Any car can be jacked. The owner will have something to say about it.',
  'Conductor Sule pays small, but his jobs are clean. Mostly.',
  'The police see you before you see them. Shine your eye.',
  'Walk up to any car and press E. Even one with a driver inside.',
  'Lagos does not wait for you. Neither does the delivery timer.',
  'Bank your cash. A pocket full of naira is a gift to anybody nearby.',
  'Every pothole in the game is from a real report on a real road.',
];

export class Intro {
  private root: HTMLElement | null = document.getElementById('boot');
  private bar = document.getElementById('loadbar') as HTMLElement | null;
  private txt = document.getElementById('loadtxt');
  private pct = document.getElementById('loadpct');
  private tipEl = document.getElementById('tip');
  private tipTxt = document.getElementById('tiptxt');
  private target = 0; private shown = 0; private raf = 0; private timers: number[] = [];
  private tip = (Math.random() * TIPS.length) | 0;
  done = false;
  constructor() {
    // slides that have no image yet (art not generated) simply show the gradient behind them
    const slides = [...(this.root?.querySelectorAll('.slide') ?? [])] as HTMLElement[];
    let i = 0;
    if (slides.length > 1) this.timers.push(window.setInterval(() => { slides[i].classList.remove('on'); i = (i + 1) % slides.length; slides[i].classList.add('on'); }, 6500));
    this.showTip(); this.timers.push(window.setInterval(() => this.nextTip(), 5200));
    const tick = () => { this.shown += (this.target - this.shown) * 0.12; if (Math.abs(this.target - this.shown) < 0.002) this.shown = this.target; if (this.pct) this.pct.textContent = `${Math.round(this.shown * 100)}%`; if (!this.done) this.raf = requestAnimationFrame(tick); };
    tick();
  }
  private showTip() { if (this.tipTxt) this.tipTxt.textContent = TIPS[this.tip % TIPS.length]; }
  private nextTip() {
    if (!this.tipEl) return; this.tipEl.style.opacity = '0';
    window.setTimeout(() => { this.tip++; this.showTip(); if (this.tipEl) this.tipEl.style.opacity = '1'; }, 450);
  }
  setLoad(p: number, text?: string) { this.target = Math.max(this.target, Math.min(1, p)); if (this.bar) this.bar.style.width = `${Math.round(this.target * 100)}%`; if (text && this.txt) this.txt.textContent = text; }
  /** Fade the loading screen away and remove it. Resolves when it is gone. */
  finish(): Promise<void> {
    if (this.done || !this.root) return Promise.resolve();
    this.done = true; this.setLoad(1, 'Lagos is ready'); cancelAnimationFrame(this.raf);
    if (this.pct) this.pct.textContent = '100%';
    for (const t of this.timers) clearInterval(t);
    const r = this.root; r.classList.add('out');
    return new Promise((res) => window.setTimeout(() => { r.remove(); this.root = null; res(); }, 950));
  }
  /** Remove at once (automated runs, key art capture). */
  drop() { this.done = true; cancelAnimationFrame(this.raf); for (const t of this.timers) clearInterval(t); this.root?.remove(); this.root = null; }
}
export const intro = new Intro();
