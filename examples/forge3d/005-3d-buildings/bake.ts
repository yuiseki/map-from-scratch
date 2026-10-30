import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import earcut from '../../../vendor/earcut/earcut.js';
import { source } from '../../../tools/sources.ts';

// forge3d's "3D Buildings": the 3DBAG CityJSON tile 10-270-592 parsed into
// triangle meshes and previewed from those triangles. Each BuildingPart's
// LoD 2.2 solid is triangulated here (earcut on each surface projected onto
// its dominant plane); the page gets one indexed mesh whose vertices carry
// a quantized position and the index of the building they belong to, so a
// click can say which building it hit.

const OUT_DIR = 'data/baked/forge3d-005-3d-buildings';
mkdirSync(OUT_DIR, { recursive: true });

interface CityObject {
  type: string;
  attributes?: Record<string, unknown>;
  parents?: string[];
  geometry?: { type: string; lod: string; boundaries: number[][][][] }[];
}
const city = JSON.parse(readFileSync(source('forge3d-3dbag-10-270-592'), 'utf8'));
const scale: number[] = city.transform.scale, translate: number[] = city.transform.translate;
const verts: number[][] = city.vertices.map((v: number[]) => v.map((c, i) => c * scale[i] + translate[i]));
const objects: Record<string, CityObject> = city.CityObjects;

// Buildings in a fixed order; index 0 is reserved for "no building".
const buildingIds = Object.keys(objects).filter((id) => objects[id].type === 'Building').sort();
const buildingIndex = new Map(buildingIds.map((id, i) => [id, i + 1]));

// Mesh in metres, RD New (x east, y north) and NAP height.
const pos: number[] = []; // x, y, z per vertex
const owner: number[] = []; // building index per vertex
const tris: number[] = [];
const skipped: number[] = []; // areas (m2) of surfaces earcut returns nothing for

function addSurface(rings: number[][], b: number): void {
  const pts = rings.map((r) => r.map((i) => verts[i]));
  // Newell's normal of the outer ring picks the plane to project onto.
  const n = [0, 0, 0];
  const outer = pts[0];
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i], q = outer[(i + 1) % outer.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const ax = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  const drop = ax[0] > ax[1] && ax[0] > ax[2] ? 0 : ax[1] > ax[2] ? 1 : 2;
  const keep = [0, 1, 2].filter((k) => k !== drop);
  const flat: number[] = [], holes: number[] = [], ids: number[] = [];
  rings.forEach((ring, r) => {
    if (r) holes.push(flat.length / 2);
    ring.forEach((vi, j) => {
      const p = pts[r][j];
      flat.push(p[keep[0]], p[keep[1]]);
      ids.push(vertexOf(vi, b));
    });
  });
  const t = earcut(flat, holes.length ? holes : undefined, 2);
  if (!t.length) { skipped.push(Math.hypot(n[0], n[1], n[2]) / 2); return; }
  for (const i of t) tris.push(ids[i]);
}

// One mesh vertex per CityJSON vertex and building: surfaces of a building
// share their corners, neighbouring buildings do not (a click must tell
// them apart).
const vertexKey = new Map<string, number>();
function vertexOf(vi: number, b: number): number {
  const key = `${vi}:${b}`;
  let k = vertexKey.get(key);
  if (k === undefined) {
    k = pos.length / 3;
    vertexKey.set(key, k);
    pos.push(...verts[vi]);
    owner.push(b);
  }
  return k;
}

let parts = 0;
for (const obj of Object.values(objects)) {
  if (obj.type !== 'BuildingPart') continue;
  const b = buildingIndex.get(obj.parents?.[0] ?? '');
  const g = obj.geometry?.find((x) => x.lod === '2.2');
  if (!b || !g) throw new Error('BuildingPart without a parent or an LoD 2.2 solid');
  parts++;
  for (const shell of g.boundaries) for (const surface of shell) addSurface(surface as unknown as number[][], b);
}

// Quantize positions to 16 bits over the tile's box (about 9 mm steps).
const n = pos.length / 3;
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
  lo[k] = Math.min(lo[k], pos[i * 3 + k]);
  hi[k] = Math.max(hi[k], pos[i * 3 + k]);
}
const step = hi.map((h, k) => (h - lo[k]) / 65535);
const qpos = new Uint16Array(n * 4); // x, y, z, building: one 8-byte vertex
for (let i = 0; i < n; i++) {
  for (let k = 0; k < 3; k++) qpos[i * 4 + k] = Math.round((pos[i * 3 + k] - lo[k]) / step[k]);
  qpos[i * 4 + 3] = owner[i];
}
// Under 65,536 vertices, so 16-bit indices suffice.
if (n > 65535) throw new Error(`${n} vertices do not fit 16-bit indices`);
const index = new Uint16Array(tris);

const header = Buffer.alloc(64);
header.write('BAG3', 0, 'ascii');
header.writeUInt32LE(1, 4);
header.writeUInt32LE(n, 8);
header.writeUInt32LE(index.length, 12);
header.writeUInt32LE(buildingIds.length, 16);
lo.forEach((v, k) => header.writeDoubleLE(v, 20 + k * 8));
step.forEach((v, k) => header.writeFloatLE(v, 44 + k * 4));
const bin = Buffer.concat([header, Buffer.from(qpos.buffer), Buffer.from(index.buffer)]);
writeFileSync(`${OUT_DIR}/buildings.bin`, bin);

// What a click shows: one building per line, in index order.
const num = (v: unknown): number | null => (typeof v === 'number' ? Math.round(v * 10) / 10 : null);
const rows = buildingIds.map((id) => {
  const a = objects[id].attributes ?? {};
  return {
    id,
    year: num(a.oorspronkelijkbouwjaar),
    ground: num(a.b3_h_maaiveld),
    roof: num(a.b3_h_dak_max),
    roofType: a.b3_dak_type ?? null,
    volume: Math.round(Number(a.b3_volume_lod22 ?? 0)),
  };
});
writeFileSync(`${OUT_DIR}/buildings.json`, `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
console.log(`Baked ${buildingIds.length} buildings (${parts} parts): ${n} vertices, ${index.length / 3} triangles, ${skipped.length} surfaces left untriangulated (largest ${Math.max(0, ...skipped).toFixed(3)} m2) -> buildings.bin (${(bin.length / 1024).toFixed(0)} KB)`);
