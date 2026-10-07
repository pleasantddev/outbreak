// Tiny DOM helpers: build from a template string, delegate clicks by data-act.
export function el<T extends HTMLElement = HTMLDivElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}
export function acts(root: HTMLElement, handlers: Record<string, (target: HTMLElement, e: Event) => void>) {
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || !root.contains(t)) return;
    const h = handlers[t.dataset.act!];
    if (h) { e.preventDefault(); h(t, e); }
  });
}
/** "1 LAP", "3 LAPS" */
export const laps = (n: number) => `${n} ${n === 1 ? 'LAP' : 'LAPS'}`;
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const naira = (n: number) => `<span class="naira">${Math.round(n).toLocaleString('en-NG')}</span>`;
