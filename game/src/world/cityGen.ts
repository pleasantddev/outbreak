// Procedural Oshodi-style district. Pure data so a dedicated server can build the identical city.
// Everything is boxes: one list drives rendering, physics colliders and bullet raycasts.
import { Rng } from '../sim/rng';
import type { VehicleKind } from '../data/balance';

export type V3 = [number, number, number];
export type Mat =
  | 'road' | 'sidewalk' | 'plaster' | 'paint' | 'concrete' | 'block' | 'tiles' | 'corrugated' | 'rust'
  | 'shutter' | 'mud' | 'planks' | 'woodfloor' | 'metal' | 'container' | 'curb' | 'stair';

export interface Box { p: V3; s: V3; ry: number; rx?: number; mat: Mat; col: boolean; vis: boolean; tint?: number; uv?: number; walk?: boolean }
export type PropType =
  | 'streetlight' | 'generator' | 'billboard' | 'firebarrel' | 'stall' | 'wreck' | 'danfowreck' | 'watertank'
  | 'sign' | 'litwindow' | 'crane' | 'palm' | 'kiosk' | 'canoe' | 'umbrella' | 'tyres' | 'dish' | 'shutter' | 'fence' | 'crate' | 'bed' | 'table' | 'shelf' | 'corpse' | 'blood';
export interface Prop { type: PropType; p: V3; ry: number; v?: number; text?: string; w?: number; h?: number; color?: number }
export interface Light { p: V3; color: number; intensity: number; range: number; flicker: number; kind: 'sodium' | 'fire' | 'window' | 'generator' }
export interface LootSpawn { p: V3; tier: 1 | 2 | 3; indoor: boolean }
export interface VehicleSpawn { p: V3; ry: number; kind: VehicleKind }
export interface NavNode { id: number; p: V3; kind: 'street' | 'door' | 'room' | 'stair' | 'roof' | 'open'; b?: number; floor?: number }
export interface Building { id: number; cx: number; cz: number; ry: number; w: number; d: number; floors: number; H: number; name: string; region: string; rooms: V3[] }
export interface Region { id: string; name: string; x0: number; x1: number; z0: number; z1: number }
export interface Site { id: string; name: string; p: V3; r: number }

export interface City {
  seed: number; half: number;
  boxes: Box[]; props: Prop[]; lights: Light[]; loot: LootSpawn[]; vehicles: VehicleSpawn[];
  nav: { nodes: NavNode[]; edges: number[][] };
  buildings: Building[]; regions: Region[]; extractions: Site[]; heartSites: Site[]; spawns: V3[];
  water: { x0: number; x1: number; z0: number; z1: number; y: number };
  canal: { x0: number; x1: number; depth: number };
  flyover: { z: number; x0: number; x1: number; y: number; w: number };
}

export const FLOOR_H = 3.4;
const WALL_T = 0.25;
const ROAD_HW = 7;
const WALK_W = 3.2;

const SHOP_NAMES = [
  'MAMA CHIOMA PROVISIONS', "GOD'S TIME IS THE BEST ELECTRONICS", 'BLESSED HANDS UNISEX SALON', 'ALHAJI SULE PATENT MEDICINE',
  'NO WEAPON FORMED AUTO PARTS', 'IYA BASIRAT BUKA', 'OSHODI PHONE CLINIC', 'EKO BOYS VULCANIZER', 'DIVINE FAVOUR PHOTOCOPY',
  'GLORY TO GLORY FABRICS', 'JESUS IS LORD POS', 'MR BIGGS', 'ADEX GENERATOR REPAIRS', 'SWEET MOTHER RESTAURANT',
  'CHUKS & SONS PLUMBING', 'ARISE CHEMIST', 'BABA IJEBU LOTTO', 'FAITH TAILORING', 'OGA MADAM BOUTIQUE', 'LAGOS SHAWARMA SPOT',
];
const BILLBOARDS = ['PRAY FOR LAGOS', 'GLOW TELECOM: WE NEVER DROP', 'VOTE AKINWALE: LIGHT FOR ALL', 'KEEP CALM AND LOCK YOUR DOOR', 'EKO O NI BAJE', 'HAVE YOU SEEN THIS CHILD?', 'MIRACLE CRUSADE TONIGHT', 'POWER RESTORED SOON'];

