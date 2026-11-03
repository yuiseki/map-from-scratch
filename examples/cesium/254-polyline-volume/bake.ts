// Bake for cesium-254-polyline-volume: Shinkansen centrelines from the
// frozen OSM Japan cut, stations to check them against, and Natural Earth
// land (10m around Japan, 110m elsewhere), as described in spec.yaml
// datasets.preparation. Run with `bin/mfs bake cesium-254-polyline-volume`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { simplify, triangulatePolygon, polygonsOf } from '../../../tools/geo.ts';
import { centreline, pathKm } from './centreline.ts';
import { encodeLines, encodeLand } from './format.ts';
import { LINES, STATIONS, DETAIL_BOX } from './lines.ts';

const OUT = 'data/baked/cesium-254-polyline-volume';
const OSM = '/sata_hdd_24tb/hf_data/__published/osm-japan-src-2026-08/data/parquet';
const NE = '/sata_hdd_24tb/hf_data/__published/natural-earth/data/parquet/v5.1.2';
mkdirSync(OUT, { recursive: true });

const duck = (sql: string): Record<string, unknown>[] => {
  const out = execFileSync('duckdb', ['-json', '-c', `SET memory_limit='2GB'; SET threads=4; LOAD spatial; ${sql}`], { encoding: 'utf8', maxBuffer: 1 << 30 }).trim();
  return out ? JSON.parse(out.replace(/\]\s*\[/g, ',')) : [];
};
const TO_LL = (g: string) => `ST_Transform(${g}, 'EPSG:3857', 'EPSG:4326', always_xy := true)`;
const KM = 111.195;

// ---- 1. route relations, one per line name ----
const names = LINES.map((l) => `'${l.name}'`).join(',');
const rel = duck(`select name, ST_AsGeoJSON(${TO_LL('way')}) g from '${OSM}/planet_osm_line.parquet' where route = 'railway' and name in (${names});`);
const pieces = new Map<string, number[][][]>();
for (const r of rel) {
  const g = (typeof r.g === 'string' ? JSON.parse(r.g) : r.g) as { type: string; coordinates: number[][] | number[][][] };
  const list = g.type === 'LineString' ? [g.coordinates as number[][]] : (g.coordinates as number[][][]);
  const arr = pieces.get(r.name as string) ?? [];
  arr.push(...list);
  pieces.set(r.name as string, arr);
}

// ---- 2. centrelines, in LINES order; later lines drop what earlier lines cover ----
const CELL_KM = 0.5, SHARED_KM = 1.2, JOIN_KM = 3, SIMPLIFY_KM = 0.04;
const kx = (lat: number) => KM * Math.cos((lat * Math.PI) / 180);
// a grid of densified points of the lines done so far
const doneGrid = new Map<string, number[][]>();
const gkey = (lon: number, lat: number) => `${Math.floor((lon * kx(36)) / SHARED_KM)},${Math.floor((lat * KM) / SHARED_KM)}`;
const nearestDone = (lon: number, lat: number): { d: number; p: number[] | null } => {
  const gx = Math.floor((lon * kx(36)) / SHARED_KM), gy = Math.floor((lat * KM) / SHARED_KM);
  let best = Infinity, bp: number[] | null = null;
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
    for (const p of doneGrid.get(`${gx + dx},${gy + dy}`) ?? []) {
      const d = Math.hypot((p[0] - lon) * kx(lat), (p[1] - lat) * KM);
      if (d < best) { best = d; bp = p; }
    }
  }
  return { d: best, p: bp };
};
const densify = (path: number[][], stepKm: number) => {
  const out: number[][] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i], path[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * kx(a[1]), (b[1] - a[1]) * KM) / stepKm));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(path[path.length - 1]);
  return out;
};

// ---- 3. rail ways with a speed limit, to give each line its operating speed ----
const ways = duck(`select try_cast(json_extract_string(tags, '$.maxspeed') as int) ms, ST_Length(way) / 1000 * cos(radians(ST_Y(${TO_LL('ST_Centroid(way)')}))) km,
  ST_X(${TO_LL('ST_PointN(way, ((ST_NPoints(way) + 1) // 2)::INTEGER)')}) lon, ST_Y(${TO_LL('ST_PointN(way, ((ST_NPoints(way) + 1) // 2)::INTEGER)')}) lat
  from '${OSM}/planet_osm_line.parquet' where railway = 'rail' and try_cast(json_extract_string(tags, '$.maxspeed') as int) >= 60;`) as { ms: number; km: number; lon: number; lat: number }[];

