// Bake for maplibre-052: bear sightings of Akita (クマダス, CC BY 4.0) as heat
// points over Mapterhorn terrain of the Ou mountains, plus a coarse world
// terrain for the globe view.
//
// Outputs (data/baked/maplibre-052-...):
//   akita-z9.webp   z9 tiles x 454..456, y 192..195 of Mapterhorn as one
//                   1536 x 2048 lossless WebP, height in R,G (tiles.ts)
//   world-z1.webp   z1, all 4 tiles, 1024 x 1024, same encoding
//   points.bin      bear records (ツキノワグマ, every 情報種別), points.ts
//   meta.json       the tile ranges, counts, attribution
// Bench only:
//   truth.json      places for the pixel checks, chosen from the data here
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PMTiles } from '../../../tools/pmtiles.ts';
import { source } from '../../../tools/sources.ts';
import { parseCSV } from '../../25-akita-bear-sighting/data.ts';
import { mercX, mercY, lonOfX, latOfY, decodeTerrarium, encodeHeight, HEIGHT_STEP } from './tiles.ts';
import { encodePoints } from './points.ts';

const ID = 'maplibre-052-create-a-heatmap-layer-on-a-globe-with-terrain-elevation';
const PLANET = '/sata_hdd_24tb/www/html/static/mapterhorn/2026-01-06/planet.pmtiles';
const RAW = `data/raw/mapterhorn/${ID}`, OUT = `data/baked/${ID}`;
const AREA = { z: 9, x0: 454, y0: 192, nx: 3, ny: 4 };
const WORLD = { z: 1, x0: 0, y0: 0, nx: 2, ny: 2 };
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });

const pm = new PMTiles(PLANET);
if (pm.header.tileType !== 4) throw new Error('expected WebP Mapterhorn tiles');

// One tile range -> heights (m), decoded with GDAL's WebP driver (libwebp).
function heights(name: string, g: typeof AREA): { h: Float32Array; w: number; hgt: number; tileBytes: number } {
  const dir = `${RAW}/${name}`;
  mkdirSync(dir, { recursive: true });
  let tileBytes = 0;
  const srcs: string[] = [];
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const f = `${dir}/${g.x0 + i}-${g.y0 + j}.webp`;
    if (!existsSync(f)) {
      const t = pm.tile(g.z, g.x0 + i, g.y0 + j);
      if (!t) throw new Error(`missing tile ${g.z}/${g.x0 + i}/${g.y0 + j}`);
      writeFileSync(f, t);
    }
    tileBytes += statSync(f).size;
    srcs.push(`<SimpleSource><SourceFilename relativeToVRT="1">${g.x0 + i}-${g.y0 + j}.webp</SourceFilename><SourceBand>BAND</SourceBand>` +
      `<SrcRect xOff="0" yOff="0" xSize="512" ySize="512"/><DstRect xOff="${i * 512}" yOff="${j * 512}" xSize="512" ySize="512"/></SimpleSource>`);
  }
  const w = g.nx * 512, hgt = g.ny * 512;
  const band = (b: number) => `<VRTRasterBand dataType="Byte" band="${b}">${srcs.join('').replaceAll('BAND', String(b))}</VRTRasterBand>`;
  writeFileSync(`${dir}/mosaic.vrt`, `<VRTDataset rasterXSize="${w}" rasterYSize="${hgt}">${band(1)}${band(2)}${band(3)}</VRTDataset>`);
  sh('gdal_translate', ['-q', '-of', 'ENVI', `${dir}/mosaic.vrt`, `${dir}/mosaic.raw`]);
  const rgb = readFileSync(`${dir}/mosaic.raw`), n = w * hgt;
  if (rgb.length !== 3 * n) throw new Error(`raw size ${rgb.length}`);
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = decodeTerrarium(rgb[i], rgb[n + i], rgb[2 * n + i]);
  return { h, w, hgt, tileBytes };
}

// Heights -> R,G two-byte lossless WebP (B = 0), through a raw BSQ file.
function writeWebp(h: Float32Array, w: number, hgt: number, out: string): number {
  const n = w * hgt, raw = Buffer.alloc(3 * n);
  for (let i = 0; i < n; i++) { const [r, g] = encodeHeight(h[i]); raw[i] = r; raw[n + i] = g; }
  const base = `${RAW}/${out}`;
  writeFileSync(`${base}.raw`, raw);
  writeFileSync(`${base}.hdr`, `ENVI\nsamples = ${w}\nlines = ${hgt}\nbands = 3\nheader offset = 0\nfile type = ENVI Standard\ndata type = 1\ninterleave = bsq\nbyte order = 0\n`);
  sh('gdal_translate', ['-q', '-of', 'WEBP', '-co', 'LOSSLESS=YES', `${base}.raw`, `${OUT}/${out}`]);
  return statSync(`${OUT}/${out}`).size;
}

const area = heights('akita-z9', AREA);
const world = heights('world-z1', WORLD);
let hmin = Infinity, hmax = -Infinity, at = 0;
for (let i = 0; i < area.h.length; i++) { if (area.h[i] < hmin) hmin = area.h[i]; if (area.h[i] > hmax) { hmax = area.h[i]; at = i; } }
const areaBytes = writeWebp(area.h, area.w, area.hgt, 'akita-z9.webp');
const worldBytes = writeWebp(world.h, world.w, world.hgt, 'world-z1.webp');
const peakU = (at % area.w + 0.5) / area.w, peakV = (Math.floor(at / area.w) + 0.5) / area.hgt;
const uToLon = (u: number) => lonOfX((AREA.x0 + u * AREA.nx) / 2 ** AREA.z);
const vToLat = (v: number) => latOfY((AREA.y0 + v * AREA.ny) / 2 ** AREA.z);
console.log(`area ${area.w}x${area.hgt}: ${hmin.toFixed(1)}..${hmax.toFixed(1)} m, highest at ${uToLon(peakU).toFixed(4)}, ${vToLat(peakV).toFixed(4)}; ` +
  `Mapterhorn tiles ${area.tileBytes} B -> ${areaBytes} B (step ${HEIGHT_STEP} m)`);
