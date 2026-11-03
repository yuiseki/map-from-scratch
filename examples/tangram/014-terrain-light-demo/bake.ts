// Bake Mt Fuji and the Fuji Five Lakes into one gzip-compressed grid
// (grid.ts has the layout):
//
//   1. Mapterhorn elevation, z11 (31 m texels; Mapterhorn builds z11 as the
//      2x2 mean of z12), 1280 x 1024 texels around 138.73E 35.43N: the
//      PMTiles tiles that cover it, read by Range from the local planet file,
//      decoded with GDAL's WEBP driver, Terrarium decoded, quantised to
//      0.25 m, planar-predicted to int16 residuals.
//   2. Water mask: OpenStreetMap lakes and reservoirs (natural=water,
//      landuse=reservoir) in the frozen Japan cut (GeoParquet, EPSG:3857),
//      selected by bbox with DuckDB and rasterised onto the same texel grid
//      with gdal_rasterize (texel centre inside the polygon).
//   3. gzip -9 of header + residuals + mask. The page inflates it with
//      DecompressionStream; normals and shadows are derived in the browser.
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { PMTiles } from '../../../tools/pmtiles.ts';
import { encodeGrid, decodeGrid, lonLatToTexel } from './grid.ts';

const PLANET = '/sata_hdd_24tb/www/html/static/mapterhorn/2026-01-06/planet.pmtiles';
const OSM = '/sata_hdd_24tb/hf_data/__published/osm-japan-src-2026-08/data/parquet/planet_osm_polygon.parquet';
const RAW = 'data/raw/tangram-014', OUT = 'data/baked/tangram-014-terrain-light-demo';
const Z = 11, W = 1280, H = 1024, LON = 138.73, LAT = 35.43, Q = 0.25;
const WORLD = 512 * 2 ** Z, R = 6378137, C = 2 * Math.PI * R;
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 }).toString();
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s]`, ...a);
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

const c = lonLatToTexel(LON, LAT, { z: Z, x0: 0, y0: 0 });
const X0 = Math.round(c.i - W / 2), Y0 = Math.round(c.j - H / 2);
const latOf = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / WORLD))) * 180) / Math.PI;
const lonOf = (px: number) => (px / WORLD) * 360 - 180;
const CELL = (C / WORLD) * Math.cos((latOf(Y0 + H / 2) * Math.PI) / 180);
log(`grid ${W}x${H} at z${Z}, px ${X0},${Y0}; ${lonOf(X0).toFixed(4)}-${lonOf(X0 + W).toFixed(4)}E ${latOf(Y0 + H).toFixed(4)}-${latOf(Y0).toFixed(4)}N; cell ${CELL.toFixed(3)} m, ${(W * CELL / 1000).toFixed(1)} x ${(H * CELL / 1000).toFixed(1)} km`);

// 1. Elevation.
const TX0 = Math.floor(X0 / 512), TX1 = Math.floor((X0 + W - 1) / 512), TY0 = Math.floor(Y0 / 512), TY1 = Math.floor((Y0 + H - 1) / 512);
const NTX = TX1 - TX0 + 1, NTY = TY1 - TY0 + 1;
const pm = new PMTiles(PLANET);
if (pm.header.tileType !== 4) throw new Error('expected WebP tiles');
let tileBytes = 0;
const sources: string[] = [];
for (let ty = TY0; ty <= TY1; ty++) for (let tx = TX0; tx <= TX1; tx++) {
  const f = `${RAW}/${Z}-${tx}-${ty}.webp`;
  if (!existsSync(f)) writeFileSync(f, pm.tile(Z, tx, ty)!);
  tileBytes += readFileSync(f).length;
  sources.push(`${Z}-${tx}-${ty}.webp`);
}
log(`${NTX}x${NTY} z${Z} tiles (x ${TX0}-${TX1}, y ${TY0}-${TY1}), ${tileBytes} B of WebP`);
const band = (b: number) => `<VRTRasterBand dataType="Byte" band="${b}">` + sources.map((s, n) =>
  `<SimpleSource><SourceFilename relativeToVRT="1">${s}</SourceFilename><SourceBand>${b}</SourceBand>` +
  `<SrcRect xOff="0" yOff="0" xSize="512" ySize="512"/><DstRect xOff="${(n % NTX) * 512}" yOff="${Math.floor(n / NTX) * 512}" xSize="512" ySize="512"/></SimpleSource>`).join('') + '</VRTRasterBand>';
writeFileSync(`${RAW}/mosaic.vrt`, `<VRTDataset rasterXSize="${NTX * 512}" rasterYSize="${NTY * 512}">${band(1)}${band(2)}${band(3)}</VRTDataset>`);
sh('gdal_translate', ['-q', '-of', 'ENVI', '-srcwin', String(X0 - TX0 * 512), String(Y0 - TY0 * 512), String(W), String(H), `${RAW}/mosaic.vrt`, `${RAW}/elev.raw`]);
const rgb = readFileSync(`${RAW}/elev.raw`);
if (rgb.length !== 3 * W * H) throw new Error(`raw size ${rgb.length}`);
const qh = new Int32Array(W * H);
let lo = Infinity, hi = -Infinity, top = 0;
for (let i = 0; i < W * H; i++) {
  const h = rgb[i] * 256 + rgb[W * H + i] + rgb[2 * W * H + i] / 256 - 32768;   // Terrarium
  qh[i] = Math.floor(h / Q + 0.5);
  if (h < lo) lo = h;
  if (h > hi) { hi = h; top = i; }
}
log(`heights ${lo.toFixed(2)} to ${hi.toFixed(2)} m; highest at ${lonOf(X0 + (top % W) + 0.5).toFixed(4)}E ${latOf(Y0 + Math.floor(top / W) + 0.5).toFixed(4)}N`);
if (lo < 0 || hi > 4000) throw new Error('heights outside 0..4000 m: wrong tiles or wrong decoding');

// 2. Water.
const mx = (px: number) => (px / WORLD) * C - C / 2, my = (py: number) => C / 2 - (py / WORLD) * C;
const [MX0, MX1, MY0, MY1] = [mx(X0), mx(X0 + W), my(Y0 + H), my(Y0)];
const geojson = `${RAW}/water.geojson`;
if (!existsSync(geojson)) {
  sh('duckdb', ['-c', `INSTALL spatial; LOAD spatial; SET threads=2; SET memory_limit='1500MB';
