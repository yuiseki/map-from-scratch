// Bake every highway=* way of Tokyo's 23 wards for the native road viewer.
//   roads.bin  u32 nVerts, u32 nRoads,
//              u16 x[nVerts], u16 y[nVerts]   (interleaved x,y pairs)
//              u8  cls[nVerts]                class of the segment that starts
//                                             at this vertex, 255 at a road's end
// The renderer draws segment i = (v[i], v[i+1]) unless cls[i] is 255, so the
// vertex array doubles as the segment list. Roads are ordered minor first,
// so major roads are drawn on top without sorting at run time.
// Grid: 139.50–139.98°E, 35.48–35.85°N, x scaled by cos(mid latitude), the
// longer side over 0..65535 (~0.6 m a step).
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { source } from '../../tools/sources.ts';
import { classOf, projectRoad, roadClassAt } from './road-data.ts';

const OUT = 'data/baked/05-tokyo-roads-native';
const pbf = source('osm-tokyo23');
const roadsPbf = 'data/raw/tokyo23-highways.osm.pbf';
if (!existsSync(roadsPbf)) execFileSync('osmium', ['tags-filter', '-o', roadsPbf, pbf, 'w/highway'], { stdio: 'inherit' });

// 0 motorway/trunk, 1 primary, 2 secondary/tertiary, 3 local, 4 paths
// One road is its quantized points, [x, y] each.
type Road = [number, number][];
// The fields of an osmium geojsonseq line that the bake reads.
interface Feature {
  properties?: { highway?: string } | null;
  geometry?: { type: string; coordinates: [number, number][] } | null;
}

const byClass: Road[][] = [[], [], [], [], []];
const exp = spawn('osmium', ['export', '-f', 'geojsonseq', '--geometry-types=linestring', '-a', 'type', roadsPbf], { stdio: ['ignore', 'pipe', 'inherit'] });
let skipped = 0;
for await (const line of createInterface({ input: exp.stdout })) {
  const f: Feature = JSON.parse(line.replace(/^\x1e/, ''));
  if (!f.properties?.highway || f.geometry?.type !== 'LineString') { skipped++; continue; }
  const pts: Road = f.geometry.coordinates.map(([lon, lat]) => projectRoad(lon, lat));
  if (pts.length >= 2) byClass[classOf(f.properties.highway)].push(pts);
}

const xy: number[] = [], cls: number[] = [];
let roads = 0;
for (let c = 4; c >= 0; c--) {
  for (const pts of byClass[c]) {
    roads++;
    pts.forEach(([x, y], i) => {
      xy.push(x, y);
      cls.push(roadClassAt(i, pts.length, c));
    });
  }
}
const n = cls.length;
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/roads.bin`, Buffer.concat([
  Buffer.from(Uint32Array.of(n, roads).buffer), Buffer.from(Uint16Array.from(xy).buffer), Buffer.from(Uint8Array.from(cls)),
]));
console.log(`${roads} roads (${byClass.map((a) => a.length).join('/')} by class), ${n} vertices, ${n - roads} segments, ` +
  `${skipped} skipped, roads.bin ${8 + n * 5} bytes`);
