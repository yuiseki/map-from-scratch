// Bake for cesium-202-japan-buildings.
//
//   node examples/cesium/202-japan-buildings/bake.ts
//
// 1. PLATEAU Tokyo 23 wards (2022, CityGML v2): the building GML of the 130
//    third-level meshes over central Tokyo (139.6875-139.8125E,
//    35.625-35.7333N: Chiyoda, Chuo, Minato, Shinjuku, Shibuya, Bunkyo,
//    Taito and parts of their neighbours), streamed out of the 5.9 GB zip,
//    LOD1 solids only (citygml.ts). Cached as data/raw/.../solids.ndjson.
// 2. Footprints into the local frame (geo.ts: east-north at Tokyo Station,
//    metres), Douglas-Peucker at 0.3 m, buildings sorted into levels by
//    height and into the quadtree tile of their centroid, roofs by earcut,
//    tiles in the JBT1 format (tile.ts), deflate-raw.
// 3. Land masks for the globe (mask.ts): world 0.1 deg (Natural Earth 50m
//    land minus lakes), Kanto 0.002 deg and the city 0.0004 deg (Natural
//    Earth 10m land minus lakes, plus a 60 m disc around every PLATEAU
//    building, because the 1:10M coast misses the bay's landfill).
// 4. index.json for the renderer, truth.json for the bench.
import { openSync, readSync, closeSync, fstatSync, createReadStream, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createInflateRaw, deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lod1Reader, type Solid } from './citygml.ts';
import { frameAt, toLocal, ecef, gaussRadius } from './geo.ts';
import { encodeTile, quantize, type FootprintIn } from './tile.ts';
import { Mask, type Grid } from './mask.ts';
import type { IndexJson } from './lod.ts';
import { simplify } from '../../../tools/geo.ts';
import earcut from '../../../kits/earcut/earcut.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const ID = 'cesium-202-japan-buildings';
const RAW = join(root, 'data/raw', ID), OUT = join(root, 'data/baked', ID);
const ZIP = '/sata_hdd_24tb/hf_data/plateau-citygml-jp/data/raw/13100_tokyo23ku/2022/13100_tokyo23-ku_2022_citygml_1_2_op.zip';
const NE = '/sata_hdd_24tb/hf_data/__published/natural-earth/data/parquet/v5.1.2';
const ORIGIN: [number, number] = [35.68124, 139.76712];     // Tokyo Station
const BOX = { lon0: 139.6875, lon1: 139.8125, lat0: 35.625, lat1: 35.73334 };
// Levels: a building lives in the first level whose minHeight it reaches.
// error = the tallest building a level leaves to the levels below it.
const LEVELS = [
  { minHeight: 100, error: 100 },
  { minHeight: 60, error: 60 },
  { minHeight: 30, error: 30 },
  { minHeight: 15, error: 15 },
  { minHeight: 7, error: 7 },
  { minHeight: 0, error: 0 },
];
const SIMPLIFY_M = 0.3;

mkdirSync(RAW, { recursive: true });
const t0 = performance.now();
const secs = () => ((performance.now() - t0) / 1000).toFixed(1) + ' s';