COPY (SELECT osm_id, name, "natural", water, landuse, way AS geom FROM read_parquet('${OSM}')
  WHERE bbox.xmax > ${MX0} AND bbox.xmin < ${MX1} AND bbox.ymax > ${MY0} AND bbox.ymin < ${MY1}
    AND ("natural" = 'water' OR landuse = 'reservoir'))
TO '${geojson}' WITH (FORMAT GDAL, DRIVER 'GeoJSON');`]);
}
const features = JSON.parse(readFileSync(geojson, 'utf8')).features as { properties: Record<string, string | null> }[];
const named = features.map((f) => f.properties.name).filter((n) => n && /湖/.test(n));
log(`${features.length} water polygons; lakes named: ${[...new Set(named)].join(', ')}`);
rmSync(`${RAW}/water.raw`, { force: true });
sh('gdal_rasterize', ['-q', '-burn', '1', '-ot', 'Byte', '-of', 'ENVI', '-init', '0', '-te', String(MX0), String(MY0), String(MX1), String(MY1), '-ts', String(W), String(H), geojson, `${RAW}/water.raw`]);
const water = new Uint8Array(readFileSync(`${RAW}/water.raw`));
if (water.length !== W * H) throw new Error(`water raster ${water.length}`);
let wet = 0;
for (const v of water) wet += v;
log(`water texels ${wet} (${((100 * wet) / (W * H)).toFixed(2)}%)`);

// Probes: a point inside each of the five lakes (DuckDB ST_PointOnSurface of the OSM polygon) must be water.
const LAKES: [string, number, number][] = [
  ['Motosu', 138.5855, 35.4643], ['Shoji', 138.6066, 35.4887], ['Sai', 138.6854, 35.4985], ['Kawaguchi', 138.7448, 35.5131], ['Yamanaka', 138.8768, 35.4187],
];
for (const [name, lon, lat] of LAKES) {
  const t = lonLatToTexel(lon, lat, { z: Z, x0: X0, y0: Y0 });
  const i = Math.floor(t.j) * W + Math.floor(t.i);
  log(`  ${name}: water ${water[i]}, ${(qh[i] * Q).toFixed(2)} m`);
  if (!water[i]) throw new Error(`${name} is not water in the mask`);
}

// 3. Encode.
const raw = encodeGrid({ w: W, h: H, z: Z, x0: X0, y0: Y0, q: Q, cell: CELL, qh, water });
const back = decodeGrid(raw);
for (let i = 0; i < W * H; i++) if (back.heights[i] !== qh[i] * Q) throw new Error(`round trip failed at ${i}`);
let maxRes = 0;
for (let i = 0; i < W * H; i++) maxRes = Math.max(maxRes, Math.abs(new DataView(raw.buffer).getInt16(32 + 2 * i, true)));
const gz = gzipSync(raw, { level: 9 });
writeFileSync(`${OUT}/fuji.mftl`, gz);
const gzHeights = gzipSync(raw.subarray(0, 32 + 2 * W * H), { level: 9 }).length;
log(`fuji.mftl ${gz.length} B gzip (${raw.length} B raw; heights alone ${gzHeights} B, mask ${gz.length - gzHeights} B); max |residual| ${maxRes} steps`);
