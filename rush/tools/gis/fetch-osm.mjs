// Fetches OpenStreetMap data for the Oshodi play area from the Overpass API and records provenance.
// Output: data/osm/oshodi.raw.json (OSM elements with geometry) and data/osm/provenance.json.
// OSM data is (c) OpenStreetMap contributors and licensed under the ODbL 1.0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = path.join(root, 'data/osm');
fs.mkdirSync(outDir, { recursive: true });

// Centred on the Oshodi Transport Interchange (terminals are OSM ways 693552184, 693552185, 693552186).
export const AREA = { name: 'Oshodi, Lagos', south: 6.5455, west: 3.3395, north: 6.5665, east: 3.3625 };
const bbox = `${AREA.south},${AREA.west},${AREA.north},${AREA.east}`;

const query = `
[out:json][timeout:120];
(
  way["highway"](${bbox});
  way["building"](${bbox});
  way["building:part"](${bbox});
  way["railway"](${bbox});
  way["waterway"](${bbox});
  way["natural"="water"](${bbox});
  way["landuse"](${bbox});
  way["leisure"](${bbox});
  way["amenity"](${bbox});
  way["man_made"="bridge"](${bbox});
  relation["building"](${bbox});
  node["highway"="traffic_signals"](${bbox});
  node["highway"="bus_stop"](${bbox});
  node["amenity"](${bbox});
);
out body geom qt;
`;

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

async function run() {
  let lastErr = null;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log(`Overpass: ${url} (attempt ${attempt + 1})`);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'LagosRush-GIS/0.1 (game world builder)' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json.elements?.length) throw new Error('empty result');
        fs.writeFileSync(path.join(outDir, 'oshodi.raw.json'), JSON.stringify(json));
        const counts = {};
        for (const e of json.elements) {
          const k = e.tags?.highway ? 'highway' : e.tags?.building ? 'building' : e.tags?.railway ? 'railway' : e.tags?.landuse ? 'landuse' : e.type;
          counts[k] = (counts[k] ?? 0) + 1;
        }
        const provenance = {
          source: 'OpenStreetMap via Overpass API',
          endpoint: url,
          query: query.trim(),
          area: AREA,
          acquired: new Date().toISOString(),
          osmBaseTimestamp: json.osm3s?.timestamp_osm_base ?? null,
          license: 'ODbL-1.0',
          licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
          attribution: '© OpenStreetMap contributors. Available under the Open Database License.',
          attributionUrl: 'https://www.openstreetmap.org/copyright',
          coverage: 'Bounding box around the Oshodi Transport Interchange, Lagos, Nigeria',
          elementCounts: counts,
          processing: 'Raw extract. See tools/gis/build-world.ts for the transformation into the game world database.',
          createsDerivativeDatabase: true,
          derivativeDatabaseNote: 'public/world/oshodi.json is a Derivative Database of OSM and is distributed under the ODbL 1.0.',
        };
        fs.writeFileSync(path.join(outDir, 'provenance.json'), JSON.stringify(provenance, null, 2));
        console.log('Saved', json.elements.length, 'elements', counts);
        return;
      } catch (e) {
        lastErr = e;
        console.warn('  failed:', e.message);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  console.error('All Overpass endpoints failed:', lastErr?.message);
  process.exit(1);
}

run();