// --- 1. Solids out of the zip ----------------------------------------------
// ZIP reading (ZIP64 aware) after examples/16-plateau-buildings-3d/zip.ts.
interface Entry { name: string; crc: number; compSize: number; size: number; headerOff: number }
const readAt = (fd: number, off: number, n: number) => { const b = new Uint8Array(n); readSync(fd, b, 0, n, off); return b; };
const u64 = (dv: DataView, o: number) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 2 ** 32;
function zipEntries(file: string): Entry[] {
  const fd = openSync(file, 'r'), size = fstatSync(fd).size;
  try {
    const tail = readAt(fd, size - 65536, 65536), dv = new DataView(tail.buffer);
    let i = tail.length - 22;
    while (i >= 0 && dv.getUint32(i, true) !== 0x06054b50) i--;
    let cdOff = dv.getUint32(i + 16, true), cdLen = dv.getUint32(i + 12, true);
    if (cdOff === 0xffffffff || cdLen === 0xffffffff) {
      const at = u64(dv, i - 20 + 8) - (size - tail.length);
      cdLen = u64(dv, at + 40); cdOff = u64(dv, at + 48);
    }
    const cd = readAt(fd, cdOff, cdLen), c = new DataView(cd.buffer), dec = new TextDecoder(), out: Entry[] = [];
    for (let p = 0; p + 46 <= cd.length && c.getUint32(p, true) === 0x02014b50;) {
      const nl = c.getUint16(p + 28, true), xl = c.getUint16(p + 30, true), cl = c.getUint16(p + 32, true);
      const e: Entry = { name: dec.decode(cd.subarray(p + 46, p + 46 + nl)), crc: c.getUint32(p + 16, true), compSize: c.getUint32(p + 20, true), size: c.getUint32(p + 24, true), headerOff: c.getUint32(p + 42, true) };
      for (let x = p + 46 + nl; x + 4 <= p + 46 + nl + xl;) {
        const id = c.getUint16(x, true), len = c.getUint16(x + 2, true);
        if (id === 1) {
          let q = x + 4;
          if (e.size === 0xffffffff) { e.size = u64(c, q); q += 8; }
          if (e.compSize === 0xffffffff) { e.compSize = u64(c, q); q += 8; }
          if (e.headerOff === 0xffffffff) e.headerOff = u64(c, q);
        }
        x += 4 + len;
      }
      out.push(e);
      p += 46 + nl + xl + cl;
    }
    return out;
  } finally { closeSync(fd); }
}

// The south-west corner of a third-level mesh code (e.g. 53394611).
function meshCorner(code: string): [number, number] {
  const p = +code.slice(0, 2), u = +code.slice(2, 4), q = +code[4], v = +code[5], r = +code[6], w = +code[7];
  return [p / 1.5 + q / 12 + r / 120, 100 + u + v / 8 + w / 80];
}

const CACHE = join(RAW, 'solids.ndjson');
const solids: (Solid & { mesh: string })[] = [];
if (existsSync(CACHE)) {
  for (const line of readFileSync(CACHE, 'utf8').split('\n')) if (line) solids.push(JSON.parse(line));
  console.log(`solids: ${solids.length} from the cache (${secs()})`);
} else {
  const list = zipEntries(ZIP).filter((e) => {
    const m = e.name.match(/udx\/bldg\/(\d{8})_bldg_6697_2_op\.gml$/);
    if (!m) return false;
    const [la, lo] = meshCorner(m[1]);
    return lo >= BOX.lon0 - 1e-9 && lo < BOX.lon1 - 1e-9 && la >= BOX.lat0 - 1e-9 && la < BOX.lat1 - 1e-6;
  });
  console.log(`meshes: ${list.length}, ${(list.reduce((s, e) => s + e.size, 0) / 1e9).toFixed(2)} GB of GML`);
  const out: string[] = [];
  for (const e of list) {
    const mesh = e.name.match(/(\d{8})_bldg/)![1];
    const fd = openSync(ZIP, 'r'), head = readAt(fd, e.headerOff, 30);
    closeSync(fd);
    const hv = new DataView(head.buffer), start = e.headerOff + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
    const reader = new Lod1Reader((s) => { solids.push({ ...s, mesh }); out.push(JSON.stringify({ ...s, mesh })); });
    const dec = new TextDecoder();
    let n = 0;
    for await (const chunk of createReadStream(ZIP, { start, end: start + e.compSize - 1, highWaterMark: 1 << 20 }).pipe(createInflateRaw({ chunkSize: 1 << 20 })) as AsyncIterable<Buffer>) {
      n += chunk.length;
      reader.push(dec.decode(chunk, { stream: true }));
    }
    reader.push(dec.decode());
    reader.end();
    if (n !== e.size) throw new Error(`${e.name}: ${n} bytes, directory says ${e.size}`);
  }
  writeFileSync(CACHE, out.join('\n') + '\n');
  console.log(`solids: ${solids.length} (${secs()})`);
}

