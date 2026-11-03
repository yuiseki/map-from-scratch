// Bake the Tsugaru coast wind farms (Aomori, Japan) for the renderer:
//
//   data/baked/openglobus-075-wind-farm/terrain.bin   Mapterhorn heights on an
//       80 m local grid (format in terrain.ts), 140.08-140.46E 40.60-41.03N:
//       the coast from Ajigasawa to Shariki and Mt Iwaki (1,625 m) south of it
//   data/baked/openglobus-075-wind-farm/turbines.json every OSM wind turbine
//       (power=generator + generator:source=wind) in 140.10-140.45E
//       40.72-40.97N, in the same local metres, with sizes from its tags
//
// Sources: the frozen OSM Japan osm2pgsql GeoParquet (2026-08-31, ODbL) read
// with DuckDB, and the local Mapterhorn planet PMTiles (Terrarium WebP),
// decoded with GDAL's WebP driver as in examples/17-fuji-terrain-3d/bake.ts.
// The tower base height is not baked: the renderer takes it from the drawn
// mesh (terrain.ts heightAt). This bake checks that height against the z12
// DEM (14.5 m pixels) at every turbine and fails when they disagree by more
// than MAX_BASE_ERROR.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PMTiles } from '../../../tools/pmtiles.ts';
import { encodeTerrain, decodeTerrain, heightAt, toLocal, QUANTUM } from './terrain.ts';
import { turbineSize } from './turbine.ts';

