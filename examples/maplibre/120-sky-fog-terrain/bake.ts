// Bake Mapterhorn elevation of the Northern Japan Alps into two height grids:
//
//   near.mfsh.gz  z11 (30.8 m), 1281 x 1281 samples, 39.4 km square around
//                 137.65E 36.33N (Yarigatake / Hotaka), 0.25 m quanta
//   far.mfsh.gz   z7 (493 m), 513 x 513 samples, 253 km square on the same
//                 centre, 1 m quanta: the ridges and the horizon behind
//
// Both: tiles read by Range from the local planet.pmtiles (tools/pmtiles.ts),
// WebP decoded by GDAL's WEBP driver (libwebp) through a VRT mosaic, Terrarium
// decoded here, cut to the window, delta coded (heights.ts) and gzipped.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { PMTiles } from '../../../tools/pmtiles.ts';
import { encodeHeights, decodeHeights, terrarium } from './heights.ts';

const PLANET = '/sata_hdd_24tb/www/html/static/mapterhorn/2026-01-06/planet.pmtiles';
const RAW = 'data/raw/mapterhorn/alps', OUT = 'data/baked/maplibre-120-sky-fog-terrain';
const LON = 137.65, LAT = 36.33;
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

const pm = new PMTiles(PLANET);
if (pm.header.tileType !== 4 || pm.header.maxZoom !== 12) throw new Error('expected WebP Terrarium tiles to z12');

const worldPx = (z: number) => {
  const n = 512 * 2 ** z, s = Math.sin((LAT * Math.PI) / 180);
  return [((LON + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

function bake(name: string, z: number, size: number, q: number): void {
  const [cx, cy] = worldPx(z);
  const x0 = Math.round(cx) - (size - 1) / 2, y0 = Math.round(cy) - (size - 1) / 2;
  const tx0 = Math.floor(x0 / 512), ty0 = Math.floor(y0 / 512);
  const tx1 = Math.floor((x0 + size - 1) / 512), ty1 = Math.floor((y0 + size - 1) / 512);
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1;
  let tileBytes = 0;
  const sources: string[][] = [[], [], []];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const f = `${RAW}/${z}-${tx}-${ty}.webp`;
    if (!existsSync(f)) {
      const t = pm.tile(z, tx, ty);
      if (!t) throw new Error(`missing tile ${z}/${tx}/${ty}`);
      writeFileSync(f, t);
    }
    tileBytes += readFileSync(f).length;
    for (let b = 1; b <= 3; b++) sources[b - 1].push(
      `<SimpleSource><SourceFilename relativeToVRT="1">${z}-${tx}-${ty}.webp</SourceFilename><SourceBand>${b}</SourceBand>` +
      `<SrcRect xOff="0" yOff="0" xSize="512" ySize="512"/><DstRect xOff="${(tx - tx0) * 512}" yOff="${(ty - ty0) * 512}" xSize="512" ySize="512"/></SimpleSource>`);
  }
  const vrt = `${RAW}/${name}.vrt`, raw = `${RAW}/${name}.raw`;
  writeFileSync(vrt, `<VRTDataset rasterXSize="${nx * 512}" rasterYSize="${ny * 512}">` +
    sources.map((s, i) => `<VRTRasterBand dataType="Byte" band="${i + 1}">${s.join('')}</VRTRasterBand>`).join('') + '</VRTDataset>');
  execFileSync('gdal_translate', ['-q', '-of', 'ENVI', '-srcwin', String(x0 - tx0 * 512), String(y0 - ty0 * 512), String(size), String(size), vrt, raw], { stdio: 'inherit' });
  const rgb = readFileSync(raw), n = size * size;
  if (rgb.length !== 3 * n) throw new Error(`raw size ${rgb.length}`);
  const h = new Float32Array(n);
  // Integer channels: no float noise, so sea level is exactly 0 (rendering-mistakes.md, Terrain)
  for (let i = 0; i < n; i++) h[i] = terrarium(rgb[i], rgb[n + i], rgb[2 * n + i]);
  const step = (40075016.686 / (512 * 2 ** z)) * Math.cos((LAT * Math.PI) / 180);
  const bytes = encodeHeights(h, size, size, { z, x0, y0, step, q });
  // round trip: the page must see what was baked
  const back = decodeHeights(bytes);
  let worst = 0, min = Infinity, max = -Infinity, at = 0;
  for (let i = 0; i < n; i++) {
    worst = Math.max(worst, Math.abs(back.heights[i] - h[i]));
    if (h[i] < min) min = h[i];
    if (h[i] > max) { max = h[i]; at = i; }
  }
  if (worst > q / 2 + 1e-3) throw new Error(`${name}: round trip error ${worst}`);
  const gz = gzipSync(bytes, { level: 9 });
  writeFileSync(`${OUT}/${name}.mfsh.gz`, gz);
  const ax = (x0 + (at % size)) / (512 * 2 ** z) * 360 - 180;
  const ay = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y0 + Math.floor(at / size))) / (512 * 2 ** z)))) * 180) / Math.PI;
  console.log(`${name}: z${z} ${nx}x${ny} tiles (${tileBytes} B), ${size}x${size} samples, step ${step.toFixed(2)} m, ` +
    `h ${min.toFixed(1)}..${max.toFixed(1)} m (max at ${ax.toFixed(4)}E ${ay.toFixed(4)}N), raw ${bytes.length} B, gzip ${gz.length} B`);
}

bake('near', 11, 1281, 0.25);
bake('far', 7, 513, 1);