// --- 2. Local footprints, levels, tiles -------------------------------------
const frame = frameAt(...ORIGIN), R = gaussRadius(ORIGIN[0]);
interface B { rings: [number, number][][]; height: number; cx: number; cy: number; level: number; id: string; lat: number; lon: number }
const blds: B[] = [];
let dropped = 0, vertsIn = 0, vertsOut = 0;
for (const s of solids) {
  if (!(s.height > 0.5)) { dropped++; continue; }
  const rings = s.rings.map((r) => {
    vertsIn += r.length;
    const loc = r.map(([la, lo]) => { const p = toLocal(frame, ecef(la, lo, 0)); return [p[0], p[1]] as [number, number]; });
    // Simplify as a closed ring: anchor at the first point, close, drop the closure.
    const s2 = simplify([...loc, loc[0]], SIMPLIFY_M).slice(0, -1);
    return s2.length >= 3 ? s2 : loc;
  });
  const area = (r: [number, number][]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  if (Math.abs(area(rings[0])) < 1) { dropped++; continue; }
  for (const r of rings) vertsOut += r.length;
  let cx = 0, cy = 0;
  for (const [x, y] of rings[0]) { cx += x; cy += y; }
  cx /= rings[0].length; cy /= rings[0].length;
  const height = Math.min(655, s.height);
  const level = LEVELS.findIndex((l) => height >= l.minHeight);
  const [la, lo] = s.rings[0][0];
  blds.push({ rings, height, cx, cy, level, id: s.id, lat: la, lon: lo });
}
console.log(`buildings: ${blds.length} (${dropped} dropped: under 0.5 m tall or 1 m2), vertices ${vertsIn} -> ${vertsOut} after ${SIMPLIFY_M} m Douglas-Peucker`);
const hist = LEVELS.map((_, l) => blds.filter((b) => b.level === l).length);
console.log(`per level (>= ${LEVELS.map((l) => l.minHeight).join(', ')} m): ${hist.join(', ')}`);

let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
for (const b of blds) for (const r of b.rings) for (const [x, y] of r) { xmin = Math.min(xmin, x); ymin = Math.min(ymin, y); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y); }
const SIZE = Math.ceil(Math.max(xmax - xmin, ymax - ymin) / 100) * 100;
const X0 = Math.floor(xmin), Y0 = Math.floor(ymin);
console.log(`root square ${SIZE} m at (${X0}, ${Y0}); data ${(xmax - xmin).toFixed(0)} x ${(ymax - ymin).toFixed(0)} m`);

