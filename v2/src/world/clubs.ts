// Three big parody clubs, built from data/clubs.json (pipe/clubs_gen.py): ZILOX Superclub (Bourdillon Road), GELE Lounge (Okotie Eboh Street)
// and ORUN Rooftop (open-air deck on a 21-level tower on the Lekki side). Ground clubs are real walk-in buildings: collision walls with a door gap,
// LED dance floor, DJ stage, pole stages, bar and VIP sofas. Neon and LED parts use an unlit emissive material so the clubs glow at night.
// Fictional names, no real brands. Pole stages are athletic stage work; the dancers are clothed and are the lead's actors.
import * as THREE from 'three';
import { hash } from './geo';
import { Geo } from './geo';
import { addBox, addCyl, addQuad, type RGB } from './geom';
import { signUV, SIGN_ASPECT } from './signs';
import CLUB_DATA from '../data/clubs.json';

export interface Pose { x: number; y: number; z: number; yaw: number }
export interface ClubDef {
  id: string; name: string; tag: string; kind: 'club' | 'lounge' | 'rooftop'; storeys: number; h: number; x: number; z: number; yaw: number; w: number; d: number; roofY?: number;
  palette: { wall: string; neon: string; accent: string };
  door: Pose & { w: number }; inside: Pose; lift?: { from: { x: number; z: number }; to: Pose };
  dj: Pose; djStage: { w: number; d: number; y: number }; floor: Pose & { w: number; d: number };
  poles: (Pose & { id: string; r: number })[]; bar: Pose & { len: number }; vip: (Pose & { id: string })[];
}
export const CLUBS = CLUB_DATA as unknown as ClubDef[];
const rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const dim = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** True inside (or within m metres of) a ground club's lot: keeps trees and props off it. */
export function inClub(x: number, z: number, m = 0): boolean {
  for (const c of CLUBS) {
    if (c.kind === 'rooftop') continue;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw); const dx = x - c.x, dz = z - c.z;
    const u = dx * fz - dz * fx, v = dx * fx + dz * fz; // R = (fz, -fx)
    if (Math.abs(u) <= c.w / 2 + m + 6 && Math.abs(v) <= c.d / 2 + m + 6) return true;
  }
  return false;
}

export interface ClubCtx { L: Geo; N: Geo; x0: number; z0: number; size: number; sign: (s: { cx: number; cy: number; cz: number; ang: number; w: number; h: number; uv: ReturnType<typeof signUV> }) => void; walls: { ax: number; az: number; bx: number; bz: number; h: number }[]; poles: number[] }

/** signs.ts picks a colour plate from a 0..1 fraction; this maps a plate number 0..9 to it. */
const plate = (i: number) => (i + 0.5) / 10;
/** A geometry that writes into `inner` with every vertex colour scaled: club interiors are self-lit (unlit material) so the room reads at night. */
function dimmed(inner: Geo, k: number): Geo {
  return { v: (p: [number, number, number], n: [number, number, number], uv: [number, number], ex: Record<string, number[]> = {}) => inner.v(p, n, uv, ex.color ? { ...ex, color: ex.color.map((q) => q * k) } : ex), tri: (a: number, b: number, c: number) => inner.tri(a, b, c) } as unknown as Geo;
}
const STEEL: RGB = [0.78, 0.79, 0.83], BLACK: RGB = [0.06, 0.06, 0.07], SOFA: RGB = [0.36, 0.06, 0.14];