const baked: number[][][] = [];
const meta: { name: string; en: string; speed_kmh: number; km: number; points: number; speed_from: string }[] = [];
for (const line of LINES) {
  const pcs = pieces.get(line.name);
  if (!pcs) throw new Error(`no relation for ${line.name}`);
  let path = centreline(pcs, { cellKm: CELL_KM, exclude: doneGrid.size ? (lon, lat) => nearestDone(lon, lat).d < SHARED_KM : undefined });
  // close the gap the exclusion left at a junction with an earlier line
  for (const end of [0, 1]) {
    const q = end ? path[path.length - 1] : path[0];
    const { d, p } = nearestDone(q[0], q[1]);
    if (p && d < JOIN_KM) { if (end) path.push(p); else path.unshift(p); }
  }
  const fine = densify(path, 0.1);
  const lineGrid = new Map<string, number[][]>();
  for (const p of fine) { const k = gkey(p[0], p[1]); (lineGrid.get(k) ?? lineGrid.set(k, []).get(k)!).push(p); }
  // operating speed: the speed limit that covers the most km of ways on the line
  const byMs = new Map<number, number>();
  for (const w of ways) {
    const k0 = gkey(w.lon, w.lat).split(',').map(Number);
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1 && !near; dy++) {
      for (const p of lineGrid.get(`${k0[0] + dx},${k0[1] + dy}`) ?? []) {
        if (Math.hypot((p[0] - w.lon) * kx(w.lat), (p[1] - w.lat) * KM) < 0.08) { near = true; break; }
      }
    }
    if (near) byMs.set(w.ms, (byMs.get(w.ms) ?? 0) + w.km);
  }
  const ranked = [...byMs].sort((a, b) => b[1] - a[1]);
  const covered = ranked.length ? ranked[0][1] : 0;
  const fromOsm = covered >= 0.2 * pathKm(path);
  if (!fromOsm && !line.fallbackKmh) throw new Error(`${line.en}: maxspeed covers only ${covered.toFixed(1)} km`);
  const speed = fromOsm ? ranked[0][0] : line.fallbackKmh!;
  for (const p of fine) { const k = gkey(p[0], p[1]); (doneGrid.get(k) ?? doneGrid.set(k, []).get(k)!).push(p); }
  // simplify in local km
  const lat0 = path.reduce((s, p) => s + p[1], 0) / path.length, sx = kx(lat0);
  const simple = simplify(path.map((p) => [p[0] * sx, p[1] * KM]), SIMPLIFY_KM).map((p) => [p[0] / sx, p[1] / KM]);
  baked.push(simple);
  meta.push({ name: line.name, en: line.en, speed_kmh: speed, km: +pathKm(simple).toFixed(1), points: simple.length, speed_from: (fromOsm ? 'OSM maxspeed by km: ' : `fallback ${line.fallbackKmh} km/h (OSM maxspeed too sparse): `) + ranked.slice(0, 3).map(([m, k]) => `${m} km/h: ${k.toFixed(0)} km`).join(', ') });
  console.log(`${line.en.padEnd(20)} ${pathKm(simple).toFixed(0).padStart(5)} km ${String(simple.length).padStart(5)} pts  speed ${speed} (${meta[meta.length - 1].speed_from})`);
}

// ---- 4. stations: the OSM station node of that name nearest its line ----
const st = duck(`select name, ST_X(${TO_LL('way')}) lon, ST_Y(${TO_LL('way')}) lat from '${OSM}/planet_osm_point.parquet' where railway = 'station' and name in (${STATIONS.map((s) => `'${s.name}'`).join(',')});`) as { name: string; lon: number; lat: number }[];
const segDist = (path: number[][], lon: number, lat: number) => {
  let best = Infinity;
  const sx = kx(lat);
  for (let i = 0; i + 1 < path.length; i++) {
    const ax = (path[i][0] - lon) * sx, ay = (path[i][1] - lat) * KM, bx = (path[i + 1][0] - lon) * sx, by = (path[i + 1][1] - lat) * KM;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
};
const stations = STATIONS.map((s) => {
  const li = LINES.findIndex((l) => l.name === s.line);
  const cand = st.filter((r) => r.name === s.name).map((r) => ({ ...r, d: segDist(baked[li], r.lon, r.lat) })).sort((a, b) => a.d - b.d)[0];
  if (!cand) throw new Error(`no station ${s.name}`);
  return { name: s.name, en: s.en, line: li, lon: +cand.lon.toFixed(6), lat: +cand.lat.toFixed(6), m_from_line: Math.round(cand.d * 1000) };
});
for (const s of stations) console.log(`station ${s.en.padEnd(18)} ${s.m_from_line} m from ${LINES[s.line].en}`);

// ---- 5. land ----
const [x0, y0, x1, y1] = DETAIL_BOX;
const box = `ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1})`;
const landLayer = (sql: string) => {
  const vertices: number[] = [], indices: number[] = [];
  for (const r of duck(sql)) {
    if (!r.g) continue;
    const g = typeof r.g === 'string' ? JSON.parse(r.g) : r.g;
    const polys = g.type === 'GeometryCollection' ? g.geometries.flatMap(polygonsOf) : polygonsOf(g);
    for (const rings of polys) {
      const t = triangulatePolygon(rings), base = vertices.length / 2;
      vertices.push(...t.vertices);
      for (const i of t.indices) indices.push(base + i);
    }
  }
  return { vertices, indices };
};
const world = landLayer(`select ST_AsGeoJSON(ST_Difference(geometry, ${box})) g from '${NE}/110m_physical/ne_110m_land.parquet';`);
const japan = landLayer(`select ST_AsGeoJSON(ST_Intersection(geometry, ${box})) g from '${NE}/10m_physical/ne_10m_land.parquet' where ST_Intersects(geometry, ${box});`);
console.log(`land: world 110m ${world.vertices.length / 2} vertices ${world.indices.length / 3} triangles; detail 10m ${japan.vertices.length / 2} vertices ${japan.indices.length / 3} triangles`);

const write = (f: string, b: Uint8Array | string) => {
  writeFileSync(`${OUT}/${f}`, b);
  console.log(`${f}: ${typeof b === 'string' ? b.length : b.byteLength} B, gzip ${gzipSync(b).byteLength} B`);
};
write('lines.bin', encodeLines(baked));
write('land.bin', encodeLand([world, japan]));
write('meta.json', JSON.stringify({ lines: meta, stations, detail_box: DETAIL_BOX, osm: 'osm-japan-src-2026-08 (planet 2026-08-31)' }));
