// The power grid (rules and feeder table in v2/src/net/rules.ts and v2/src/data/feeders.json). One state for the whole
// server: which feeders have light. The default load-shedding plan runs by itself; generation varies by day; the grid
// sometimes collapses; players on shift in the control room switch feeders (their choice holds for a few game hours);
// admins can force any feeder or the whole grid. When the light changes, everybody hears about it.
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BAND_HOURS, GRID_OVERRIDE_HOURS, generation, gridState, scheduledOn, worldHours, type FeederDef, type GridState } from '../../v2/src/net/rules.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const FEEDERS: FeederDef[] = JSON.parse(readFileSync(resolve(here, '../../v2/src/data/feeders.json'), 'utf8'));

export class Grid extends EventEmitter {
  /** operator switches: hold until `until` (game hours) */
  override = new Map<number, { on: boolean; until: number; by: string; from?: number }>();
  /** admin forcing: holds until cleared (or until `until` if set) */
  forced = new Map<number, { on: boolean; until: number }>();
  collapseUntil = 0; genScale = 1; private last = ''; total = FEEDERS.reduce((s, f) => s + f.load, 0);
  constructor(private now: () => number = Date.now) { super(); }
  hours() { return worldHours(this.now()); }
  gen(h = this.hours()) { return Math.round(generation(h, this.total) * this.genScale); }
  state(): GridState {
    const h = this.hours();
    for (const [f, o] of this.override) if (o.until <= h) this.override.delete(f);
    for (const [f, o] of this.forced) if (o.until <= h) this.forced.delete(f);
    return gridState(FEEDERS, h, { forced: this.forced, override: this.override, collapseUntil: this.collapseUntil, genScale: this.genScale });
  }
  /** called every second by the hub: tells listeners when any feeder changes */
  tick() { const s = this.state(); const k = s.on + (s.collapse ? 'x' : ''); if (k !== this.last) { const prev = this.last; this.last = k; this.emit('change', s, prev); } return s; }
  /** an operator in the control room flips a feeder now, or schedules it: `inHours` from now (up to 12), for `hours`
   *  (up to 6). Returns the new state. */
  switch(f: number, on: boolean, by: string, inHours = 0, hours = GRID_OVERRIDE_HOURS) {
    if (!FEEDERS.some((x) => x.i === f)) throw new Error('no such feeder');
    const now = this.hours(); const from = now + Math.max(0, Math.min(12, inHours || 0)); const len = Math.max(0.5, Math.min(6, hours || GRID_OVERRIDE_HOURS));
    this.override.set(f, { on, until: from + len, by, from: inHours > 0 ? from : undefined }); return this.tick();
  }
  force(f: number | 'all', on: boolean | null, hours = 24) {
    const ids = f === 'all' ? FEEDERS.map((x) => x.i) : [f];
    for (const i of ids) { if (on === null) this.forced.delete(i); else this.forced.set(i, { on, until: this.hours() + hours }); }
    return this.tick();
  }
  collapse(hours: number) { this.collapseUntil = hours > 0 ? this.hours() + hours : 0; return this.tick(); }
  /** for the admin panel and the control room console */
  board() {
    const s = this.state(); const h = this.hours();
    return { ...s, hour: h % 24, feeders: FEEDERS.map((f) => ({ ...f, on: s.on[f.i] === '1', planned: scheduledOn(f.i, f.band, h), op: this.override.get(f.i) ?? null, forced: this.forced.get(f.i) ?? null })), bands: BAND_HOURS, genScale: this.genScale };
  }
}