export function buildClubs(T: ClubCtx) {
  const { L, N, x0, z0 } = T;
  for (const c of CLUBS) {
    if (c.x < x0 || c.x >= x0 + T.size || c.z < z0 || c.z >= z0 + T.size) continue;
    const neon = rgb(c.palette.neon), acc = rgb(c.palette.accent), wallC = rgb(c.palette.wall);
    const roof = c.kind === 'rooftop'; const gy = roof ? c.roofY! : 0;
    // ground frame: u across (right hand walking in), v from the lot centre toward the back; yaw faces the street
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = fz, rz = -fx; const ry = Math.atan2(rz, rx);
    const P = (u: number, v: number): [number, number] => [c.x + u * rx + v * fx - x0, c.z + u * rz + v * fz - z0];
    const bx = (G: Geo, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, col: RGB, top?: RGB) => { const [x, z] = P((u0 + u1) / 2, (v0 + v1) / 2); addBox(G, x, y0, z, u1 - u0, y1 - y0, v1 - v0, ry, col, top ? { top } : {}); };
    const wallSeg = (u0: number, v0: number, u1: number, v1: number, h: number) => { const a = P(u0, v0), b = P(u1, v1); T.walls.push({ ax: a[0] + x0, az: a[1] + z0, bx: b[0] + x0, bz: b[1] + z0, h }); };
    // pose-based helpers for everything inside (the same data the game reads from clubs.json)
    const WP = (p: { x: number; z: number }): [number, number] => [p.x - x0, p.z - z0];
    const pbox = (G: Geo, p: Pose, du: number, dv: number, w: number, d: number, y0: number, h: number, col: RGB, top?: RGB) => { // centre at pose + du across, dv along facing
      const s = Math.sin(p.yaw), co = Math.cos(p.yaw); const x = p.x - x0 + s * dv + co * du, z = p.z - z0 + co * dv - s * du; addBox(G, x, y0, z, w, h, d, -p.yaw, col, top ? { top } : {}); return [x, z] as const; };
    const dj = c.dj; const fs = Math.sin(dj.yaw), fc = Math.cos(dj.yaw);

    if (!roof) {
      const hw = c.w / 2, hd = c.d / 2, h = c.h, t = 0.4, dw = c.door.w;
      // slab, forecourt, walls with a door gap in the front wall, roof
      bx(L, -hw - 1, hw + 1, -hd - 11, hd + 1, 0, 0.08, [0.2, 0.2, 0.22]);
      bx(L, -hw, hw, -hd, hd, 0.08, 0.1, [0.07, 0.07, 0.09]);
      bx(L, -hw, hw, hd - t, hd, 0, h, wallC); bx(L, -hw, -hw + t, -hd, hd, 0, h, wallC); bx(L, hw - t, hw, -hd, hd, 0, h, wallC);
      bx(L, -hw, -dw / 2, -hd, -hd + t, 0, h, wallC); bx(L, dw / 2, hw, -hd, -hd + t, 0, h, wallC); bx(L, -dw / 2, dw / 2, -hd, -hd + t, 3.4, h, wallC);
      bx(L, -hw - 0.3, hw + 0.3, -hd - 0.3, hd + 0.3, h, h + 0.45, [0.1, 0.1, 0.12], [0.3, 0.3, 0.32]);
      wallSeg(-hw, -hd, -dw / 2, -hd, h); wallSeg(dw / 2, -hd, hw, -hd, h); wallSeg(hw, -hd, hw, hd, h); wallSeg(hw, hd, -hw, hd, h); wallSeg(-hw, hd, -hw, -hd, h);
      // facade: vertical LED stripes (club) or amber round windows and a gold band (lounge)
      if (c.kind === 'club') {
        for (let u = -hw + 1.6; u < hw - 1; u += 2.4) { if (Math.abs(u) < dw / 2 + 1.0) continue; bx(N, u - 0.08, u + 0.08, -hd - 0.06, -hd, 1.0, h - 1.6, Math.round(u / 2.4) % 2 ? neon : acc); }
        bx(N, -hw, hw, -hd - 0.08, -hd, h - 0.9, h - 0.7, neon); bx(N, -hw, hw, -hd - 0.08, -hd, 0.6, 0.78, acc);
      } else {
        bx(N, -hw, hw, -hd - 0.08, -hd, h - 1.0, h - 0.85, neon);
        for (const u of [-hw * 0.62, -hw * 0.34, hw * 0.34, hw * 0.62]) bx(N, u - 0.7, u + 0.7, -hd - 0.07, -hd, 1.9, 3.3, dim(neon, 0.8));
      }
      // door frame (neon), recess and canopy with two posts
      bx(N, -dw / 2 - 0.25, -dw / 2, -hd - 0.1, -hd + 0.1, 0, 3.5, neon); bx(N, dw / 2, dw / 2 + 0.25, -hd - 0.1, -hd + 0.1, 0, 3.5, neon); bx(N, -dw / 2 - 0.25, dw / 2 + 0.25, -hd - 0.1, -hd + 0.1, 3.4, 3.65, neon);
      bx(L, -dw / 2, dw / 2, -hd + 0.3, -hd + 0.5, 0.08, 3.4, [0.03, 0.03, 0.04]);
      bx(L, -dw / 2 - 1.6, dw / 2 + 1.6, -hd - 4.5, -hd, 3.9, 4.1, [0.2, 0.18, 0.12], [0.7, 0.58, 0.2]); bx(N, -dw / 2 - 1.6, dw / 2 + 1.6, -hd - 4.5, -hd - 4.4, 3.85, 4.1, acc);
      for (const u of [-dw / 2 - 1.5, dw / 2 + 1.5]) bx(L, u - 0.08, u + 0.08, -hd - 4.4, -hd - 4.2, 0.08, 3.9, STEEL);
      // queue lane: steel stanchions with a red velvet rope, either side of the door path
      for (const u of [-2.6, 2.6]) for (let v = -hd - 11; v <= -hd - 2.4; v += 1.8) {
        const [x, z] = P(u, v); addCyl(L, x, 0.08, z, 0.035, 0.95, STEEL, 6); addCyl(L, x, 0.08, z, 0.12, 0.04, STEEL, 8);
        if (v < -hd - 2.5) bx(L, u - 0.012, u + 0.012, v, v + 1.8, 0.8, 0.84, [0.62, 0.04, 0.1]);
      }
      // name boards
      const w = c.kind === 'club' ? 20 : 11;
      const [sx, sz] = P(0, -hd - 0.12); T.sign({ cx: sx, cy: h - 2.0, cz: sz, ang: ry, w, h: w / SIGN_ASPECT, uv: signUV(c.name.replace(' Superclub', '').toUpperCase(), c.kind === 'club' ? plate(4) : plate(3)) });
      if (c.kind === 'club') { const [s2x, s2z] = P(0, -hd - 0.12); T.sign({ cx: s2x, cy: h - 4.3, cz: s2z, ang: ry, w: 9, h: 9 / SIGN_ASPECT, uv: signUV('SUPERCLUB  THU TO SUN', plate(1)) }); }
    }
    const LI: Geo = roof ? L : dimmed(N, 0.75);
    // ---- shared interior: floor, DJ stage, pole stages, bar, VIP
    const floorY = gy + (roof ? 0.03 : 0.1);
    if (roof) { // deck on the roof of the tower, glass-and-steel rail, string lights, sign standing on the street edge
      const hw = c.w / 2 + 1.5, hd = c.d / 2 + 1.5; const wx = (u: number, v: number): [number, number] => [c.x + u - x0, c.z + v - z0];
      const [dx0, dz0] = wx(0, 0); addBox(LI, dx0, gy, dz0, hw * 2, 0.06, hd * 2, 0, [0.26, 0.18, 0.12], { top: [0.36, 0.25, 0.16] });
      for (let u = -hw; u <= hw + 0.01; u += 3) for (const v of [-hd, hd]) { const [x, z] = wx(u, v); addCyl(LI, x, gy, z, 0.04, 1.35, STEEL, 6); }
      for (let v = -hd; v <= hd + 0.01; v += 3) for (const u of [-hw, hw]) { const [x, z] = wx(u, v); addCyl(LI, x, gy, z, 0.04, 1.35, STEEL, 6); }
      for (const v of [-hd, hd]) { const [x, z] = wx(0, v); addBox(LI, x, gy + 1.3, z, hw * 2, 0.05, 0.08, 0, STEEL); }
      for (const u of [-hw, hw]) { const [x, z] = wx(u, 0); addBox(LI, x, gy + 1.3, z, 0.08, 0.05, hd * 2, 0, STEEL); }
      // string lights: a warm line of bulbs across the deck, 3 strings
      for (const v of [-6, 0, 6]) for (let u = -hw; u <= hw; u += 0.8) { const [x, z] = wx(u, v); addBox(N, x, gy + 3.5 - 0.5 * Math.sin(((u + hw) / (2 * hw)) * Math.PI), z, 0.12, 0.12, 0.12, 0, [1, 0.8, 0.45]); }
      for (const v of [-6, 0, 6]) for (const u of [-hw, hw]) { const [x, z] = wx(u, v); addCyl(LI, x, gy, z, 0.05, 3.6, STEEL, 6); }
      // ORUN letters standing on the street edge, facing the street (south)
      const [sx, sz] = wx(0, hd + 0.2); T.sign({ cx: sx, cy: gy + 3.2, cz: sz, ang: 0, w: 16, h: 16 / SIGN_ASPECT, uv: signUV('ORUN ROOFTOP', plate(6)) });
      // lobby at the foot of the tower: lit lift portal and a name board by the door
      const d0 = c.door; const lx = d0.x - x0, lz = d0.z - z0;
      addBox(N, lx - 1.7, 0, lz + 0.2, 0.2, 3.2, 0.2, 0, neon); addBox(N, lx + 1.7, 0, lz + 0.2, 0.2, 3.2, 0.2, 0, neon); addBox(N, lx, 3.1, lz + 0.2, 3.6, 0.2, 0.2, 0, neon);
      T.sign({ cx: lx, cy: 4.1, cz: lz + 0.4, ang: 0, w: 5.2, h: 5.2 / SIGN_ASPECT, uv: signUV('ORUN ROOFTOP LIFT', plate(6)) });
    }
    // LED dance floor: 1 m tiles in the palette, a little darker than the neon so the floor reads as lit but not blinding
    {
      const fl = c.floor; const ntx = Math.floor(fl.w), ntz = Math.floor(fl.d); const s = Math.sin(fl.yaw), co = Math.cos(fl.yaw);
      for (let i = 0; i < ntx; i++) for (let j = 0; j < ntz; j++) {
        const lu = -fl.w / 2 + i + 0.5, lv = -fl.d / 2 + j + 0.5; const x = fl.x - x0 + s * lv + co * lu, z = fl.z - z0 + co * lv - s * lu;
        const k = hash(i * 31 + j * 17, c.name.length); const col = k < 0.34 ? neon : k < 0.67 ? acc : [0.45, 0.2, 0.9] as RGB;
        addBox(N, x, floorY, z, 0.94, 0.02, 0.94, -fl.yaw, dim(col, 0.5 + 0.4 * hash(i + j * 13, 4)));
      }
    }
    // DJ: raised stage behind, desk with two decks in front of the DJ, LED wall and speaker stacks
    {
      const sd = c.djStage; const back = c.kind === 'rooftop' ? 1.2 : 1.6;
      pbox(LI, dj, 0, -back, sd.w, sd.d, floorY, sd.y - (floorY - gy), [0.09, 0.09, 0.12], [0.16, 0.16, 0.2]);
      pbox(LI, dj, 0, 0.9, 3.0, 0.8, gy + sd.y, 1.05, [0.1, 0.1, 0.13], [0.2, 0.2, 0.24]);
      pbox(N, dj, 0, 1.31, 3.0, 0.03, gy + sd.y + 0.2, 0.05, neon);
      for (const du of [-0.7, 0.7]) { pbox(LI, dj, du, 0.88, 0.6, 0.6, gy + sd.y + 1.05, 0.1, BLACK); pbox(N, dj, du, 0.88, 0.5, 0.5, gy + sd.y + 1.15, 0.02, acc); }
      const wallV = -back - sd.d / 2 + 0.25;
      for (let i = 0; i < 6; i++) pbox(N, dj, -sd.w * 0.45 + i * (sd.w * 0.9) / 5 + 0.0, wallV, sd.w * 0.9 / 6 - 0.04, 0.12, gy + sd.y + 0.4, 3.6, i % 2 ? dim(neon, 0.85) : dim(acc, 0.85));
      for (const du of [-sd.w / 2 - 0.9, sd.w / 2 + 0.9]) { pbox(LI, dj, du, -back, 1.3, 1.1, floorY, 2.4, [0.07, 0.07, 0.08], [0.12, 0.12, 0.13]); pbox(N, dj, du, -back + 0.56, 0.7, 0.02, floorY + 1.3, 0.7, [0.2, 0.2, 0.22]); }
    }
    // pole stages: low round platform with a lit rim and a chrome pole up to the rig
    for (const pl of c.poles) {
      const x = pl.x - x0, z = pl.z - z0; const top = roof ? 3.6 : Math.min(c.h - 0.6, 5.0);
      addCyl(LI, x, floorY - 0.0, z, pl.r, pl.y - floorY, [0.07, 0.07, 0.09], 18); addCyl(N, x, pl.y, z, pl.r, 0.04, neon, 18); addCyl(N, x, pl.y, z, pl.r - 0.18, 0.045, [0.03, 0.03, 0.04], 18);
      addCyl(LI, x, pl.y, z, 0.045, top - (pl.y - gy), STEEL, 8); addCyl(LI, x, gy + top - 0.05, z, 0.16, 0.1, STEEL, 8);
      T.poles.push(pl.x, pl.z, pl.r + 0.15);
    }
    // bar: counter along the wall with a lit edge, back shelves with bottles, stools on the guest side
    {
      const b = c.bar; const sn = Math.sin(b.yaw), co = Math.cos(b.yaw);
      const at = (du: number, dv: number): [number, number] => [b.x + sn * dv + co * du, b.z + co * dv - sn * du];
      pbox(LI, b, 0, 0, b.len, 0.8, gy, 1.1, [0.12, 0.08, 0.07], [0.25, 0.2, 0.16]); pbox(N, b, 0, 0, b.len, 0.8, gy + 1.1, 0.03, dim(neon, 0.8));
      for (let k = -b.len / 2 + 0.7; k <= b.len / 2 - 0.6; k += 1.3) { const [x, z] = at(k, 1.05); addCyl(LI, x - x0, gy, z - z0, 0.22, 0.72, [0.12, 0.1, 0.1], 8); addCyl(LI, x - x0, gy + 0.72, z - z0, 0.27, 0.06, [0.5, 0.1, 0.12], 8); }
      for (let k = -b.len / 2 + 0.4; k <= b.len / 2 - 0.3; k += 0.45) { const [x, z] = at(k, -0.8); addCyl(N, x - x0, gy + 1.46, z - z0, 0.05, 0.28, hash(Math.round(k * 10), 3) < 0.5 ? dim(neon, 0.7) : dim(acc, 0.7), 6); }
      pbox(LI, b, 0, -0.8, b.len, 0.3, gy + 0.9, 0.08, [0.2, 0.16, 0.12]); pbox(LI, b, 0, -0.8, b.len, 0.3, gy + 1.4, 0.08, [0.2, 0.16, 0.12]);
      const cs = [at(-b.len / 2, -1.2), at(b.len / 2, -1.2), at(b.len / 2, 0.5), at(-b.len / 2, 0.5)];
      for (let i = 0; i < 4; i++) { const p = cs[i], q = cs[(i + 1) % 4]; T.walls.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], h: 1.2 }); }
    }
    // VIP sofas: seat and back, a low table with a lit top
    for (const v of c.vip) {
      pbox(LI, v, 0, -0.5, 2.6, 0.9, gy, 0.45, SOFA, dim(SOFA, 1.3)); pbox(LI, v, 0, -0.9, 2.6, 0.3, gy + 0.45, 0.55, SOFA); pbox(LI, v, 0, 0.9, 1.0, 0.7, gy, 0.42, [0.1, 0.1, 0.12]); pbox(N, v, 0, 0.9, 0.9, 0.6, gy + 0.42, 0.02, dim(neon, 0.9));
      T.poles.push(v.x + Math.sin(v.yaw) * 0.2, v.z + Math.cos(v.yaw) * 0.2, 1.1);
    }
    // collision for the DJ stage (a rectangle) so players stay off the stage and decks
    {
      const sd = c.djStage; const hw2 = sd.w / 2, back = c.kind === 'rooftop' ? 1.2 : 1.6; const a = (du: number, dv: number): [number, number] => [dj.x + fs * dv + fc * du, dj.z + fc * dv - fs * du];
      const pts = [a(-hw2, -back - sd.d / 2), a(hw2, -back - sd.d / 2), a(hw2, -back + sd.d / 2 + 1.4), a(-hw2, -back + sd.d / 2 + 1.4)];
      for (let i = 0; i < 4; i++) { const p = pts[i], q = pts[(i + 1) % 4]; T.walls.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], h: 1.2 }); }
    }
    // ceiling rig for the ground clubs: truss over the floor with hanging neon fixtures
    if (!roof) {
      const fl = c.floor; const ty = c.h - 1.2;
      for (const dv of [-fl.d * 0.35, 0, fl.d * 0.35]) { pbox(LI, fl, 0, dv, fl.w + 3, 0.3, ty, 0.3, [0.35, 0.36, 0.4]); for (let k = -fl.w / 2; k <= fl.w / 2; k += 2.2) pbox(N, fl, k, dv, 0.3, 0.3, ty - 0.35, 0.3, k % 4.4 < 1.1 ? neon : acc); }
    }
  }
}
export function clubMaterial() { return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }); }
void addQuad;