rmSync(join(OUT, 't'), { recursive: true, force: true });
const byTile = new Map<string, B[]>();
for (const b of blds) {
  const s = SIZE / 2 ** b.level;
  const i = Math.min(2 ** b.level - 1, Math.floor((b.cx - X0) / s)), j = Math.min(2 ** b.level - 1, Math.floor((b.cy - Y0) / s));
  const k = `${b.level}/${i}/${j}`;
  (byTile.get(k) ?? byTile.set(k, []).get(k)!).push(b);
}
const tiles: IndexJson['tiles'] = [];
let rawBytes = 0, fileBytes = 0, roofDropped = 0, gpuBytes = 0, maxTileBuildings = 0;
for (const [k, list] of [...byTile].sort()) {
  const [L, i, j] = k.split('/').map(Number);
  const s = SIZE / 2 ** L, tx = X0 + i * s, ty = Y0 + j * s;
  // Buildings may reach past their tile (assigned by centroid): quantise over
  // a square twice the tile's size centred on it, so nothing clamps.
  const qx0 = tx - s / 2, qy0 = ty - s / 2, qs = 2 * s;
  // Morton order of centroids keeps neighbours together for deflate.
  list.sort((a, b) => morton(a, qx0, qy0, qs) - morton(b, qx0, qy0, qs));
  const fin: FootprintIn[] = list.map((b) => {
    // Earcut on the coordinates the GPU will get back (dequantised), so roof
    // and walls share vertices exactly.
    const rings = b.rings.map((r) => r.map(([x, y]) => [quantize(x - qx0, qs) / 65535 * qs, quantize(y - qy0, qs) / 65535 * qs] as [number, number]));
    const flat: number[] = [], holes: number[] = [];
    rings.forEach((r, n) => { if (n) holes.push(flat.length / 2); for (const p of r) flat.push(p[0], p[1]); });
    const roof = earcut(flat, holes);
    const n = flat.length / 2;
    if (roof.length / 3 < n - 2 + 2 * holes.length) roofDropped += n - 2 + 2 * holes.length - roof.length / 3;
    return { rings, height: b.height, roof };
  });
  const raw = encodeTile(fin, qs), z = deflateRawSync(raw, { level: 9 });
  mkdirSync(join(OUT, 't', `${L}`, `${i}`), { recursive: true });
  writeFileSync(join(OUT, 't', `${L}`, `${i}`, `${j}.bin`), z);
  rawBytes += raw.length; fileBytes += z.length;
  for (const f of fin) { const m = f.rings.reduce((a, r) => a + r.length, 0); gpuBytes += 2 * m * 8 + (6 * m + f.roof.length) * 2; }
  maxTileBuildings = Math.max(maxTileBuildings, list.length);
  tiles.push([L, i, j, list.length, Math.max(...list.map((b) => b.height)), z.length]);
}
function morton(b: B, x0: number, y0: number, s: number): number {
  let x = Math.floor((b.cx - x0) / s * 1023), y = Math.floor((b.cy - y0) / s * 1023), m = 0;
  for (let k = 0; k < 10; k++) m += (((x >> k) & 1) << (2 * k)) + (((y >> k) & 1) << (2 * k + 1));
  return m;
}
console.log(`tiles: ${tiles.length}, ${(rawBytes / 1e6).toFixed(1)} MB raw -> ${(fileBytes / 1e6).toFixed(1)} MB deflated; GPU if all loaded ${(gpuBytes / 1e6).toFixed(0)} MB; largest tile ${maxTileBuildings} buildings; roof triangles earcut could not make: ${roofDropped}`);
for (let L = 0; L < LEVELS.length; L++) {
  const t = tiles.filter((x) => x[0] === L);
  console.log(`  level ${L}: ${t.length} tiles of ${(SIZE / 2 ** L).toFixed(0)} m, ${t.reduce((a, x) => a + x[3], 0)} buildings, ${(t.reduce((a, x) => a + x[5], 0) / 1e6).toFixed(2)} MB, max ${Math.max(0, ...t.map((x) => x[5]))} B`);
}

// --- 3. Land masks ----------------------------------------------------------
type Geo = { type: string; coordinates: unknown };
function geojsonRows(sql: string): Geo[] {
  const txt = execFileSync('duckdb', ['-noheader', '-list', '-c', `load spatial; ${sql}`], { encoding: 'utf8', maxBuffer: 1 << 30 });
  return txt.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
}
const polys = (g: Geo): number[][][][] => (g.type === 'Polygon' ? [g.coordinates as number[][][]] : g.type === 'MultiPolygon' ? (g.coordinates as number[][][][]) : []);
const clip = (layer: string, [w, s, e, n]: number[]) =>
  geojsonRows(`select ST_AsGeoJSON(ST_Intersection(geometry, ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}))) from '${NE}/${layer}.parquet' where ST_Intersects(geometry, ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}));`);

