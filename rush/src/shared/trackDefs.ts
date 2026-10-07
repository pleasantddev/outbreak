// Race layouts on the real Oshodi road network. Coordinates are local metres from the GIS build: x east, z south,
// origin at the Oshodi Interchange. Waypoints sit on real junctions; links are the hand-placed connectors a race
// organiser would open up (U-turns through the median, a cut through a motor park).
import type { TrackDef, TrackLink } from './trackBuild';

// U-turn east of the interchange: NE-bound carriageway swings round a bulb onto the SW-bound carriageway.
const UTURN_EAST: TrackLink = {
  a: [330, -65], b: [325, -76.5], roadA: 5133247, roadB: 133875251, w: 14,
  via: [[338.4, -65.7], [343.2, -70.7], [343.0, -77.6], [338.1, -82.4], [331.2, -82.2]],
};
// U-turn west on the expressway: SW-bound onto NE-bound.
const UTURN_WEST: TrackLink = {
  a: [-520, 269.4], b: [-514.4, 282.8], roadA: 17505891, roadB: 134147999, w: 14,
  via: [[-528.1, 270.9], [-532.9, 275.7], [-532.9, 282.6], [-528.0, 287.5], [-521.2, 287.5]],
};
// Through the motor park north of Terminal 2, from the terminal loop road onto Oshodi Road heading west.
const MOTOR_PARK_CUT: TrackLink = { a: [-62, 2], b: [-112, -49], via: [[-78, -22], [-95, -40]], w: 12, roadA: 134140055, roadB: 5153761 };

const FORWARD: TrackDef[] = [
  {
    id: 'terminal', name: 'Terminal Circuit', district: 'Oshodi Interchange', laps: 4,
    tagline: 'Under the skywalk, round Terminal 1, over both expressway bridges and back past Terminal 2.',
    route: [[48, -48], [96, 72], [-23, 160], [-32, 100], [17, 66], [222, -19], [330, -65], [325, -76.5], [198, -23], [12, 50], [-61, 64], [-59, -14], [5, -46]],
    links: [UTURN_EAST],
    start: [75, 18],
    hw: [6, 8.5],
    autoRamps: 2, brtLanes: 1, pickupRows: 3,
  },
  {
    id: 'oshodi', name: 'Oshodi Loop', district: 'Oshodi', laps: 3,
    tagline: 'Oshodi Road, Church Street and Oyetayo, then a flat out run down Agege Motor Road into the interchange.',
    route: [[-6, -37], [-284, -54], [-636, -50], [-673, -575], [-352, -831], [-287, -855], [-56, -294], [23, -111], [5, -46]],
    start: [-130, -48],
    hw: [6, 9],
    autoRamps: 2, brtLanes: 2,
  },
  {
    id: 'expressway', name: 'Expressway Run', district: 'Apapa Oworonshoki Expressway', laps: 3,
    tagline: 'Both carriageways of the expressway, a U-turn at each end and the interchange bridges in the middle.',
    route: [[198, -23], [12, 50], [-388, 215], [-520, 269.4], [-514.4, 282.8], [17, 66], [222, -19], [330, -65], [325, -76.5]],
    links: [UTURN_EAST, UTURN_WEST],
    start: [-250, 175],
    hw: [6.5, 9],
    autoRamps: 2, brtLanes: 2,
  },
  {
    id: 'grand', name: 'Oshodi Grand Tour', district: 'Oshodi', laps: 2,
    tagline: 'The neighbourhood loop and the whole interchange in one lap. Long, fast and full of traffic.',
    route: [[-284, -54], [-636, -50], [-673, -575], [-352, -831], [-287, -855], [-56, -294], [23, -111], [48, -48], [96, 72], [-23, 160], [-32, 100], [17, 66], [222, -19], [330, -65], [325, -76.5], [198, -23], [12, 50], [-61, 64], [-62, 2], [-112, -49]],
    links: [UTURN_EAST, MOTOR_PARK_CUT],
    start: [-200, -52],
    hw: [6, 9],
    autoRamps: 3, brtLanes: 3,
  },
];

const REVERSIBLE = new Set(['terminal', 'oshodi', 'expressway']);

export const TRACK_DEFS: TrackDef[] = [
  ...FORWARD,
  ...FORWARD.filter((d) => REVERSIBLE.has(d.id)).map((d) => ({ ...d, id: `${d.id}-rev`, name: `${d.name} Reverse`, reverse: true, base: d.id })),
];