console.log(`world ${world.w}x${world.hgt}: tiles ${world.tileBytes} B -> ${worldBytes} B`);

// Height at (u, v) of the area, bilinear, as the renderer samples it.
const heightAt = (u: number, v: number) => {
  const x = Math.min(area.w - 1.001, Math.max(0, u * area.w - 0.5)), y = Math.min(area.hgt - 1.001, Math.max(0, v * area.hgt - 0.5));
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, H = (a: number, b: number) => area.h[b * area.w + a];
  return (H(i, j) * (1 - fx) + H(i + 1, j) * fx) * (1 - fy) + (H(i, j + 1) * (1 - fx) + H(i + 1, j + 1) * fx) * fy;
};

// Bear sightings.
const rows = parseCSV(readFileSync(source('akita-kumadas'), 'utf8').replace(/^﻿/, ''));
const head = rows[0];
const col = (name: string) => { const k = head.findIndex((c) => c.startsWith(name)); if (k < 0) throw new Error(`no column ${name}`); return k; };
const cAnimal = col('獣種'), cDate = col('目撃日時'), cLat = col('x(緯度)'), cLon = col('y(経度)');
const pts: { u: number; v: number; year: number; lon: number; lat: number }[] = [];
let skipped = 0, bears = 0;
for (const r of rows.slice(1)) {
  if (r[cAnimal] !== 'ツキノワグマ') continue;
  bears++;
  const lat = parseFloat(r[cLat]), lon = parseFloat(r[cLon]), year = parseInt(r[cDate].slice(0, 4), 10);
  const u = (mercX(lon) * 2 ** AREA.z - AREA.x0) / AREA.nx, v = (mercY(lat) * 2 ** AREA.z - AREA.y0) / AREA.ny;
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1) || !(year > 2000)) { skipped++; continue; }
  pts.push({ u, v, year, lon, lat });
}
const bin = encodePoints(pts);
writeFileSync(`${OUT}/points.bin`, bin);
const years: Record<number, number> = {};
for (const p of pts) years[p.year] = (years[p.year] ?? 0) + 1;
console.log(`bears ${bears}, kept ${pts.length}, outside the area or undated ${skipped}, ${bin.length} B`, years);

// Check places, from the data: counts on a 1 km grid of the area.
const G = 1;                                    // km
const kmPerU = (AREA.nx * 512 * 2 ** -AREA.z * 40075.016) * Math.cos((39.7 * Math.PI) / 180) / 512;
const kmPerV = kmPerU * AREA.ny / AREA.nx;
const gw = Math.ceil(kmPerU / G), gh = Math.ceil(kmPerV / G), grid = new Uint32Array(gw * gh);
for (const p of pts) grid[Math.min(gh - 1, Math.floor(p.v * gh)) * gw + Math.min(gw - 1, Math.floor(p.u * gw))]++;
const around = (gx: number, gy: number, r: number) => {
  let s = 0;
  for (let y = Math.max(0, gy - r); y <= Math.min(gh - 1, gy + r); y++) for (let x = Math.max(0, gx - r); x <= Math.min(gw - 1, gx + r); x++) s += grid[y * gw + x];
  return s;
};
const place = (gx: number, gy: number) => { const u = (gx + 0.5) / gw, v = (gy + 0.5) / gh; return { lon: uToLon(u), lat: vToLat(v), u, v, h: heightAt(u, v) }; };
let dense = { n: -1, gx: 0, gy: 0 }, slope = { score: -1, gx: 0, gy: 0, n: 0 }, empty = { h: -1, gx: 0, gy: 0 };
for (let gy = 3; gy < gh - 3; gy++) for (let gx = 3; gx < gw - 3; gx++) {
  const n3 = around(gx, gy, 1);
  if (n3 > dense.n) dense = { n: n3, gx, gy };
  const h = heightAt((gx + 0.5) / gw, (gy + 0.5) / gh);
  // A cluster high on a slope: sightings in 3x3 km, few in the ring out to 6 km.
  const ring = around(gx, gy, 6) - around(gx, gy, 2);
  if (n3 >= 4 && ring <= n3 && h > 250 && n3 * h > slope.score) slope = { score: n3 * h, gx, gy, n: n3 };
  // No sightings within 8 km, on land, inside Akita's mountains.
  if (around(gx, gy, 8) === 0 && h > 300 && h < 1200 && h > empty.h) empty = { h, gx, gy };
}
const truth = {
  dense: { ...place(dense.gx, dense.gy), count3km: dense.n },
  slope: { ...place(slope.gx, slope.gy), count3km: slope.n },
  empty: place(empty.gx, empty.gy),
  peak: { lon: uToLon(peakU), lat: vToLat(peakV), h: hmax },
};
writeFileSync(`${OUT}/truth.json`, JSON.stringify(truth, null, 1));
console.log('truth', truth);

writeFileSync(`${OUT}/meta.json`, JSON.stringify({
  area: AREA, world: WORLD, count: pts.length, years,
  heightRange: [hmin, hmax],
}));