export function generateCity(seed: number): City {
  const rng = new Rng(seed);
  const half = 360;
  const boxes: Box[] = [];
  const props: Prop[] = [];
  const lights: Light[] = [];
  const loot: LootSpawn[] = [];
  const vehicles: VehicleSpawn[] = [];
  const nodes: NavNode[] = [];
  const edgeSet: Set<string>[] = [];
  const buildings: Building[] = [];

  const xRoads = [-260, -140, -20, 100, 210];
  const zRoads = [-250, -130, -10, 110, 230];
  const water = { x0: 285, x1: half + 60, z0: -half - 60, z1: half + 60, y: -0.9 };
  const canal = { x0: -204, x1: -196, depth: 2.4 };
  const flyover = { z: -10, x0: -200, x1: 50, y: 7.5, w: 14 };

  const regions: Region[] = [
    { id: 'airport', name: 'Airport Road', x0: -half, x1: half, z0: -half, z1: -250 },
    { id: 'mainland', name: 'Mainland Estates', x0: -half, x1: -140, z0: -250, z1: half },
    { id: 'terminal', name: 'Oshodi Terminal', x0: -140, x1: -20, z0: -10, z1: 110 },
    { id: 'market', name: 'Ile-Epo Market', x0: -20, x1: 100, z0: -130, z1: -10 },
    { id: 'flyover', name: 'The Flyover', x0: -260, x1: 100, z0: -20, z1: 0 },
    { id: 'port', name: 'Apapa Port', x0: 100, x1: half, z0: 230, z1: half },
    { id: 'lagoon', name: 'Lagoon Edge', x0: 210, x1: half, z0: -250, z1: 230 },
    { id: 'central', name: 'Central Oshodi', x0: -140, x1: 210, z0: -250, z1: 230 },
  ];
  const regionAt = (x: number, z: number) => regions.find((r) => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1)?.name ?? 'Oshodi';

  // ---------- helpers ----------
  const addNode = (p: V3, kind: NavNode['kind'], b?: number, floor?: number) => { nodes.push({ id: nodes.length, p, kind, b, floor }); edgeSet.push(new Set()); return nodes.length - 1; };
  const link = (a: number, b: number) => { if (a === b) return; edgeSet[a].add(String(b)); edgeSet[b].add(String(a)); };
  const box = (p: V3, s: V3, mat: Mat, o: Partial<Box> = {}) => { boxes.push({ p, s, ry: 0, mat, col: true, vis: true, ...o }); };

  // ---------- ground ----------
  // Ground is split around the canal trench and stops at the lagoon shore.
  const gy = -0.5;
  box([(-half - 40 + canal.x0) / 2, gy, 0], [(canal.x0 - (-half - 40)) / 2, 0.5, half + 40], 'mud', { walk: true });
  box([(canal.x1 + water.x0) / 2, gy, 0], [(water.x0 - canal.x1) / 2, 0.5, half + 40], 'mud', { walk: true });
  box([(canal.x0 + canal.x1) / 2, -canal.depth - 0.25, 0], [(canal.x1 - canal.x0) / 2, 0.25, half + 40], 'concrete', { walk: true });
  box([(water.x0 + water.x1) / 2, -5, 0], [(water.x1 - water.x0) / 2, 0.5, half + 40], 'mud', { walk: true }); // lagoon bed
  // shore wall
  box([water.x0 + 0.4, -1.5, 0], [0.4, 1.5, half + 40], 'concrete');

  // ---------- roads ----------
  const roadSegsX: { x: number; z0: number; z1: number }[] = xRoads.map((x) => ({ x, z0: -half + 20, z1: x > 150 ? half - 20 : half - 20 }));
  const roadSegsZ: { z: number; x0: number; x1: number }[] = zRoads.map((z) => ({ z, x0: -half + 20, x1: water.x0 - 4 }));
  for (const r of roadSegsX) {
    const len = r.z1 - r.z0;
    box([r.x, 0.01, (r.z0 + r.z1) / 2], [ROAD_HW, 0.02, len / 2], 'road', { col: false });
    for (const sgn of [-1, 1]) box([r.x + sgn * (ROAD_HW + WALK_W / 2), 0.08, (r.z0 + r.z1) / 2], [WALK_W / 2, 0.08, len / 2], 'sidewalk', { walk: true });
  }
  for (const r of roadSegsZ) {
    const len = r.x1 - r.x0;
    if (r.z === flyover.z) {
      // ground road only under the deck; ramps take the ends
      box([(flyover.x0 + flyover.x1) / 2, 0.012, r.z], [(flyover.x1 - flyover.x0) / 2, 0.02, ROAD_HW], 'road', { col: false });
      for (const [a, b2] of [[r.x0, -262], [96, r.x1]]) {
        box([(a + b2) / 2, 0.012, r.z], [(b2 - a) / 2, 0.02, ROAD_HW], 'road', { col: false });
        for (const sgn of [-1, 1]) box([(a + b2) / 2, 0.081, r.z + sgn * (ROAD_HW + WALK_W / 2)], [(b2 - a) / 2, 0.08, WALK_W / 2], 'sidewalk', { walk: true });
      }
      continue;
    }
    box([(r.x0 + r.x1) / 2, 0.012, r.z], [len / 2, 0.02, ROAD_HW], 'road', { col: false });
    for (const sgn of [-1, 1]) box([(r.x0 + r.x1) / 2, 0.081, r.z + sgn * (ROAD_HW + WALK_W / 2)], [len / 2, 0.08, WALK_W / 2], 'sidewalk', { walk: true });
  }
  // canal bridges where roads cross
  for (const r of roadSegsZ) box([(canal.x0 + canal.x1) / 2, -0.15, r.z], [5, 0.15, ROAD_HW + WALK_W], 'concrete', { walk: true });
  // canal guard rails
  for (let z = -half + 20; z < half - 20; z += 12) {
    if (zRoads.some((rz) => Math.abs(rz - z) < ROAD_HW + WALK_W + 6)) continue;
    for (const x of [canal.x0 - 0.15, canal.x1 + 0.15]) box([x, 0.5, z + 6], [0.08, 0.5, 5.6], 'metal');
  }

  // ---------- flyover ----------
  const deckY = flyover.y;
  box([(flyover.x0 + flyover.x1) / 2, deckY - 0.4, flyover.z], [(flyover.x1 - flyover.x0) / 2, 0.4, flyover.w / 2], 'concrete', { walk: true });
  for (const sgn of [-1, 1]) box([(flyover.x0 + flyover.x1) / 2, deckY + 0.55, flyover.z + sgn * (flyover.w / 2 - 0.2)], [(flyover.x1 - flyover.x0) / 2, 0.55, 0.2], 'concrete');
  const rampW = { x0: -262, x1: flyover.x0 }, rampE = { x0: flyover.x1, x1: 96 };
  for (const [ra, dir] of [[rampW, 1], [rampE, -1]] as const) {
    const len = ra.x1 - ra.x0, ang = Math.atan2(deckY, len), hyp = Math.hypot(len, deckY);
    // Ramp slab: rotate about Z. We express it with ry=90deg plus rx so the same YXZ convention applies.
    const cx = (ra.x0 + ra.x1) / 2, cy = deckY / 2 - 0.35;
    box([cx, cy, flyover.z], [flyover.w / 2, 0.35, hyp / 2], 'concrete', { ry: Math.PI / 2, rx: dir > 0 ? -ang : ang, walk: true });
    for (const sgn of [-1, 1]) box([cx, cy + 0.9, flyover.z + sgn * (flyover.w / 2 - 0.2)], [0.2, 0.55, hyp / 2], 'concrete', { ry: Math.PI / 2, rx: dir > 0 ? -ang : ang });
    // solid fill under the ramp, stepped
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const xa = ra.x0 + (len * i) / steps, xb = ra.x0 + (len * (i + 1)) / steps;
      const hLow = dir > 0 ? (deckY * i) / steps : (deckY * (steps - i - 1)) / steps;
      if (hLow < 0.6) continue;
      box([(xa + xb) / 2, hLow / 2 - 0.3, flyover.z], [(xb - xa) / 2, hLow / 2, flyover.w / 2 - 0.5], 'block');
    }
  }
  for (let x = flyover.x0 + 10; x < flyover.x1 - 5; x += 20) {
    if (xRoads.some((rx) => Math.abs(rx - x) < ROAD_HW + 2)) continue;
    for (const sgn of [-1, 1]) box([x, deckY / 2 - 0.4, flyover.z + sgn * 4.5], [0.7, deckY / 2 - 0.4, 0.7], 'concrete');
  }
  // under-bridge life: stalls and fires
  for (let x = flyover.x0 + 6; x < flyover.x1 - 6; x += 9) {
    if (xRoads.some((rx) => Math.abs(rx - x) < ROAD_HW + 4)) continue;
    if (rng.chance(0.55)) props.push({ type: 'stall', p: [x, 0, flyover.z + rng.pick([-5.5, 5.5])], ry: rng.pick([0, Math.PI]), v: rng.int(0, 3) });
    if (rng.chance(0.15)) { const p: V3 = [x + 3, 0, flyover.z + rng.range(-3, 3)]; props.push({ type: 'firebarrel', p, ry: 0 }); lights.push({ p: [p[0], 1.4, p[2]], color: 0xff6a20, intensity: 6, range: 12, flicker: 1, kind: 'fire' }); }
  }

  // ---------- nav: streets ----------
  const roadNodesX = new Map<number, number[]>();
  const roadNodesZ = new Map<number, number[]>();
  const interId = new Map<string, number>();
  for (const x of xRoads) for (const z of zRoads) {
    const y = 0.05;
    interId.set(`${x},${z}`, addNode([x, y, z], 'street'));
  }
  for (const r of roadSegsX) {
    const arr: number[] = [];
    for (let z = r.z0; z <= r.z1; z += 24) {
      const near = zRoads.find((rz) => Math.abs(rz - z) < 12);
      arr.push(near !== undefined ? interId.get(`${r.x},${near}`)! : addNode([r.x, 0.05, z], 'street'));
    }
    roadNodesX.set(r.x, [...new Set(arr)]);
  }
  for (const r of roadSegsZ) {
    const arr: number[] = [];
    if (r.z === flyover.z) {
      // two ground stubs outside the ramps, each its own chain
      const west: number[] = [], east: number[] = [];
      for (let x = r.x0; x <= r.x1; x += 24) {
        const near = xRoads.find((rx) => Math.abs(rx - x) < 12);
        const id = () => (near !== undefined ? interId.get(`${near},${r.z}`)! : addNode([x, 0.05, r.z], 'street'));
        if (x <= -262 + 4) west.push(id()); else if (x >= 96 - 4) east.push(id());
      }
      roadNodesZ.set(r.z + 0.1, [...new Set(west)]);
      roadNodesZ.set(r.z + 0.2, [...new Set(east)]);
    }
    for (let x = r.x0; x <= r.x1; x += 24) {
      const near = xRoads.find((rx) => Math.abs(rx - x) < 12);
      if (r.z === flyover.z) {
        // ground road only exists under the deck; the ramps own both ends
        if (x > flyover.x0 + 2 && x < flyover.x1 - 2) arr.push(near !== undefined ? interId.get(`${near},${r.z}`)! : addNode([x, 0.05, r.z], 'street'));
        continue;
      }
      arr.push(near !== undefined ? interId.get(`${near},${r.z}`)! : addNode([x, 0.05, r.z], 'street'));
    }
    roadNodesZ.set(r.z, [...new Set(arr)]);
  }
  // deck nodes (separate chain over the top)
  const deckChain: number[] = [interId.get(`${xRoads[0]},${flyover.z}`)!];
  for (let x = rampW.x0 + 20; x < rampE.x1 - 10; x += 20) {
    const y = x < flyover.x0 ? (deckY * (x - rampW.x0)) / (flyover.x0 - rampW.x0) : x > flyover.x1 ? deckY * (1 - (x - flyover.x1) / (rampE.x1 - flyover.x1)) : deckY;
    deckChain.push(addNode([x, y + 0.05, flyover.z], 'open'));
  }
  deckChain.push(interId.get(`${xRoads[3]},${flyover.z}`)!);
  for (let i = 1; i < deckChain.length; i++) link(deckChain[i - 1], deckChain[i]);

  const occupied: { x0: number; x1: number; z0: number; z1: number }[] = [];
  const isFree = (x0: number, x1: number, z0: number, z1: number) => !occupied.some((o) => x0 < o.x1 && x1 > o.x0 && z0 < o.z1 && z1 > o.z0)
    && !(x1 > canal.x0 - 2 && x0 < canal.x1 + 2) && x1 < water.x0 - 2;

  // ---------- streetlights ----------
  for (const r of roadSegsX) for (let z = r.z0 + 10; z < r.z1; z += 28) {
    if (zRoads.some((rz) => Math.abs(rz - z) < 12)) continue;
    const side = (Math.round(z / 28) % 2) ? 1 : -1;
    const px = r.x + side * (ROAD_HW + 0.6);
    const broken = rng.chance(0.38);
    props.push({ type: 'streetlight', p: [px, 0.16, z], ry: side > 0 ? -Math.PI / 2 : Math.PI / 2, v: broken ? 1 : 0 });
    if (!broken) lights.push({ p: [px - side * 2.2, 7.2, z], color: 0xff9a3c, intensity: 34, range: 28, flicker: rng.chance(0.25) ? 1 : 0, kind: 'sodium' });
  }
  for (const r of roadSegsZ) for (let x = r.x0 + 10; x < r.x1; x += 28) {
    if (xRoads.some((rx) => Math.abs(rx - x) < 12)) continue;
    if (r.z === flyover.z) continue;
    const side = (Math.round(x / 28) % 2) ? 1 : -1;
    const pz = r.z + side * (ROAD_HW + 0.6);
    const broken = rng.chance(0.38);
    props.push({ type: 'streetlight', p: [x, 0.16, pz], ry: side > 0 ? Math.PI : 0, v: broken ? 1 : 0 });
    if (!broken) lights.push({ p: [x, 7.2, pz - side * 2.2], color: 0xff9a3c, intensity: 34, range: 28, flicker: rng.chance(0.25) ? 1 : 0, kind: 'sodium' });
  }
  for (let x = flyover.x0 + 15; x < flyover.x1; x += 30) lights.push({ p: [x, deckY + 6, flyover.z], color: 0xffa040, intensity: 14, range: 24, flicker: rng.chance(0.3) ? 1 : 0, kind: 'sodium' });

  // ---------- building generator ----------
  function building(cx: number, cz: number, w: number, d: number, floors: number, ry: number, region: string, opts: { warehouse?: boolean } = {}) {
    const id = buildings.length;
    const H = opts.warehouse ? 6.5 : FLOOR_H;
    const c = Math.cos(ry), s = Math.sin(ry);
    const tw = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    const lb = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, mat: Mat, o: Partial<Box> = {}) => {
      const [wx, wz] = tw(lx, lz);
      boxes.push({ p: [wx, ly, wz], s: [hx, hy, hz], ry: ry + (o.ry ?? 0), mat, col: true, vis: true, ...o, ...(o.ry !== undefined ? { ry: ry + o.ry } : {}) });
    };
    const wallMat: Mat = opts.warehouse ? 'corrugated' : rng.pick(['plaster', 'plaster', 'paint', 'block', 'concrete'] as Mat[]);
    const tint = rng.pick([0xd8cbb0, 0xc9b79a, 0xb8c4b0, 0xd0a890, 0xa8b8c8, 0xe0d8c8, 0xc8a070, 0x9aa890]);
    const floorMat: Mat = rng.pick(['tiles', 'concrete', 'woodfloor'] as Mat[]);
    const name = rng.pick(SHOP_NAMES);
    const b: Building = { id, cx, cz, ry, w, d, floors, H, name, region, rooms: [] };
    buildings.push(b);
    const ft = (f: number) => f * H + 0.12;

    // stairwell in the back-left corner
    const x0 = -w / 2 + WALL_T, ze = d / 2 - WALL_T, zs = ze - 5.4, sw = 2.6;
    const hasStairs = floors > 1 || !opts.warehouse;
    const doorModule = Math.floor(w / 4 / 2);

    // ground slab
    lb(0, 0.06, 0, w / 2, 0.06, d / 2, floorMat, { walk: true });
    for (let f = 0; f < floors; f++) {
      const y0 = f * H, y1 = (f + 1) * H, base = ft(f);
      // exterior walls: front, back, left, right
      const sides: { len: number; place: (u0: number, u1: number, ya: number, yb: number) => void; solidRange?: [number, number] }[] = [
        { len: w, place: (u0, u1, ya, yb) => lb((u0 + u1) / 2, (ya + yb) / 2, -d / 2 + WALL_T / 2, (u1 - u0) / 2, (yb - ya) / 2, WALL_T / 2, wallMat, { tint }) },
        { len: w, place: (u0, u1, ya, yb) => lb((u0 + u1) / 2, (ya + yb) / 2, d / 2 - WALL_T / 2, (u1 - u0) / 2, (yb - ya) / 2, WALL_T / 2, wallMat, { tint }), solidRange: [x0 - 0.5, x0 + sw + 0.5] },
        { len: d - 2 * WALL_T, place: (u0, u1, ya, yb) => lb(-w / 2 + WALL_T / 2, (ya + yb) / 2, (u0 + u1) / 2, WALL_T / 2, (yb - ya) / 2, (u1 - u0) / 2, wallMat, { tint }), solidRange: [zs - 0.5, ze + 1] },
        { len: d - 2 * WALL_T, place: (u0, u1, ya, yb) => lb(w / 2 - WALL_T / 2, (ya + yb) / 2, (u0 + u1) / 2, WALL_T / 2, (yb - ya) / 2, (u1 - u0) / 2, wallMat, { tint }) },
      ];
      sides.forEach((side, si) => {
        const n = Math.max(1, Math.round(side.len / 4));
        const mw = side.len / n;
        let runStart: number | null = null;
        const place = side.place;
        side.place = (u0, u1, ya, yb) => { if (u1 - u0 > 0.04 && yb - ya > 0.02) place(u0, u1, ya, yb); };
        const flush = (end: number) => { if (runStart !== null) { side.place(runStart, end, y0, y1); runStart = null; } };
        for (let i = 0; i < n; i++) {
          const m0 = -side.len / 2 + i * mw, m1 = m0 + mw, mc = (m0 + m1) / 2;
          const forcedSolid = side.solidRange && m1 > side.solidRange[0] && m0 < side.solidRange[1];
          let kind: 'solid' | 'window' | 'door' = 'solid';
          if (f === 0 && si === 0 && (i === doorModule || (w >= 16 && i === n - 1 && rng.chance(0.5)))) kind = 'door';
          else if (f === 0 && si === 1 && i === n - 1 && !forcedSolid && rng.chance(0.5)) kind = 'door';
          else if (!forcedSolid && !opts.warehouse && rng.chance(f === 0 ? 0.35 : 0.62)) kind = 'window';
          else if (opts.warehouse && f === 0 && si === 0 && i === doorModule) kind = 'door';
          if (kind === 'solid') { if (runStart === null) runStart = m0; continue; }
          flush(m0);
          if (kind === 'window') {
            const half = Math.min(0.8, mw / 2 - 0.4);
            side.place(m0, m1, y0, base + 0.95);
            side.place(m0, m1, base + 2.35, y1);
            side.place(m0, mc - half, base + 0.95, base + 2.35);
            side.place(mc + half, m1, base + 0.95, base + 2.35);
            if (rng.chance(0.13)) {
              const out = si === 0 ? [mc, base + 1.65, -d / 2 + 0.05] : si === 1 ? [mc, base + 1.65, d / 2 - 0.05] : si === 2 ? [-w / 2 + 0.05, base + 1.65, mc] : [w / 2 - 0.05, base + 1.65, mc];
              const [wx, wz] = tw(out[0], out[2]);
              const fry = ry + (si === 0 ? Math.PI : si === 1 ? 0 : si === 2 ? -Math.PI / 2 : Math.PI / 2);
              const col = rng.pick([0xffa64a, 0xff8a3a, 0xffc070, 0xff5a2a]);
              props.push({ type: 'litwindow', p: [wx, out[1], wz], ry: fry, w: half * 2, h: 1.4, color: col });
              if (rng.chance(0.35)) lights.push({ p: [wx, out[1], wz], color: col, intensity: 3, range: 8, flicker: rng.chance(0.5) ? 1 : 0, kind: 'window' });
            }
          } else {
            const dh = opts.warehouse ? 4.2 : 2.3, dw = Math.min(opts.warehouse ? 2.4 : 0.75, mw / 2 - 0.3);
            side.place(m0, mc - dw, y0, y1);
            side.place(mc + dw, m1, y0, y1);
            side.place(mc - dw, mc + dw, base + dh, y1);
            if (si === 0 && i === doorModule) {
              // shop sign above the main door
              const [sx, sz] = tw(mc, -d / 2 - 0.12);
              props.push({ type: 'sign', p: [sx, base + 2.85, sz], ry: ry + Math.PI, text: name, w: Math.min(w - 1, 7), h: 0.9, color: rng.pick([0x1b4d8a, 0x8a1b1b, 0x2a6a2a, 0xd0a020, 0xe0e0d0]) });
              const [ox, oz] = tw(mc, -d / 2 - 1.4);
              const [ix, iz] = tw(mc, -d / 2 + 1.4);
              const outN = addNode([ox, 0.1, oz], 'door', id, 0);
              const inN = addNode([ix, ft(0), iz], 'room', id, 0);
              link(outN, inN);
              (b as any)._doorOut = outN; (b as any)._doorIn = inN;
            } else if (rng.chance(0.25)) {
              const [sx, sz] = tw(mc, si === 0 ? -d / 2 - 0.15 : d / 2 + 0.15);
              props.push({ type: 'shutter', p: [sx, base + dh, sz], ry: ry + (si === 0 ? Math.PI : 0), w: dw * 2, h: rng.range(0.4, 1.4) });
            }
          }
        }
        flush(side.len / 2);
      });

      // slab above this floor (roof on the last)
      const top = (f + 1) * H;
      const holeX1 = x0 + sw + 0.12;
      if (hasStairs) {
        lb((holeX1 + w / 2) / 2, top - 0.065, 0, (w / 2 - holeX1) / 2, 0.185, d / 2, floorMat, { walk: true });
        lb((-w / 2 + holeX1) / 2, top - 0.065, (-d / 2 + zs + 1.2) / 2, (holeX1 + w / 2) / 2, 0.185, (zs + 1.2 + d / 2) / 2, floorMat, { walk: true });
      } else {
        lb(0, top - 0.065, 0, w / 2, 0.185, d / 2, 'corrugated', { walk: true });
      }

      if (hasStairs) {
        // switchback: flight A in lane 1 (+z), landing, flight B in lane 2 (-z)
        const half = H / 2, run = 3.0, ang = Math.atan2(half, run), hyp = Math.hypot(run, half);
        const l1 = x0 + sw / 4, l2 = x0 + (3 * sw) / 4;
        // ramps (invisible colliders the feet ride on)
        lb(l1, base + half / 2 - 0.08, zs + 1.2 + run / 2, sw / 4, 0.08, hyp / 2, 'stair', { rx: -ang, vis: false, walk: true });
        lb(l2, base + half + half / 2 - 0.08, zs + 1.2 + run / 2, sw / 4, 0.08, hyp / 2, 'stair', { rx: ang, vis: false, walk: true });
        // landing
        lb(x0 + sw / 2, base + half - 0.1, (zs + 4.2 + ze) / 2, sw / 2, 0.1, (ze - zs - 4.2) / 2, 'concrete', { walk: true });
        // visible steps
        for (let i = 0; i < 10; i++) {
          const ya = base + (half * (i + 1)) / 10;
          lb(l1, ya - 0.17, zs + 1.2 + run * (i + 0.5) / 10, sw / 4, 0.17, run / 20, 'stair', { col: false });
          const yb = base + half + (half * (i + 1)) / 10;
          lb(l2, yb - 0.17, zs + 4.2 - run * (i + 0.5) / 10, sw / 4, 0.17, run / 20, 'stair', { col: false });
        }
        // core walls: lane divider and the side wall shutting the shaft off from the room
        lb(x0 + sw / 2, (y0 + y1) / 2, zs + 1.2 + run / 2, 0.06, H / 2, run / 2, 'concrete');
        lb(holeX1, (y0 + y1) / 2, (zs + 1.2 + ze) / 2, 0.1, H / 2, (ze - zs - 1.2) / 2, wallMat, { tint });
        // nav
        // waypoints sit in the lane centres so walkers never press into the divider
        const at = (lx: number, ly: number, lz: number, kind: 'stair' | 'room') => { const [wx, wz] = tw(lx, lz); return addNode([wx, ly, wz], kind, id, f); };
        const sN = at(l1, base + 0.05, zs + 0.7, 'stair');
        const eN = at(holeX1 + 0.9, base + 0.05, zs + 0.6, 'room');
        const aTop = at(l1, base + half + 0.05, zs + 4.75, 'stair');
        const bTop = at(l2, base + half + 0.05, zs + 4.75, 'stair');
        link(sN, eN); link(sN, aTop); link(aTop, bTop);
        const prevB = (b as any)[`_btop${f - 1}`] as number | undefined;
        if (prevB !== undefined) {
          // arrival from the flight below lands in lane 2 at this floor's strip
          const arr = at(l2, base + 0.05, zs + 0.6, 'stair');
          link(prevB, arr); link(arr, sN); link(arr, eN);
        }
        (b as any)[`_exit${f}`] = eN; (b as any)[`_strip${f}`] = sN; (b as any)[`_btop${f}`] = bTop;
      }

      // interior partition with a door gap, separating front room from back room
      if (!opts.warehouse && d >= 12) {
        const pz = zs - 0.1;
        const gapC = rng.range(-w / 2 + 2, w / 2 - 2);
        const gx0 = Math.max(-w / 2 + WALL_T, gapC - 0.7), gx1 = Math.min(w / 2 - WALL_T, gapC + 0.7);
        if (gx0 > -w / 2 + WALL_T + 0.1) lb((-w / 2 + WALL_T + gx0) / 2, (y0 + y1) / 2, pz, (gx0 + w / 2 - WALL_T) / 2, H / 2, 0.08, 'plaster', { tint: 0xd8d0c0 });
        if (gx1 < w / 2 - WALL_T - 0.1) lb((gx1 + w / 2 - WALL_T) / 2, (y0 + y1) / 2, pz, (w / 2 - WALL_T - gx1) / 2, H / 2, 0.08, 'plaster', { tint: 0xd8d0c0 });
        lb((gx0 + gx1) / 2, base + 2.3 + (y1 - base - 2.3) / 2, pz, (gx1 - gx0) / 2, (y1 - base - 2.3) / 2, 0.08, 'plaster', { tint: 0xd8d0c0 });
        // rooms
        const front: V3 = (() => { const [x, z] = tw(0, (-d / 2 + pz) / 2); return [x, base + 0.05, z]; })();
        const back: V3 = (() => { const [x, z] = tw((holeX1 + w / 2) / 2, (pz + d / 2) / 2); return [x, base + 0.05, z]; })();
        const gapN: V3 = (() => { const [x, z] = tw(gapC, pz); return [x, base + 0.05, z]; })();
        const fN = addNode(front, 'room', id, f), bN = addNode(back, 'room', id, f), gN = addNode(gapN, 'room', id, f);
        link(fN, gN); link(gN, bN);
        if (hasStairs) link((b as any)[`_exit${f}`], bN);
        if (f === 0 && (b as any)._doorIn !== undefined) link((b as any)._doorIn, fN);
        b.rooms.push(front, back);
        loot.push({ p: front, tier: f >= 2 ? 2 : 1, indoor: true }, { p: back, tier: f >= 3 ? 3 : rng.chance(0.3) ? 2 : 1, indoor: true });
        // furniture
        const fcount = rng.int(1, 3);
        for (let k = 0; k < fcount; k++) {
          const t = rng.pick(['bed', 'table', 'shelf', 'crate'] as PropType[]);
          const lx = rng.range(holeX1 + 1, w / 2 - 1.2), lz = rng.range(pz + 1, d / 2 - 1.2);
          const [px, pz2] = tw(lx, lz);
          props.push({ type: t, p: [px, base, pz2], ry: ry + rng.pick([0, Math.PI / 2]), v: rng.int(0, 2) });
        }
        if (rng.chance(0.18)) props.push({ type: 'corpse', p: [front[0], base + 0.02, front[2]], ry: rng.range(0, 6.28) });
        if (rng.chance(0.3)) props.push({ type: 'blood', p: [back[0], base + 0.02, back[2]], ry: rng.range(0, 6.28), w: rng.range(1, 2.4) });
      } else {
        const [x, z] = tw(w / 4, 0);
        const rn = addNode([x, base + 0.05, z], 'room', id, f);
        if ((b as any)._doorIn !== undefined && f === 0) link((b as any)._doorIn, rn);
        if (hasStairs) link((b as any)[`_strip${f}`], rn);
        b.rooms.push([x, base + 0.05, z]);
        loot.push({ p: [x, base + 0.05, z], tier: opts.warehouse ? 2 : 1, indoor: true });
        for (let k = 0; k < 4; k++) { const [px, pz2] = tw(rng.range(-w / 2 + 2, w / 2 - 2), rng.range(-d / 2 + 2, d / 2 - 2)); props.push({ type: 'crate', p: [px, base, pz2], ry: ry, v: rng.int(0, 2) }); }
      }
    }
    // roof: parapet, stair bulkhead, tanks
    const roofY = floors * H + 0.12;
    if (!opts.warehouse) {
      const ph = 0.95;
      lb(0, roofY + ph / 2, -d / 2 + 0.1, w / 2, ph / 2, 0.1, wallMat, { tint });
      lb(0, roofY + ph / 2, d / 2 - 0.1, w / 2, ph / 2, 0.1, wallMat, { tint });
      lb(-w / 2 + 0.1, roofY + ph / 2, 0, 0.1, ph / 2, d / 2, wallMat, { tint });
      lb(w / 2 - 0.1, roofY + ph / 2, 0, 0.1, ph / 2, d / 2, wallMat, { tint });
      if (hasStairs) {
        const bh = 2.6, holeX1 = x0 + sw + 0.12;
        lb(holeX1, roofY + bh / 2, (zs + 1.2 + ze) / 2 - 0.6, 0.1, bh / 2, (ze - zs) / 2, 'block');
        lb((x0 + holeX1) / 2, roofY + bh + 0.1, (zs + ze) / 2, (holeX1 - x0) / 2 + 0.1, 0.1, (ze - zs) / 2 + 0.1, 'concrete');
        // the final flight up onto the roof
        const rN = addNode((() => { const [x, z] = tw(0, -d / 4); return [x, roofY + 0.05, z] as V3; })(), 'roof', id, floors);
        const [tx, tz] = tw(x0 + (3 * sw) / 4, zs + 0.6);
        const topStrip = addNode([tx, roofY + 0.05, tz], 'stair', id, floors);
        const [ux, uz] = tw(x0 + (3 * sw) / 4, zs - 1.2);
        const outStrip = addNode([ux, roofY + 0.05, uz], 'roof', id, floors);
        link((b as any)[`_btop${floors - 1}`], topStrip); link(topStrip, outStrip); link(outStrip, rN);
        loot.push({ p: nodes[rN].p, tier: floors >= 4 ? 3 : 2, indoor: false });
      }
      const tanks = rng.int(0, 2);
      for (let k = 0; k < tanks; k++) { const [px, pz] = tw(rng.range(-w / 2 + 2, w / 2 - 2), rng.range(-d / 2 + 2, zs - 1)); props.push({ type: 'watertank', p: [px, roofY, pz], ry: 0 }); }
      if (rng.chance(0.35)) { const [px, pz] = tw(w / 2 - 1.5, -d / 2 + 1.5); props.push({ type: 'dish', p: [px, roofY, pz], ry: ry + rng.range(0, 6) }); }
    } else {
      // warehouse roof is corrugated and gently pitched visually
      lb(0, roofY + 0.2, 0, w / 2 + 0.3, 0.08, d / 2 + 0.3, 'corrugated', { col: true });
    }
    // generator at the side of most shops
    if (rng.chance(0.4)) {
      const [gx, gz] = tw(w / 2 + 1.0, -d / 2 + 2);
      props.push({ type: 'generator', p: [gx, 0.1, gz], ry: ry, v: rng.chance(0.5) ? 1 : 0 });
      if (rng.chance(0.5)) lights.push({ p: [gx, 2.2, gz], color: 0xfff0d0, intensity: 5, range: 10, flicker: 1, kind: 'generator' });
    }
    occupied.push(aabbOf(cx, cz, w, d, ry, 1.2));
    return b;
  }

  function aabbOf(cx: number, cz: number, w: number, d: number, ry: number, pad = 0) {
    const swap = Math.abs(Math.sin(ry)) > 0.5;
    const hx = (swap ? d : w) / 2 + pad, hz = (swap ? w : d) / 2 + pad;
    return { x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz };
  }

  // ---------- special blocks ----------
  // Oshodi Terminal: huge canopy over bays, with parked buses
  {
    const x0 = -140 + ROAD_HW + WALK_W + 2, x1 = -20 - ROAD_HW - WALK_W - 2, z0 = -10 + ROAD_HW + WALK_W + 2, z1 = 110 - ROAD_HW - WALK_W - 2;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hw = (x1 - x0) / 2, hd = (z1 - z0) / 2;
    box([cx, 0.1, cz], [hw, 0.1, hd], 'concrete', { walk: true });
    const roofY2 = 9;
    box([cx, roofY2, cz], [hw - 4, 0.25, hd - 8], 'metal', { walk: true });
    for (let x = x0 + 8; x <= x1 - 8; x += 14) for (let z = z0 + 12; z <= z1 - 12; z += 16) box([x, roofY2 / 2, z], [0.45, roofY2 / 2, 0.45], 'concrete');
    // bays
    for (let i = 0; i < 6; i++) {
      const z = z0 + 14 + i * 14;
      box([cx, 0.35, z], [hw - 14, 0.15, 1.2], 'curb', { walk: true });
      props.push({ type: rng.chance(0.5) ? 'danfowreck' : 'kiosk', p: [cx + rng.range(-20, 20), 0.2, z + 4], ry: Math.PI / 2 * (rng.chance(0.5) ? 1 : -1) });
      if (i % 2 === 0) lights.push({ p: [cx + rng.range(-25, 25), roofY2 - 0.5, z], color: 0xd8f0ff, intensity: 10, range: 22, flicker: 1, kind: 'sodium' });
    }
    // waiting hall: two-storey enterable building at the south end
    building(cx, z1 - 7, 32, 12, 2, Math.PI, 'Oshodi Terminal');
    occupied.push({ x0, x1, z0, z1 });
    for (let k = 0; k < 8; k++) loot.push({ p: [rng.range(x0 + 4, x1 - 4), 0.2, rng.range(z0 + 4, z1 - 20)], tier: rng.chance(0.4) ? 2 : 1, indoor: false });
    const nGrid: number[] = [];
    for (let x = x0 + 10; x <= x1 - 10; x += 22) for (let z = z0 + 6; z <= z1 - 20; z += 22) nGrid.push(addNode([x, 0.25, z], 'open'));
    connectGrid(nGrid, 32);
  }
  // Ile-Epo Market: dense stalls with corrugated roofs and tight alleys
  {
    const x0 = -20 + ROAD_HW + WALK_W + 1, x1 = 100 - ROAD_HW - WALK_W - 1, z0 = -130 + ROAD_HW + WALK_W + 1, z1 = -10 - ROAD_HW - WALK_W - 1;
    const nGrid: number[] = [];
    for (let x = x0 + 3; x < x1 - 3; x += 6) for (let z = z0 + 3; z < z1 - 3; z += 5) {
      const alley = Math.abs(x - (x0 + x1) / 2) < 3 || Math.abs(z - (z0 + z1) / 2) < 3 || ((x - x0) / 6) % 4 < 1;
      if (alley) { if (((x - x0) % 18 < 6) && ((z - z0) % 15 < 5)) nGrid.push(addNode([x, 0.05, z], 'open')); continue; }
      if (rng.chance(0.82)) {
        props.push({ type: 'stall', p: [x, 0, z], ry: rng.pick([0, Math.PI]), v: rng.int(0, 3) });
      }
      if (rng.chance(0.05)) props.push({ type: 'umbrella', p: [x + 2.5, 0, z], ry: 0, color: rng.pick([0xc03020, 0x2040a0, 0xe0b020]) });
      if (rng.chance(0.12)) loot.push({ p: [x, 1.0, z], tier: rng.chance(0.25) ? 2 : 1, indoor: false });
    }
    for (let k = 0; k < 4; k++) { const p: V3 = [rng.range(x0 + 5, x1 - 5), 0, rng.range(z0 + 5, z1 - 5)]; props.push({ type: 'firebarrel', p, ry: 0 }); lights.push({ p: [p[0], 1.4, p[2]], color: 0xff6a20, intensity: 6, range: 12, flicker: 1, kind: 'fire' }); }
    connectGrid(nGrid, 20);
    occupied.push({ x0, x1, z0, z1 });
  }
  // Apapa Port: containers, cranes, warehouses
  {
    const x0 = 100 + ROAD_HW + WALK_W + 2, x1 = water.x0 - 4, z0 = 230 + ROAD_HW + WALK_W + 2, z1 = half - 10;
    box([(x0 + x1) / 2, 0.06, (z0 + z1) / 2], [(x1 - x0) / 2, 0.06, (z1 - z0) / 2], 'concrete', { walk: true });
    const cols = [0x8a2a1a, 0x1f4a7a, 0x2a6a3a, 0xb07a20, 0x6a6a6a, 0x7a1a4a, 0xc0c0b0];
    for (let x = x0 + 8; x < x1 - 30; x += 9) for (let z = z0 + 6; z < z1 - 8; z += 16) {
      if (rng.chance(0.25)) continue;
      const stack = rng.int(1, 3);
      for (let k = 0; k < stack; k++) box([x, 1.3 + k * 2.6, z], [1.22, 1.3, 6.05], 'container', { tint: rng.pick(cols) });
      if (stack === 1 && rng.chance(0.5)) loot.push({ p: [x, 2.7, z], tier: 2, indoor: false });
      if (rng.chance(0.3)) { props.push({ type: 'crate', p: [x + 2.2, 0.06, z + rng.range(-4, 4)], ry: 0, v: 1 }); }
    }
    props.push({ type: 'crane', p: [x1 - 12, 0, z0 + 25], ry: 0 }, { type: 'crane', p: [x1 - 12, 0, z1 - 25], ry: 0 });
    building(x0 + 20, z1 - 14, 28, 16, 1, Math.PI, 'Apapa Port', { warehouse: true });
    const nGrid: number[] = [];
    for (let x = x0 + 12; x < x1 - 10; x += 18) for (let z = z0 + 14; z < z1 - 10; z += 16) nGrid.push(addNode([x + 4.5, 0.1, z], 'open'));
    connectGrid(nGrid, 26);
    lights.push({ p: [x1 - 12, 22, z0 + 25], color: 0xff3020, intensity: 30, range: 40, flicker: 0, kind: 'sodium' });
    occupied.push({ x0, x1, z0, z1 });
  }
  // Lagoon edge: stilt shacks, jetty
  {
    for (let z = -230; z < 220; z += rng.range(12, 22)) {
      const x = water.x0 + rng.range(4, 18);
      const w = rng.pick([4, 6]), dd = rng.pick([4, 6]);
      box([x, 0.4, z], [w / 2, 0.08, dd / 2], 'planks', { walk: true });
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box([x + (dx * w) / 2.2, -1.5, z + (dz * dd) / 2.2], [0.1, 2.0, 0.1], 'planks');
      box([x, 1.6, z - dd / 2 + 0.05], [w / 2, 1.2, 0.05], 'corrugated', { tint: 0xa08060 });
      box([x - w / 2 + 0.05, 1.6, z], [0.05, 1.2, dd / 2], 'corrugated', { tint: 0xa08060 });
      box([x, 2.85, z], [w / 2 + 0.3, 0.05, dd / 2 + 0.3], 'corrugated', { tint: 0x806050 });
      // walkway to shore
      box([(water.x0 + x - w / 2) / 2, 0.35, z], [(x - w / 2 - water.x0) / 2 + 0.2, 0.06, 0.6], 'planks', { walk: true });
      if (rng.chance(0.5)) loot.push({ p: [x, 0.6, z], tier: rng.chance(0.3) ? 2 : 1, indoor: true });
      if (rng.chance(0.4)) props.push({ type: 'canoe', p: [x + w / 2 + 2, water.y + 0.1, z + rng.range(-3, 3)], ry: rng.range(0, 6) });
    }
  }
  // Airport Road: hangars and an open apron
  {
    const z0 = -half + 20, z1 = -250 - ROAD_HW - WALK_W - 2;
    box([60, 0.05, (z0 + z1) / 2], [200, 0.05, (z1 - z0) / 2], 'concrete', { walk: true });
    for (let x = -100; x <= 180; x += 70) building(x, (z0 + z1) / 2 + 4, 32, 24, 1, Math.PI, 'Airport Road', { warehouse: true });
    for (let x = -140; x < 260; x += 6) box([x, 1.2, z1 + 0.5], [0.04, 1.2, 0.04], 'metal');
    box([60, 2.3, z1 + 0.5], [200, 0.03, 0.03], 'metal', { col: false });
    for (let x = -100; x <= 180; x += 70) lights.push({ p: [x, 8, z1 - 4], color: 0xd8e8ff, intensity: 16, range: 30, flicker: 0, kind: 'sodium' });
    occupied.push({ x0: -140, x1: 260, z0, z1 });
  }

  function connectGrid(ids: number[], maxD: number) {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = nodes[ids[i]].p, b = nodes[ids[j]].p;
      if (Math.hypot(a[0] - b[0], a[2] - b[2]) <= maxD) link(ids[i], ids[j]);
    }
  }

  // ---------- regular blocks ----------
  const xCells: [number, number][] = [[-half, -260], [-260, -140], [-140, -20], [-20, 100], [100, 210], [210, water.x0]];
  const zCells: [number, number][] = [[-half, -250], [-250, -130], [-130, -10], [-10, 110], [110, 230], [230, half]];
  const special = new Set(['2,3', '3,2', '4,5', '5,5']);
  for (let xi = 0; xi < xCells.length; xi++) for (let zi = 1; zi < zCells.length; zi++) {
    if (special.has(`${xi},${zi}`)) continue;
    const [bx0, bx1] = xCells[xi], [bz0, bz1] = zCells[zi];
    const inset = ROAD_HW + WALK_W + 0.6;
    const ux0 = bx0 + (xRoads.includes(bx0) ? inset : 14), ux1 = bx1 - (xRoads.includes(bx1) ? inset : 6);
    const uz0 = bz0 + (zRoads.includes(bz0) ? inset : 14), uz1 = bz1 - (zRoads.includes(bz1) ? inset : 14);
    if (ux1 - ux0 < 14 || uz1 - uz0 < 14) continue;
    const region = regionAt((ux0 + ux1) / 2, (uz0 + uz1) / 2);
    const central = Math.hypot((ux0 + ux1) / 2 + 40, (uz0 + uz1) / 2) < 200;
    const maxF = region === 'Lagoon Edge' ? 2 : central ? 5 : 4;
    // mechanic yard instead of buildings
    if (xi === 1 && zi === 4) {
      for (let k = 0; k < 9; k++) props.push({ type: rng.chance(0.3) ? 'tyres' : 'wreck', p: [rng.range(ux0 + 4, ux1 - 4), 0, rng.range(uz0 + 4, uz1 - 4)], ry: rng.range(0, 6.28), v: rng.int(0, 2) });
      vehicles.push({ p: [(ux0 + ux1) / 2, 0.8, (uz0 + uz1) / 2], ry: 0.4, kind: 'suv' });
      loot.push({ p: [(ux0 + ux1) / 2 + 6, 0.1, (uz0 + uz1) / 2], tier: 2, indoor: false });
      const p: V3 = [(ux0 + ux1) / 2 - 8, 0, (uz0 + uz1) / 2 + 5]; props.push({ type: 'firebarrel', p, ry: 0 }); lights.push({ p: [p[0], 1.4, p[2]], color: 0xff6a20, intensity: 6, range: 12, flicker: 1, kind: 'fire' });
      continue;
    }
    // front rows along each road-facing edge
    const placeRow = (axis: 'x' | 'z', fixed: number, a0: number, a1: number, ry: number, dir: number) => {
      let a = a0;
      while (a < a1 - 10) {
        const w = 4 * rng.int(3, 6), d = 4 * rng.int(3, 4);
        if (a + w > a1) break;
        const floors = rng.int(2, maxF);
        const along = a + w / 2;
        const cx = axis === 'x' ? along : fixed + (dir * d) / 2;
        const cz = axis === 'x' ? fixed + (dir * d) / 2 : along;
        const bb = aabbOf(cx, cz, w, d, ry, 0.6);
        if (isFree(bb.x0, bb.x1, bb.z0, bb.z1) && rng.chance(0.86)) building(cx, cz, w, d, floors, ry, region);
        a += w + rng.pick([2, 3, 4, 6]);
      }
    };
    // front faces -z means local front at -d/2; ry=0 front faces north (toward smaller z)
    // ry=0 faces north (-z), PI faces south, PI/2 faces west (-x), -PI/2 faces east (+x)
    if (zRoads.includes(bz0)) placeRow('x', uz0, ux0 + 1, ux1 - 1, 0, 1);
    if (zRoads.includes(bz1)) placeRow('x', uz1, ux0 + 1, ux1 - 1, Math.PI, -1);
    if (xRoads.includes(bx0)) placeRow('z', ux0, uz0 + 18, uz1 - 18, Math.PI / 2, 1);
    if (xRoads.includes(bx1)) placeRow('z', ux1, uz0 + 18, uz1 - 18, -Math.PI / 2, -1);
    // courtyard clutter
    const ccx = (ux0 + ux1) / 2, ccz = (uz0 + uz1) / 2;
    for (let k = 0; k < 3; k++) {
      const p: V3 = [ccx + rng.range(-14, 14), 0, ccz + rng.range(-14, 14)];
      if (!isFree(p[0] - 1, p[0] + 1, p[2] - 1, p[2] + 1)) continue;
      const t = rng.pick(['wreck', 'tyres', 'watertank', 'palm', 'firebarrel', 'crate'] as PropType[]);
      props.push({ type: t, p, ry: rng.range(0, 6.28), v: rng.int(0, 2) });
      if (t === 'firebarrel') lights.push({ p: [p[0], 1.4, p[2]], color: 0xff6a20, intensity: 6, range: 12, flicker: 1, kind: 'fire' });
    }
    if (rng.chance(0.7)) loot.push({ p: [ccx, 0.1, ccz], tier: 1, indoor: false });
  }

  // billboards at intersections
  for (const x of xRoads) for (const z of zRoads) {
    if (!rng.chance(0.35)) continue;
    const ox = x + rng.pick([-1, 1]) * (ROAD_HW + WALK_W + 3), oz = z + rng.pick([-1, 1]) * (ROAD_HW + WALK_W + 3);
    if (!isFree(ox - 3, ox + 3, oz - 1, oz + 1)) continue;
    props.push({ type: 'billboard', p: [ox, 0, oz], ry: rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), text: rng.pick(BILLBOARDS) });
  }

  // wrecks and abandoned danfos on the roads
  for (let k = 0; k < 26; k++) {
    const onX = rng.chance(0.5);
    const r = onX ? rng.pick(roadSegsX) : rng.pick(roadSegsZ.filter((s) => s.z !== flyover.z));
    const t = onX ? rng.range((r as any).z0 + 20, (r as any).z1 - 20) : rng.range((r as any).x0 + 20, (r as any).x1 - 20);
    if ((onX ? zRoads : xRoads).some((v) => Math.abs(v - t) < 14)) continue;
    const lane = rng.pick([-3.5, 3.5]);
    const p: V3 = onX ? [(r as any).x + lane, 0, t] : [t, 0, (r as any).z + lane];
    props.push({ type: rng.chance(0.35) ? 'danfowreck' : 'wreck', p, ry: (onX ? 0 : Math.PI / 2) + rng.range(-0.5, 0.5), v: rng.int(0, 2) });
    if (rng.chance(0.25)) props.push({ type: 'corpse', p: [p[0] + rng.range(-3, 3), 0.03, p[2] + rng.range(-3, 3)], ry: rng.range(0, 6) });
  }

  // drivable vehicles
  const spawnKinds: VehicleKind[] = ['okada', 'okada', 'okada', 'okada', 'okada', 'okada', 'danfo', 'danfo', 'danfo', 'danfo', 'suv', 'suv'];
  for (const kind of spawnKinds) {
    for (let tries = 0; tries < 10; tries++) {
      const onX = rng.chance(0.5);
      const r = onX ? rng.pick(roadSegsX) : rng.pick(roadSegsZ.filter((s) => s.z !== flyover.z));
      const t = onX ? rng.range((r as any).z0 + 30, (r as any).z1 - 30) : rng.range((r as any).x0 + 30, (r as any).x1 - 30);
      if ((onX ? zRoads : xRoads).some((v) => Math.abs(v - t) < 16)) continue;
      const lane = rng.pick([-3.2, 3.2]);
      const p: V3 = onX ? [(r as any).x + lane, 1.0, t] : [t, 1.0, (r as any).z + lane];
      if (vehicles.some((v) => Math.hypot(v.p[0] - p[0], v.p[2] - p[2]) < 8)) continue;
      vehicles.push({ p, ry: onX ? (lane > 0 ? 0 : Math.PI) : (lane > 0 ? Math.PI / 2 : -Math.PI / 2), kind });
      break;
    }
  }

  // street loot
  for (let k = 0; k < 30; k++) {
    const onX = rng.chance(0.5);
    const r = onX ? rng.pick(roadSegsX) : rng.pick(roadSegsZ);
    const t = onX ? rng.range((r as any).z0 + 10, (r as any).z1 - 10) : rng.range((r as any).x0 + 10, (r as any).x1 - 10);
    const off = rng.pick([-1, 1]) * (ROAD_HW + 1.5);
    loot.push({ p: onX ? [(r as any).x + off, 0.2, t] : [t, 0.2, (r as any).z + off], tier: 1, indoor: false });
  }

  // ---------- nav: link road chains and doors ----------
  for (const ids of [...roadNodesX.values(), ...roadNodesZ.values()]) for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i]);
  for (const b of buildings) {
    const outN = (b as any)._doorOut as number | undefined;
    if (outN === undefined) continue;
    const p = nodes[outN].p;
    // nearest street node in a straight line (doors face roads, so it is usually clear)
    let best = -1, bd = 1e9;
    for (const n of nodes) if (n.kind === 'street') { const d = Math.hypot(n.p[0] - p[0], n.p[2] - p[2]); if (d < bd) { bd = d; best = n.id; } }
    // add a sidewalk projection so paths hug the street instead of cutting diagonally
    const proj: V3 = Math.abs(nodes[best].p[0] - p[0]) < Math.abs(nodes[best].p[2] - p[2]) ? [nodes[best].p[0], 0.05, p[2]] : [p[0], 0.05, nodes[best].p[2]];
    const pn = addNode(proj, 'street');
    link(outN, pn);
    // connect projection to the two nearest street nodes on the same road line
    const sameLine = nodes.filter((n) => n.kind === 'street' && n.id !== pn && Math.hypot(n.p[0] - proj[0], n.p[2] - proj[2]) < 30 && (Math.abs(n.p[0] - proj[0]) < 0.5 || Math.abs(n.p[2] - proj[2]) < 0.5)).sort((a, c) => Math.hypot(a.p[0] - proj[0], a.p[2] - proj[2]) - Math.hypot(c.p[0] - proj[0], c.p[2] - proj[2]));
    for (const n of sameLine.slice(0, 2)) link(pn, n.id);
    if (!sameLine.length && bd < 45) link(pn, best);
  }
  // join special-area open nodes to their nearest street node
  for (const n of nodes) if (n.kind === 'open' && edgeSet[n.id].size < 6 && n.p[1] < 1) {
    let best = -1, bd = 1e9;
    for (const m of nodes) if (m.kind === 'street') { const d = Math.hypot(m.p[0] - n.p[0], m.p[2] - n.p[2]); if (d < bd) { bd = d; best = m.id; } }
    if (bd < 18) link(n.id, best);
  }

  const extractions: Site[] = [
    { id: 'airport', name: 'Airport Road Helipad', p: [40, 0.1, -300], r: 12 },
    { id: 'port', name: 'Apapa Port Quay', p: [262, 0.1, 300], r: 12 },
    { id: 'lagoon', name: 'Lagoon Jetty', p: [322, 0.7, 40], r: 9 },
  ];
  // jetty
  box([303, 0.55, 40], [20, 0.08, 2.2], 'planks', { walk: true });
  box([322, 0.55, 40], [7, 0.08, 7], 'planks', { walk: true });
  for (let x = 286; x < 330; x += 4) for (const z of [38, 42]) box([x, -1.5, z], [0.12, 2.0, 0.12], 'planks');
  lights.push({ p: [322, 4, 40], color: 0x80b0ff, intensity: 10, range: 18, flicker: 0, kind: 'sodium' });

  const heartSites: Site[] = [
    { id: 'market', name: 'Ile-Epo Market', p: [40, 0.1, -70], r: 6 },
    { id: 'terminal', name: 'Oshodi Terminal', p: [-80, 0.25, 40], r: 6 },
    { id: 'flyover', name: 'The Flyover', p: [-75, deckY + 0.05, flyover.z], r: 6 },
  ];

  // collision for solid props, so cover is identical for the server, players and bots
  const PROP_COL: Partial<Record<PropType, [number, number, number]>> = {
    wreck: [0.95, 0.7, 2.1], danfowreck: [1.0, 1.1, 2.4], generator: [0.6, 0.5, 0.4], watertank: [0.85, 0.8, 0.85], kiosk: [1.0, 1.2, 1.0],
    crate: [0.5, 0.5, 0.5], table: [0.8, 0.4, 0.45], bed: [0.5, 0.25, 1.0], shelf: [0.9, 1.0, 0.25], stall: [1.4, 0.45, 0.9], tyres: [0.45, 0.4, 0.45],
    firebarrel: [0.32, 0.45, 0.32], palm: [0.25, 3, 0.25], billboard: [0.25, 3, 0.25],
  };
  for (const pr of props) {
    const c = PROP_COL[pr.type];
    if (!c) continue;
    const sc = pr.type === 'crate' ? 0.7 + (pr.v ?? 0) * 0.3 : 1;
    boxes.push({ p: [pr.p[0], pr.p[1] + c[1] * sc, pr.p[2]], s: [c[0] * sc, c[1] * sc, c[2] * sc], ry: pr.ry, mat: 'metal', col: true, vis: false });
  }

  const spawns: V3[] = nodes.filter((n) => n.kind === 'street' || n.kind === 'open').map((n) => n.p);
  const edges = edgeSet.map((s) => [...s].map(Number));
  return { seed, half, boxes, props, lights, loot, vehicles, nav: { nodes, edges }, buildings, regions, extractions, heartSites, spawns, water, canal, flyover };
}