const OSM = '/sata_hdd_24tb/hf_data/__published/osm-japan-src-2026-08/data/parquet/planet_osm_point.parquet';
const PLANET = '/sata_hdd_24tb/www/html/static/mapterhorn/2026-01-06/planet.pmtiles';
const RAW = 'data/raw/openglobus-075-wind-farm', OUT = 'data/baked/openglobus-075-wind-farm';
const FARM = { w: 140.10, e: 140.45, s: 40.72, n: 40.97 };
const AREA = { w: 140.08, e: 140.46, s: 40.60, n: 41.03 };
const LON0 = 140.25, LAT0 = 40.85, CELL = 80;
const MAX_BASE_ERROR = 12;   // m, grid surface vs z12 DEM at a turbine
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s]`, ...a);
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

// 1. Turbines.
const sql = `INSTALL spatial; LOAD spatial; SET threads=2; SET memory_limit='1500MB';
COPY (
  SELECT osm_id, ST_X(g) AS lon, ST_Y(g) AS lat, tags FROM (
    SELECT osm_id, tags, ST_Transform(way::GEOMETRY, 'EPSG:3857', 'EPSG:4326', always_xy := true) AS g
    FROM '${OSM}' WHERE power = 'generator' AND "generator:source" = 'wind')
  WHERE ST_X(g) BETWEEN ${FARM.w} AND ${FARM.e} AND ST_Y(g) BETWEEN ${FARM.s} AND ${FARM.n}
  ORDER BY osm_id
) TO '${RAW}/turbines.ndjson' (FORMAT json);`;
execFileSync('duckdb', ['-c', sql], { stdio: ['ignore', 'inherit', 'inherit'] });
const rows = readFileSync(`${RAW}/turbines.ndjson`, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { osm_id: number; lon: number; lat: number; tags: string });
log(`${rows.length} wind turbines in the farm box`);
if (rows.length < 50) throw new Error('expected the Tsugaru wind farms (about 90 turbines)');

// 2. Mapterhorn tiles at zoom z covering a box (plus a one-pixel margin),
//    decoded into metres. Returns a sampler in degrees (bilinear between
//    pixel centres, Web Mercator pixel space).
const pm = new PMTiles(PLANET);
if (pm.header.tileType !== 4) throw new Error('expected WebP Terrarium tiles');
const mercX = (lon: number, z: number) => ((lon + 180) / 360) * 512 * 2 ** z;
const mercY = (lat: number, z: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 512 * 2 ** z;
function dem(z: number, box: typeof AREA, name: string): { sample: (lon: number, lat: number) => number; tiles: number; bytes: number } {
  const tx0 = Math.floor((mercX(box.w, z) - 1) / 512), tx1 = Math.floor((mercX(box.e, z) + 1) / 512);
  const ty0 = Math.floor((mercY(box.n, z) - 1) / 512), ty1 = Math.floor((mercY(box.s, z) + 1) / 512);
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1, W = nx * 512, H = ny * 512;
  const dir = `${RAW}/${name}`;
  mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const f = `${dir}/${tx}-${ty}.webp`;
    if (!existsSync(f)) {
      const t = pm.tile(z, tx, ty);
      if (!t) throw new Error(`missing tile ${z}/${tx}/${ty}`);
      writeFileSync(f, t);
    }
    bytes += readFileSync(f).length;
  }
  const band = (b: number) => `<VRTRasterBand dataType="Byte" band="${b}">` + Array.from({ length: nx * ny }, (_, n) => {
    const i = n % nx, j = Math.floor(n / nx);
    return `<SimpleSource><SourceFilename relativeToVRT="1">${tx0 + i}-${ty0 + j}.webp</SourceFilename><SourceBand>${b}</SourceBand>` +
      `<SrcRect xOff="0" yOff="0" xSize="512" ySize="512"/><DstRect xOff="${i * 512}" yOff="${j * 512}" xSize="512" ySize="512"/></SimpleSource>`;
  }).join('') + '</VRTRasterBand>';
  writeFileSync(`${dir}/mosaic.vrt`, `<VRTDataset rasterXSize="${W}" rasterYSize="${H}">${band(1)}${band(2)}${band(3)}</VRTDataset>`);
  execFileSync('gdal_translate', ['-q', '-of', 'ENVI', `${dir}/mosaic.vrt`, `${dir}/mosaic.raw`], { stdio: 'inherit' });
  const rgb = readFileSync(`${dir}/mosaic.raw`);
  if (rgb.length !== 3 * W * H) throw new Error(`raw size ${rgb.length}`);
  const P = W * H, h = new Float64Array(P);
  for (let i = 0; i < P; i++) h[i] = rgb[i] * 256 + rgb[P + i] + rgb[2 * P + i] / 256 - 32768;
  const sample = (lon: number, lat: number) => {
    const px = mercX(lon, z) - tx0 * 512 - 0.5, py = mercY(lat, z) - ty0 * 512 - 0.5;
    const i = Math.floor(px), j = Math.floor(py), fx = px - i, fy = py - j;
    if (i < 0 || j < 0 || i + 1 >= W || j + 1 >= H) throw new Error(`sample outside the mosaic: ${lon} ${lat}`);
    const at = (a: number, b: number) => h[b * W + a];
    return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
  };
  log(`z${z}: ${nx}x${ny} tiles, ${bytes} B of WebP, ${W}x${H} px`);
  return { sample, tiles: nx * ny, bytes };
}

// 3. The terrain grid: z10 (58 m pixels at 40.8N; Mapterhorn's z10 is the
//    2x2 mean of z11) sampled bilinearly at 80 m vertices.
const z10 = dem(10, AREA, 'z10');
const [xw, ys] = toLocal(AREA.w, AREA.s, LON0, LAT0), [xe, yn] = toLocal(AREA.e, AREA.n, LON0, LAT0);
const x0 = Math.ceil(xw / CELL) * CELL, y0 = Math.ceil(ys / CELL) * CELL;
const w = Math.floor((xe - x0) / CELL) + 1, h = Math.floor((yn - y0) / CELL) + 1;
const k = (180 / Math.PI) / 6371008.8;
const heights = new Float64Array(w * h);
let hmax = 0, sea = 0;
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
  const lat = LAT0 + (y0 + j * CELL) * k, lon = LON0 + (x0 + i * CELL) * k / Math.cos((LAT0 * Math.PI) / 180);
  const v = z10.sample(lon, lat);
  heights[j * w + i] = v;
  hmax = Math.max(hmax, v);
  if (v <= 0) sea++;
}
const bin = encodeTerrain({ w, h, cell: CELL, x0, y0, lon0: LON0, lat0: LAT0 }, heights);
writeFileSync(`${OUT}/terrain.bin`, bin);
log(`terrain ${w}x${h} at ${CELL} m, max ${hmax.toFixed(1)} m, ${(100 * sea / (w * h)).toFixed(1)} % sea, ${bin.length} B`);
if (hmax < 1500 || hmax > 1700) throw new Error(`Mt Iwaki (1,625 m) should be the top of the area, got ${hmax}`);

// 4. Turbines in local metres, with the base error against the z12 DEM.
const grid = decodeTerrain(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length) as ArrayBuffer);
const z12 = dem(12, { w: FARM.w, e: FARM.e, s: FARM.s, n: FARM.n }, 'z12');
const sources: Record<string, number> = {};
let worst = 0, sum = 0;
const turbines = rows.map((r) => {
  const tags = JSON.parse(r.tags) as Record<string, string>;
  const size = turbineSize(tags);
  sources[size.source] = (sources[size.source] ?? 0) + 1;
  const [x, y] = toLocal(r.lon, r.lat, LON0, LAT0);
  const err = Math.abs(heightAt(grid, x, y) - Math.max(0, z12.sample(r.lon, r.lat)));
  worst = Math.max(worst, err);
  sum += err;
  return [r.osm_id, Math.round(x * 10) / 10, Math.round(y * 10) / 10, size.tip, size.hub, size.diameter, size.source];
});
log(`sizes by source ${JSON.stringify(sources)}; tower base vs z12 DEM: mean ${(sum / rows.length).toFixed(2)} m, max ${worst.toFixed(2)} m`);
if (worst > MAX_BASE_ERROR) throw new Error(`a tower base is ${worst} m off the z12 DEM`);
writeFileSync(`${OUT}/turbines.json`, JSON.stringify({
  osm: 'OpenStreetMap Japan extract 2026-08-31 (osm2pgsql GeoParquet), ODbL',
  lon0: LON0, lat0: LAT0,
  columns: ['osm_id', 'x', 'y', 'tip', 'hub', 'diameter', 'size_source'],
  base_error_m: { mean: Math.round(sum / rows.length * 100) / 100, max: Math.round(worst * 100) / 100, quantum: QUANTUM },
  turbines,
}));
log(`wrote ${OUT}/turbines.json (${turbines.length} turbines)`);