const masks: { name: string; grid: Grid }[] = [];
function bakeMask(name: string, grid: Grid, ss: number, land: string, lakes: string, extra?: (m: Mask) => void): void {
  const m = new Mask(grid, ss), bbox = [grid.lon0, grid.lat0 - grid.h * grid.dlat, grid.lon0 + grid.w * grid.dlon, grid.lat0];
  let rings = 0;
  for (const g of clip(land, bbox)) for (const p of polys(g)) { m.fill(p, 1); rings += p.length; }
  for (const g of clip(lakes, bbox)) for (const p of polys(g)) { m.fill(p, 0); rings += p.length; }
  extra?.(m);
  const cov = m.coverage(), z = deflateRawSync(cov, { level: 9 });
  writeFileSync(join(OUT, `land-${name}.bin`), z);
  let landCells = 0;
  for (const v of cov) if (v >= 128) landCells++;
  console.log(`mask ${name}: ${grid.w}x${grid.h}, ${rings} rings, land ${(100 * landCells / cov.length).toFixed(1)}%, ${z.length} B (${secs()})`);
  masks.push({ name, grid });
}
bakeMask('world', { w: 3600, h: 1800, lon0: -180, lat0: 90, dlon: 0.1, dlat: 0.1 }, 2, '50m_physical/ne_50m_land', '50m_physical/ne_50m_lakes');
bakeMask('kanto', { w: 2250, h: 2000, lon0: 137.5, lat0: 37.8, dlon: 0.002, dlat: 0.002 }, 3, '10m_physical/ne_10m_land', '10m_physical/ne_10m_lakes');
bakeMask('city', { w: 875, h: 750, lon0: 139.6, lat0: 35.8, dlon: 0.0004, dlat: 0.0004 }, 3, '10m_physical/ne_10m_land', '10m_physical/ne_10m_lakes', (m) => {
  // Where PLATEAU has buildings there is land: a 60 m disc around each one.
  for (const b of blds) {
    const r = 60, n = 8, la = b.lat, lo = b.lon, kx = 1 / (111320 * Math.cos(la * Math.PI / 180)), ky = 1 / 110950;
    m.fill([Array.from({ length: n }, (_, k) => [lo + r * kx * Math.cos(2 * Math.PI * k / n), la + r * ky * Math.sin(2 * Math.PI * k / n)])], 1);
  }
});

// --- 4. Index and truth -----------------------------------------------------
const index: IndexJson & { masks: typeof masks; built: string } = {
  origin: ORIGIN, R, x0: X0, y0: Y0, size: SIZE, levels: LEVELS, tiles, masks,
  built: 'PLATEAU 13100 tokyo23-ku 2022 CityGML v2, LOD1; Natural Earth 5.1.2',
};
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));

// Known landmarks (coordinates and heights from outside the data) and the
// building PLATEAU has there: the bench projects its roof and reads it back.
const LANDMARKS = [
  { id: 'tocho', name: 'Tokyo Metropolitan Government Building No. 1', lat: 35.68963, lon: 139.69179, height: 243 },
  { id: 'tokyo-tower', name: 'Tokyo Tower', lat: 35.65858, lon: 139.74543, height: 333 },
  { id: 'skytree', name: 'Tokyo Skytree', lat: 35.71006, lon: 139.81070, height: 634 },
];
const truth = {
  buildings: blds.length, perLevel: hist, tiles: tiles.length, fileBytes, gpuBytes,
  landmarks: LANDMARKS.map((l) => {
    const p = toLocal(frame, ecef(l.lat, l.lon, 0));
    let best: B | null = null;
    for (const b of blds) if (Math.hypot(b.cx - p[0], b.cy - p[1]) < 150 && (!best || b.height > best.height)) best = b;
    return { ...l, x: p[0], y: p[1], found: best ? { id: best.id, height: best.height, cx: best.cx, cy: best.cy, level: best.level } : null };
  }),
  // A sample of buildings over the whole area for the colour check: every
  // 97th, with its centroid and height.
  sample: blds.filter((_, k) => k % 97 === 0).map((b) => [Math.round(b.cx * 10) / 10, Math.round(b.cy * 10) / 10, b.height, b.level]),
};
writeFileSync(join(OUT, 'truth.json'), JSON.stringify(truth));
for (const l of truth.landmarks) console.log(`landmark ${l.id}: ${l.found ? `${l.found.height.toFixed(1)} m at ${Math.hypot(l.found.cx - l.x, l.found.cy - l.y).toFixed(0)} m from its coordinate (known ${l.height} m)` : 'not found'}`);
console.log(`done (${secs()})`);
