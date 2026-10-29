// Spatial hash for interest management. Cells are CELL metres (250). A "room" is a block of ROOM_CELLS x ROOM_CELLS cells
// (2 km, one map region): rooms are the unit we report, tick-budget and, later, hand to another process (see README, scaling).
import { CELL, ROOM_CELLS } from '../../../v2/src/net/protocol.ts';

export interface GridNode { id: number; x: number; z: number; cx: number; cz: number; key: number }

export const keyOf = (cx: number, cz: number) => (cx + 8192) * 16384 + (cz + 8192);
export const cellCoord = (v: number) => Math.floor(v / CELL);
export const roomOf = (cx: number, cz: number) => `${Math.floor(cx / ROOM_CELLS)},${Math.floor(cz / ROOM_CELLS)}`;

export class Grid<T extends GridNode> {
  private cells = new Map<number, Set<T>>();
  size = 0;
  /** place or move a node; cheap when it stays in its cell */
  put(n: T, x: number, z: number): boolean {
    const cx = cellCoord(x), cz = cellCoord(z), key = keyOf(cx, cz);
    n.x = x; n.z = z;
    if (n.key === key && this.cells.get(key)?.has(n)) { return false; }
    if (this.cells.get(n.key)?.delete(n)) { if (!this.cells.get(n.key)!.size) this.cells.delete(n.key); } else this.size++;
    n.cx = cx; n.cz = cz; n.key = key;
    let s = this.cells.get(key); if (!s) this.cells.set(key, (s = new Set())); s.add(n);
    return true;
  }
  remove(n: T) {
    const s = this.cells.get(n.key);
    if (s?.delete(n)) { this.size--; if (!s.size) this.cells.delete(n.key); }
  }
  /** visit every node within `rings` cells (square) of (cx, cz) */
  around(cx: number, cz: number, rings: number, f: (n: T, ring: number) => void) {
    for (let i = cx - rings; i <= cx + rings; i++) for (let j = cz - rings; j <= cz + rings; j++) {
      const s = this.cells.get(keyOf(i, j)); if (!s) continue;
      const ring = Math.max(Math.abs(i - cx), Math.abs(j - cz));
      for (const n of s) f(n, ring);
    }
  }
  /** nodes within a circle */
  near(x: number, z: number, r: number, f: (n: T) => void) {
    const rings = Math.ceil(r / CELL); const r2 = r * r;
    this.around(cellCoord(x), cellCoord(z), rings, (n) => { const dx = n.x - x, dz = n.z - z; if (dx * dx + dz * dz <= r2) f(n); });
  }
  cellCount() { return this.cells.size; }
  /** population per room, for stats and admin */
  rooms(count: (n: T) => number = () => 1) {
    const out = new Map<string, number>();
    for (const s of this.cells.values()) for (const n of s) { const k = roomOf(n.cx, n.cz); out.set(k, (out.get(k) ?? 0) + count(n)); }
    return out;
  }
}
