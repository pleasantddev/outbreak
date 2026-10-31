// Phone app icons, drawn like real app icons: a rounded square with its own gradient and light, and a solid glyph
// with a soft shadow. One per app name; unknown apps get a clean monogram tile instead of a bare outline.
const tile = (id: string, a: string, b: string, glyph: string, glow = 'rgba(255,255,255,.35)') => `<svg viewBox="0 0 60 60" class="ico" aria-hidden="true">
<defs><linearGradient id="g${id}" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="h${id}" cx="0.3" cy="0.05" r="0.9"><stop offset="0" stop-color="${glow}"/><stop offset="0.55" stop-color="rgba(255,255,255,0)"/></radialGradient>
<filter id="s${id}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#000" flood-opacity=".28"/></filter></defs>
<rect width="60" height="60" rx="14" fill="url(#g${id})"/><rect width="60" height="60" rx="14" fill="url(#h${id})"/>
<g filter="url(#s${id})">${glyph}</g></svg>`;
const W = '#fff';
const GLYPHS: Record<string, [string, string, string, string?]> = {
  // [top colour, bottom colour, glyph]
  Map: ['#3ee6c9', '#0e8f7f', `<path d="M14 18l10-4 12 4 10-4v28l-10 4-12-4-10 4z" fill="${W}" opacity=".95"/><path d="M24 14v28M36 18v28" stroke="#0e8f7f" stroke-width="1.6" opacity=".5"/><path d="M38 17a6 6 0 0 1 6 6c0 5-6 10-6 10s-6-5-6-10a6 6 0 0 1 6-6z" fill="#ff4d5e"/><circle cx="38" cy="23" r="2.2" fill="${W}"/>`],
  Hustles: ['#ffcf5a', '#e08a0c', `<rect x="13" y="21" width="34" height="23" rx="4" fill="${W}"/><path d="M24 21v-4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" stroke="${W}" stroke-width="3" fill="none"/><rect x="13" y="29" width="34" height="3" fill="#e08a0c" opacity=".55"/><rect x="27" y="27" width="6" height="7" rx="1.5" fill="#e08a0c"/>`],
  Texts: ['#6fe28a', '#18a34a', `<path d="M30 14c9.4 0 17 6 17 13.5S39.4 41 30 41c-1.8 0-3.6-.2-5.2-.7L16 45l2.6-7.4C15.3 35.2 13 31.6 13 27.5 13 20 20.6 14 30 14z" fill="${W}"/>`],
  Messages: ['#6fe28a', '#18a34a', `<path d="M30 14c9.4 0 17 6 17 13.5S39.4 41 30 41c-1.8 0-3.6-.2-5.2-.7L16 45l2.6-7.4C15.3 35.2 13 31.6 13 27.5 13 20 20.6 14 30 14z" fill="${W}"/>`],
  Phone: ['#6fe28a', '#18a34a', `<path d="M22 14c1.5 0 2.4.6 3 2l2.4 5.6c.6 1.5.2 2.6-.9 3.6l-2.2 1.8c1.6 3.6 4.4 6.4 8 8l1.8-2.2c1-1.1 2.1-1.5 3.6-.9l5.6 2.4c1.4.6 2 1.5 2 3v3.2c0 2.6-2.2 4.6-4.8 4.4C25.8 43.3 16.7 34.2 15.6 19.4 15.4 16.8 17.4 14 20 14z" fill="${W}"/>`],
  Contacts: ['#b9c2cc', '#6b7480', `<rect x="15" y="13" width="30" height="34" rx="5" fill="${W}"/><circle cx="30" cy="26" r="5.5" fill="#6b7480"/><path d="M20.5 41c1.6-5 5.2-7.6 9.5-7.6s7.9 2.6 9.5 7.6z" fill="#6b7480"/><rect x="11" y="19" width="5" height="3" rx="1.5" fill="${W}"/><rect x="11" y="27" width="5" height="3" rx="1.5" fill="${W}"/><rect x="11" y="35" width="5" height="3" rx="1.5" fill="${W}"/>`],
  Land: ['#b69bff', '#6334e8', `<path d="M10 44l14-10 10 6 16-10v14z" fill="${W}" opacity=".55"/><path d="M10 44l14-10 10 6 16-10" stroke="${W}" stroke-width="2.4" fill="none" stroke-linejoin="round"/><path d="M33 14v20" stroke="${W}" stroke-width="2.6"/><path d="M33 14l11 4-11 4z" fill="#ffcf5a"/>`],
  Bank: ['#4b5168', '#141724', `<path d="M30 12l17 8v3H13v-3z" fill="${W}"/><rect x="16" y="25" width="4" height="13" rx="1" fill="${W}"/><rect x="24" y="25" width="4" height="13" rx="1" fill="${W}"/><rect x="32" y="25" width="4" height="13" rx="1" fill="${W}"/><rect x="40" y="25" width="4" height="13" rx="1" fill="${W}"/><rect x="12" y="40" width="36" height="5" rx="1.5" fill="${W}"/><text x="30" y="21.5" font-family="Inter,Arial" font-size="7" font-weight="900" fill="#141724" text-anchor="middle">₦</text>`],
  Wallet: ['#5ef0a0', '#0f9d58', `<rect x="12" y="19" width="36" height="25" rx="5" fill="${W}"/><path d="M15 19l20-6 3 6" fill="${W}" opacity=".8"/><rect x="34" y="27" width="14" height="9" rx="3" fill="#0f9d58"/><circle cx="39" cy="31.5" r="1.8" fill="${W}"/>`],
  Weather: ['#8fd0ff', '#2f7fe0', `<circle cx="24" cy="24" r="8" fill="#ffd34d"/><path d="M22 44h17a7 7 0 0 0 .6-14 9 9 0 0 0-17.2 2.6A5.8 5.8 0 0 0 22 44z" fill="${W}"/>`],
  Roads: ['#ff9a68', '#d1452c', `<path d="M23 12h14l7 36H16z" fill="#3b3f4a"/><path d="M30 15v5M30 25v5M30 35v6" stroke="#ffd34d" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="37" cy="39" rx="3.2" ry="1.6" fill="#1d1f25"/>`],
  Skills: ['#ff86a6', '#cf2f68', `<path d="M30 13l4.8 9.8 10.8 1.6-7.8 7.6 1.8 10.8L30 37.7l-9.6 5.1 1.8-10.8-7.8-7.6 10.8-1.6z" fill="${W}"/>`],
  Settings: ['#a2a9b3', '#555c66', `<path d="M27.5 12h5l1 5 3.4 1.4 4.3-2.8 3.5 3.5-2.8 4.3L43 26.8l5 1v5l-5 1-1.4 3.4 2.8 4.3-3.5 3.5-4.3-2.8L33.2 43l-1 5h-5l-1-5-3.4-1.4-4.3 2.8-3.5-3.5 2.8-4.3L16.4 33l-5-1v-5l5-1 1.4-3.4-2.8-4.3 3.5-3.5 4.3 2.8L26.5 17z" fill="${W}"/><circle cx="30" cy="30" r="5.5" fill="#555c66"/>`],
  ChopNow: ['#ff8c4a', '#e2400c', `<path d="M17 24h26l-2.6 20.2a3 3 0 0 1-3 2.8H22.6a3 3 0 0 1-3-2.8z" fill="${W}"/><path d="M23 24v-3a7 7 0 0 1 14 0v3" stroke="${W}" stroke-width="3" fill="none"/><circle cx="30" cy="35" r="4.5" fill="#e2400c"/>`],
  Home: ['#3ee6c9', '#0e8f7f', `<path d="M30 13l17 14h-5v18H18V27h-5z" fill="${W}"/><rect x="26" y="33" width="8" height="12" rx="1.5" fill="#0e8f7f"/>`],
  House: ['#5cc8ff', '#0567a8', `<path d="M27 14l15 12h-4v17H16V26h-4z" fill="${W}"/><path d="M37 30l9 9-3 3-9-9a5 5 0 1 1 3-3z" fill="#ffcf5a" stroke="#0567a8" stroke-width="1.2"/>`],
  Career: ['#a98bff', '#4c1d95', `<path d="M21 46V14M39 46V14" stroke="${W}" stroke-width="3.2" stroke-linecap="round"/><path d="M21 20h18M21 28h18M21 36h18" stroke="${W}" stroke-width="2.6"/><circle cx="44" cy="15" r="5" fill="#ffcf5a"/>`],
  Business: ['#ffb547', '#c25e00', `<path d="M13 22l3-8h28l3 8z" fill="${W}"/><path d="M13 22h34v3a4 4 0 0 1-8.5 0 4 4 0 0 1-8.5 0 4 4 0 0 1-8.5 0A4 4 0 0 1 13 25z" fill="#ffe2b0"/><rect x="16" y="30" width="28" height="15" rx="1.5" fill="${W}"/><rect x="21" y="34" width="8" height="11" fill="#c25e00"/><rect x="32" y="34" width="8" height="6" rx="1" fill="#c25e00" opacity=".55"/>`],
  Light: ['#ffe066', '#e0a400', `<path d="M30 12a11 11 0 0 1 6.5 19.9c-1.3 1-2 2.3-2 3.9V37h-9v-1.2c0-1.6-.7-2.9-2-3.9A11 11 0 0 1 30 12z" fill="${W}"/><rect x="25.5" y="39" width="9" height="3.2" rx="1.2" fill="${W}"/><rect x="26.5" y="43.5" width="7" height="3" rx="1.5" fill="${W}"/><path d="M27 26l3 4 3-4" stroke="#e0a400" stroke-width="1.8" fill="none"/>`],
  Car: ['#9aa7b8', '#2e3746', `<path d="M14 36v-6l4-9h24l4 9v6z" fill="${W}"/><path d="M20 22h20l2.6 7H17.4z" fill="#2e3746" opacity=".75"/><rect x="14" y="36" width="7" height="6" rx="2" fill="${W}"/><rect x="39" y="36" width="7" height="6" rx="2" fill="${W}"/><circle cx="20" cy="32" r="2" fill="#ffcf5a"/><circle cx="40" cy="32" r="2" fill="#ffcf5a"/>`],
  Garage: ['#9aa7b8', '#2e3746', `<path d="M12 24l18-11 18 11v22H12z" fill="${W}"/><rect x="17" y="28" width="26" height="18" fill="#2e3746"/><path d="M17 32h26M17 36h26M17 40h26" stroke="${W}" stroke-width="1.4" opacity=".6"/>`],
  OjaHome: ['#ff8aa0', '#be123c', `<rect x="13" y="28" width="34" height="11" rx="3" fill="${W}"/><path d="M17 28v-6a3 3 0 0 1 3-3h20a3 3 0 0 1 3 3v6" fill="${W}" opacity=".85"/><rect x="11" y="26" width="6" height="13" rx="2.5" fill="${W}"/><rect x="43" y="26" width="6" height="13" rx="2.5" fill="${W}"/><path d="M16 39v5M44 39v5" stroke="${W}" stroke-width="2.6" stroke-linecap="round"/>`],
  Market: ['#ffcf5a', '#d97706', `<path d="M14 26h32l-3.4 17.4a3 3 0 0 1-3 2.6H20.4a3 3 0 0 1-3-2.6z" fill="${W}"/><path d="M20 26l6-11M40 26l-6-11" stroke="${W}" stroke-width="3" stroke-linecap="round"/><circle cx="25" cy="34" r="3" fill="#ef4444"/><circle cx="33" cy="33" r="3.4" fill="#22c55e"/><circle cx="31" cy="39" r="2.6" fill="#f59e0b"/>`],
  Street: ['#ff7a8a', '#b91c3c', `<circle cx="22" cy="21" r="5" fill="${W}"/><circle cx="38" cy="21" r="5" fill="${W}"/><path d="M13 42c1-6.4 4.4-10 9-10s8 3.6 9 10zM29 42c1-6.4 4.4-10 9-10s8 3.6 9 10z" fill="${W}"/>`],
  MyAds: ['#ff5f6d', '#a4133c', `<rect x="12" y="15" width="36" height="21" rx="2.5" fill="${W}"/><path d="M18 30l7-8 5 5 4-4 8 7z" fill="#a4133c" opacity=".8"/><path d="M22 36l-3 10M38 36l3 10" stroke="${W}" stroke-width="3" stroke-linecap="round"/>`],
  Music: ['#ff6ad5', '#7b2ff7', `<path d="M24 40V18l20-5v22" stroke="${W}" stroke-width="3.4" fill="none" stroke-linejoin="round"/><circle cx="19.5" cy="40" r="5.5" fill="${W}"/><circle cx="39.5" cy="35" r="5.5" fill="${W}"/>`],
  Property: ['#34d399', '#047857', `<circle cx="22" cy="24" r="8.5" stroke="${W}" stroke-width="4" fill="none"/><path d="M28 30l16 16M38 40l4-4M42 44l3-3" stroke="${W}" stroke-width="4" stroke-linecap="round"/>`],
  Police: ['#4f7cff', '#1e2a78', `<path d="M30 12l15 5v10c0 9.5-6.4 16.4-15 20-8.6-3.6-15-10.5-15-20V17z" fill="${W}"/><path d="M30 20l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#1e2a78"/>`],
  LASTMA: ['#ffd34d', '#c2410c', `<path d="M30 12l11 32H19z" fill="${W}"/><path d="M23.6 31h12.8M21.6 37h16.8" stroke="#c2410c" stroke-width="3"/><rect x="15" y="43" width="30" height="4" rx="2" fill="${W}"/>`],
  Wardrobe: ['#c4a7ff', '#6d28d9', `<path d="M30 17a3.5 3.5 0 1 1 3.5 3.5c-1.4 0-3.5 1-3.5 3v1.5" stroke="${W}" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M30 25L12 38a2 2 0 0 0 1.2 3.6h33.6A2 2 0 0 0 48 38z" fill="${W}"/>`],
  Clubs: ['#ff4fd8', '#3b0764', `<circle cx="30" cy="31" r="13" fill="${W}"/><path d="M17.5 27h25M17.5 35h25M30 18v26M22 20.5c3 6.5 3 14.5 0 21M38 20.5c-3 6.5-3 14.5 0 21" stroke="#3b0764" stroke-width="1.4" opacity=".55" fill="none"/><path d="M30 12v6" stroke="${W}" stroke-width="2"/>`],
  Calls: ['#6fe28a', '#18a34a', `<path d="M22 14c1.5 0 2.4.6 3 2l2.4 5.6c.6 1.5.2 2.6-.9 3.6l-2.2 1.8c1.6 3.6 4.4 6.4 8 8l1.8-2.2c1-1.1 2.1-1.5 3.6-.9l5.6 2.4c1.4.6 2 1.5 2 3v3.2c0 2.6-2.2 4.6-4.8 4.4C25.8 43.3 16.7 34.2 15.6 19.4 15.4 16.8 17.4 14 20 14z" fill="${W}"/>`],
};
let n = 0;
/** the icon for an app; falls back to a monogram tile in the app's own colour */
export function appIcon(name: string, fallbackColor = '#4b5563') {
  const g = GLYPHS[name]; n++;
  if (g) return tile(String(n), g[0], g[1], g[2]);
  const m = /#([0-9a-f]{6})/gi; const cols = fallbackColor.match(m) ?? ['#6b7280', '#374151'];
  return tile(String(n), cols[0], cols[1] ?? cols[0], `<text x="30" y="39" font-family="Inter,Arial" font-size="24" font-weight="800" fill="#fff" text-anchor="middle">${name.slice(0, 1)}</text>`);
}
/** the accent colour an app uses for its header and buttons */
export function appAccent(name: string, fallback: string) { const g = GLYPHS[name]; if (g) return g[1]; return (fallback.match(/#[0-9a-f]{6}/i) ?? ['#6d3ef0'])[0]; }
