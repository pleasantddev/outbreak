// Driver portraits: a front facing bust drawn as SVG from a DriverLook, for the driver screen, lobbies and the
// podium. Flat shapes and calm proportions; the headwear does the talking.
import { SKINS, type DriverLook } from '../shared/drivers';

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

let clipN = 0;
export function portraitSvg(look: DriverLook, size = 64, ring = '') {
  const clip = `pc${++clipN}`;
  const skin = SKINS[look.skin] ?? SKINS[2];
  const sk2 = shade(skin, 0.8), dark = '#16100e';
  const top = look.top, acc = look.accent, acc2 = shade(acc, 0.72);
  const helmet = look.head === 'helmet';
  // shoulders, collar, neck and head
  let body = `
    <path d="M12 100 C14 84 26 76 50 74 C74 76 86 84 88 100 Z" fill="${top}"/>
    <path d="M38 75 L50 88 L62 75" fill="none" stroke="${acc}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="43" y="60" width="14" height="16" rx="5" fill="${sk2}"/>`;
  if (!helmet) {
    body += `
    <ellipse cx="34.5" cy="49" rx="3.2" ry="4.6" fill="${sk2}"/><ellipse cx="65.5" cy="49" rx="3.2" ry="4.6" fill="${sk2}"/>
    <ellipse cx="50" cy="47" rx="16" ry="19" fill="${skin}"/>
    <path d="M40.5 42.5 Q44 40.8 47.5 42.2 M52.5 42.2 Q56 40.8 59.5 42.5" stroke="${dark}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <ellipse cx="44" cy="47.5" rx="2" ry="2.4" fill="${dark}"/><ellipse cx="56" cy="47.5" rx="2" ry="2.4" fill="${dark}"/>
    <circle cx="44.7" cy="46.7" r="0.6" fill="#fff" opacity="0.8"/><circle cx="56.7" cy="46.7" r="0.6" fill="#fff" opacity="0.8"/>
    <path d="M48 53.5 Q50 55 52 53.5" stroke="${sk2}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M45 58.5 Q50 61.5 55 58.5" stroke="${shade(skin, 0.62)}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
  }
  let hat = '';
  switch (look.head) {
    case 'none': hat = `<path d="M34 46 C33 30 42 26 50 26 C58 26 67 30 66 46 C63 37 57 34.5 50 34.5 C43 34.5 37 37 34 46 Z" fill="${dark}"/>`; break;
    case 'cap': hat = `
      <path d="M33 41 C33 26 42 23 50 23 C58 23 67 26 67 41 Z" fill="${acc}"/>
      <path d="M50 23 L50 41" stroke="${acc2}" stroke-width="1"/>
      <path d="M31 41 Q50 47 69 41 Q50 43.5 31 41 Z" fill="${acc2}"/>
      <circle cx="50" cy="23.5" r="1.6" fill="${acc2}"/>`; break;
    case 'fila': hat = `
      <path d="M33.5 42 C32 32 37 25 47 22.5 L69 16 C71 24 68 34 66.5 42 Q50 38 33.5 42 Z" fill="${acc}"/>
      <path d="M47 22.5 L69 16 L60 28 Z" fill="${acc2}"/>
      <path d="M35 40.5 Q50 36.8 66 40.5" stroke="${top}" stroke-width="1.6" fill="none"/>`; break;
    case 'gele': hat = `
      <path d="M31 44 C24 34 22 20 30 12 C36 18 40 16 43 8 C47 14 53 14 57 8 C60 16 64 18 70 12 C78 20 76 34 69 44 Q50 36 31 44 Z" fill="${acc}"/>
      <path d="M34 38 C33 28 36 22 41 18 M44 36 C44 27 46 21 50 15 M56 36 C56 27 54 21 50 15 M66 38 C67 28 64 22 59 18" stroke="${acc2}" stroke-width="1.4" fill="none"/>
      <path d="M32 43 Q50 35.5 68 43" stroke="${top}" stroke-width="2" fill="none"/>`; break;
    case 'durag': hat = `
      <path d="M33.5 45 C32 30 41 25 50 25 C59 25 68 30 66.5 45 C62 37 57 35 50 35 C43 35 38 37 33.5 45 Z" fill="${acc}"/>
      <path d="M50 25 L50 35" stroke="${acc2}" stroke-width="1.2"/>
      <path d="M64 46 C70 54 72 62 70 74 L66 73 C67 63 66 56 61 50 Z" fill="${acc2}"/>`; break;
    case 'helmet': hat = `
      <path d="M26 52 C24 30 36 20 50 20 C64 20 76 30 74 52 L72 66 Q50 72 28 66 Z" fill="${acc}"/>
      <rect x="31" y="38" width="38" height="15" rx="7" fill="#0c1016"/>
      <path d="M34 41 L49 41" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.55"/>
      <path d="M45 20.5 L45 37 M55 20.5 L55 37" stroke="${top}" stroke-width="3.5"/>
      <path d="M36 61 Q50 65 64 61" stroke="${acc2}" stroke-width="2" fill="none"/>`; break;
  }
  const ringEl = ring ? `<circle cx="50" cy="50" r="48" fill="none" stroke="${ring}" stroke-width="3"/>` : '';
  return `<svg class="portrait" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="Driver"><defs><clipPath id="${clip}"><circle cx="50" cy="50" r="49"/></clipPath></defs><circle cx="50" cy="50" r="49" fill="#1d1d23"/><g clip-path="url(#${clip})">${body}${hat}</g>${ringEl}</svg>`;
}
