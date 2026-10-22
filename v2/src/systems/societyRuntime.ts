// Shared singletons for the society systems (society.ts, nemesis.ts) so they can find each other without import cycles.
import type { GameCtx } from './registry';
import type { Society } from './societyCore';
import type { WorldBridge } from './societyWorld';
import type { Nemesis } from './nemesis';
import type { CityEvents } from './societyEvents';

export const RT: { soc?: Society; bridge?: WorldBridge; nem?: Nemesis; events?: CityEvents; ctx?: GameCtx; placeName?: (x: number, z: number) => string } = {};
