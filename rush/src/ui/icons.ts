// Inline SVG icons for items and UI. Simple, bold silhouettes that read at a glance on a phone.
import type { ItemId } from '../shared/items';

const svg = (body: string, vb = '0 0 64 64') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const ITEM_ICON: Record<ItemId, string> = {
  purewater: svg('<path d="M32 6c9 14 18 23 18 34a18 18 0 0 1-36 0C14 29 23 20 32 6z" fill="#7fd4ff"/><rect x="18" y="34" width="28" height="10" rx="2" fill="#fff"/><text x="32" y="42" font-size="8" font-weight="800" text-anchor="middle" fill="#1d6ad6" font-family="Barlow Condensed">PURE</text>'),
  pothole: svg('<ellipse cx="32" cy="40" rx="26" ry="14" fill="#3a2a1e"/><ellipse cx="32" cy="38" rx="17" ry="8" fill="#0d0a08"/><path d="M8 34l8-6 6 5 7-8 6 6 8-7 6 6 7-4" stroke="#8a6a4a" stroke-width="3" fill="none"/>'),
  horn: svg('<path d="M10 26h10l22-14v40L20 38H10z" fill="#ffb300"/><path d="M48 22c5 5 5 15 0 20M53 16c9 9 9 23 0 32" stroke="#ffb300" stroke-width="4" fill="none" stroke-linecap="round"/>'),
  rocket: svg('<g transform="rotate(-35 32 32)"><rect x="24" y="10" width="16" height="40" rx="8" fill="#d8a040"/><rect x="24" y="24" width="16" height="12" fill="#d0141c"/><path d="M24 44l-8 10h10zM40 44l8 10H38z" fill="#d0141c"/></g><circle cx="14" cy="52" r="5" fill="#ff8a1f"/>'),
  genboost: svg('<rect x="10" y="20" width="44" height="30" rx="4" fill="#39ff14"/><path d="M34 22L22 38h9l-3 12 13-17h-9z" fill="#0b0b0d"/><rect x="16" y="14" width="10" height="6" fill="#39ff14"/>'),
  blackout: svg('<path d="M32 8a16 16 0 0 0-9 29v7h18v-7A16 16 0 0 0 32 8z" fill="#8a5cff"/><rect x="24" y="47" width="16" height="5" fill="#8a5cff"/><path d="M10 10l44 44" stroke="#0b0b0d" stroke-width="6"/><path d="M10 10l44 44" stroke="#fff" stroke-width="2.5"/>'),
  danfo: svg('<rect x="6" y="18" width="52" height="28" rx="6" fill="#ffd000"/><rect x="12" y="22" width="36" height="10" fill="#1a2026"/><rect x="6" y="36" width="52" height="3" fill="#111"/><circle cx="18" cy="48" r="6" fill="#111"/><circle cx="46" cy="48" r="6" fill="#111"/>'),
  okada: svg('<circle cx="16" cy="44" r="9" fill="none" stroke="#ff6a00" stroke-width="4"/><circle cx="48" cy="44" r="9" fill="none" stroke="#ff6a00" stroke-width="4"/><path d="M16 44l12-14h12l8 14M28 30l-4-8h-6M40 30l4-10" stroke="#ff6a00" stroke-width="4" fill="none" stroke-linejoin="round"/><circle cx="34" cy="14" r="5" fill="#ff6a00"/>'),
};

export const UI_ICON = {
  back: svg('<path d="M40 12L20 32l20 20" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  gear: svg('<path d="M32 20a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm22 9l6-3-4-9-7 2a20 20 0 0 0-5-5l2-7-9-4-3 6a20 20 0 0 0-7 0l-3-6-9 4 2 7a20 20 0 0 0-5 5l-7-2-4 9 6 3a20 20 0 0 0 0 7l-6 3 4 9 7-2a20 20 0 0 0 5 5l-2 7 9 4 3-6a20 20 0 0 0 7 0l3 6 9-4-2-7a20 20 0 0 0 5-5l7 2 4-9-6-3a20 20 0 0 0 0-7z" fill="currentColor"/>'),
  user: svg('<circle cx="32" cy="22" r="12" fill="currentColor"/><path d="M10 58c2-14 11-20 22-20s20 6 22 20z" fill="currentColor"/>'),
  users: svg('<circle cx="22" cy="24" r="9" fill="currentColor"/><circle cx="44" cy="22" r="8" fill="currentColor" opacity=".7"/><path d="M4 56c2-11 9-16 18-16s16 5 18 16zM34 40c8-3 20 0 24 14H42c-1-6-4-11-8-14z" fill="currentColor"/>'),
  trophy: svg('<path d="M18 8h28v14a14 14 0 0 1-28 0zM18 12H8c0 10 5 14 10 14M46 12h10c0 10-5 14-10 14M26 40h12v8H26zM20 50h24v6H20z" fill="currentColor"/>'),
  car: svg('<path d="M8 38l6-14c2-4 5-6 10-6h16c5 0 8 2 10 6l6 14v10H8z" fill="currentColor"/><circle cx="18" cy="48" r="6" fill="#0b0b0d"/><circle cx="46" cy="48" r="6" fill="#0b0b0d"/>'),
  map: svg('<path d="M4 14l18-6 20 6 18-6v42l-18 6-20-6-18 6z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M22 8v42M42 14v42" stroke="currentColor" stroke-width="3"/>'),
  play: svg('<path d="M18 10l36 22-36 22z" fill="currentColor"/>'),
  lock: svg('<rect x="14" y="28" width="36" height="28" rx="4" fill="currentColor"/><path d="M22 28v-8a10 10 0 0 1 20 0v8" stroke="currentColor" stroke-width="6" fill="none"/>'),
  copy: svg('<rect x="18" y="18" width="34" height="38" rx="4" fill="none" stroke="currentColor" stroke-width="5"/><path d="M12 44V12a4 4 0 0 1 4-4h24" stroke="currentColor" stroke-width="5" fill="none"/>'),
  share: svg('<circle cx="48" cy="14" r="8" fill="currentColor"/><circle cx="16" cy="32" r="8" fill="currentColor"/><circle cx="48" cy="50" r="8" fill="currentColor"/><path d="M22 28l20-10M22 36l20 10" stroke="currentColor" stroke-width="4"/>'),
  check: svg('<path d="M12 34l12 12 28-28" stroke="currentColor" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  crown: svg('<path d="M8 48l-2-30 14 12 12-20 12 20 14-12-2 30z" fill="currentColor"/>'),
  wifi: svg('<path d="M6 24a38 38 0 0 1 52 0M14 33a26 26 0 0 1 36 0M22 42a14 14 0 0 1 20 0" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="32" cy="51" r="4" fill="currentColor"/>'),
};
