import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { source } from '../../../tools/sources.ts';

// forge3d's "Swiss Land-Cover": Switzerland's terrain with a land-cover
// classification draped over it, near top-down, with a title, caption and
// legend. The page gets one grid: per cell a 16-bit height and an 8-bit
// class, 0 outside the border. Hillshade is left to the shader so the class
// can stay one byte.

const RAW_DIR = 'data/raw/forge3d-003';
const OUT_DIR = 'data/baked/forge3d-003-swiss-landcover';
const TILE_Z = 8; // 256 px tiles: ~420 m cells at 46.8 deg N
const BBOX = [5.95, 45.81, 10.5, 47.81]; // W S E N, Switzerland plus a margin

// Esri 10 m land cover classes kept (2 to 11), in legend order, with Esri's
// own colours. The page reads the palette from legend.json.
const CLASSES = [
  { code: 1, name: 'Water', ja: '水域', colour: '#419bdf' },
  { code: 2, name: 'Trees', ja: '森林', colour: '#397d49' },
  { code: 4, name: 'Flooded vegetation', ja: '湿地', colour: '#7a87c6' },
  { code: 5, name: 'Crops', ja: '農地', colour: '#e49635' },
  { code: 7, name: 'Built area', ja: '市街地', colour: '#c4281b' },
  { code: 8, name: 'Bare ground', ja: '裸地', colour: '#a59b8f' },
  { code: 9, name: 'Snow/ice', ja: '雪氷', colour: '#a8ebff' },
  { code: 10, name: 'Clouds', ja: '雲', colour: '#616161' },
  { code: 11, name: 'Rangeland', ja: '草地', colour: '#e3e2c3' },
];

// Esri / Impact Observatory / Microsoft 10 m annual land cover 2024, the UTM
// 32T and 31T tiles that hold Switzerland. CC BY 4.0.
const LULC = ['32T', '31T'].map((z) => `https://lulctimeseries.blob.core.windows.net/lulctimeseriesv003/lc2024/${z}_20240101-20241231.tif`);

mkdirSync(RAW_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const n = 2 ** TILE_Z;
const tileX = (lon: number): number => ((lon + 180) / 360) * n;
const tileY = (lat: number): number => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
};
const latOf = (y: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
const MERC = 20037508.342789244;
const mercX = (tx: number): number => (tx / n) * 2 * MERC - MERC;
const mercY = (ty: number): number => MERC - (ty / n) * 2 * MERC;

// The grid is the z8 pixels covering BBOX.
const PX0 = Math.floor(tileX(BBOX[0]) * 256), PX1 = Math.ceil(tileX(BBOX[2]) * 256);
const PY0 = Math.floor(tileY(BBOX[3]) * 256), PY1 = Math.ceil(tileY(BBOX[1]) * 256);
const W = PX1 - PX0, H = PY1 - PY0;

async function getTile(x: number, y: number): Promise<Buffer> {
  const file = `${RAW_DIR}/terrarium_${TILE_Z}_${x}_${y}.png`;
  if (existsSync(file)) return readFileSync(file);
  const res = await fetch(`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${TILE_Z}/${x}/${y}.png`);
  if (!res.ok) throw new Error(`terrarium ${TILE_Z}/${x}/${y}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

// Minimal PNG reader for the 8-bit RGB terrarium tiles (filters 0-4).
function parsePng(buf: Buffer): Uint8Array {
  let pos = 8;
  const idat: Buffer[] = [];
  let width = 0;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') width = buf.readUInt32BE(pos + 8);
    else if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 3, stride = 1 + width * bpp, rowLen = width * bpp;
  const px = new Uint8Array(rowLen * width);
  for (let y = 0; y < width; y++) {
    const filter = raw[y * stride];
    for (let x = 0; x < rowLen; x++) {
      const val = raw[y * stride + 1 + x];
      const left = x >= bpp ? px[y * rowLen + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * rowLen + x] : 0;
      const upLeft = y > 0 && x >= bpp ? px[(y - 1) * rowLen + x - bpp] : 0;
      let res = val;
      if (filter === 1) res = val + left;
      else if (filter === 2) res = val + up;
      else if (filter === 3) res = val + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        res = val + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      px[y * rowLen + x] = res & 0xff;
    }
  }
  return px;
}

// Runs a GDAL tool and returns the W x H byte grid it wrote (ENVI raw).
function gdalGrid(tool: string, args: string[], name: string): Uint8Array {
  const out = `${RAW_DIR}/${name}.bin`;
  execFileSync(tool, ['-q', ...args, '-of', 'ENVI', '-ot', 'Byte', '-te', String(mercX(PX0 / 256)), String(mercY(PY1 / 256)), String(mercX(PX1 / 256)), String(mercY(PY0 / 256)), '-ts', String(W), String(H), out], { stdio: 'inherit' });
  const grid = new Uint8Array(readFileSync(out));
  if (grid.length !== W * H) throw new Error(`${name}: ${grid.length} bytes, want ${W * H}`);
  return grid;
}

async function bake(): Promise<void> {
  // Heights: the z8 terrarium pixels themselves.
  const heights = new Uint16Array(W * H);
  for (let ty = Math.floor(PY0 / 256); ty <= Math.floor((PY1 - 1) / 256); ty++) {
    for (let tx = Math.floor(PX0 / 256); tx <= Math.floor((PX1 - 1) / 256); tx++) {
      const px = parsePng(await getTile(tx, ty));
      for (let y = 0; y < 256; y++) {
        const gy = ty * 256 + y - PY0;
        if (gy < 0 || gy >= H) continue;
        for (let x = 0; x < 256; x++) {
          const gx = tx * 256 + x - PX0;
          if (gx < 0 || gx >= W) continue;
          const i = (y * 256 + x) * 3;
          heights[gy * W + gx] = Math.max(0, Math.round(px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768));
        }
      }
    }
  }

  // Land cover: the two UTM tiles warped onto the grid, the most common
  // class in each cell. They are Cloud Optimized GeoTIFFs, so GDAL reads only
  // the overview nearest the 420 m cells over HTTP, not the 325 MB of 10 m
  // pixels.
  const lulc = gdalGrid('gdalwarp', ['-overwrite', '-t_srs', 'EPSG:3857', '-r', 'mode', '-dstnodata', '0', ...LULC.map((t) => `/vsicurl/${t}`)], 'lulc');
  // The border: Natural Earth 10m Switzerland burnt into the same grid.
  const ch = `${RAW_DIR}/che.geojson`;
  rmSync(ch, { force: true }); // the GeoJSON driver cannot overwrite in place
  execFileSync('ogr2ogr', ['-f', 'GeoJSON', '-t_srs', 'EPSG:3857', '-where', "ADM0_A3 = 'CHE'", ch, source('ne-countries')], { stdio: 'inherit' });
  const mask = gdalGrid('gdal_rasterize', ['-burn', '1', '-init', '0', ch], 'mask');

  // Terrarium has a few voids inside the border (0 m, 45 m, where
  // Switzerland's lowest ground is 193 m). Fill each from its neighbours
  // so the exaggerated relief has no pits.
  let filled = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || heights[i] >= 150) continue;
    const x = i % W, y = Math.floor(i / W);
    let sum = 0, cnt = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const v = heights[ny * W + nx];
        if (v >= 150) { sum += v; cnt++; }
      }
    }
    if (cnt) { heights[i] = Math.round(sum / cnt); filled++; }
  }

  const index = new Map(CLASSES.map((c, i) => [c.code, i + 1]));
  const classes = new Uint8Array(W * H);
  const counts = new Array(CLASSES.length + 1).fill(0);
  let minElev = Infinity, maxElev = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const k = index.get(lulc[i]) ?? 0;
    if (!k) throw new Error(`cell ${i} inside the border has land-cover code ${lulc[i]}`);
    classes[i] = k;
    counts[k]++;
    minElev = Math.min(minElev, heights[i]);
    maxElev = Math.max(maxElev, heights[i]);
  }
  const inside = counts.reduce((a, b) => a + b, 0);

  // Cell size in metres at the grid's middle latitude (Mercator cells are square).
  const latC = latOf((PY0 + H / 2) / 256);
  const cellM = (40075016 / n / 256) * Math.cos((latC * Math.PI) / 180);
  const header = Buffer.alloc(32);
  header.write('SWLC', 0, 'ascii');
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(W, 6);
  header.writeUInt16LE(H, 8);
  header.writeUInt16LE(minElev, 10);
  header.writeUInt16LE(maxElev, 12);
  header.writeFloatLE(cellM, 14);
  header.writeUInt32LE(PX0, 18);
  header.writeUInt32LE(PY0, 22);
  header.writeUInt16LE(TILE_Z, 26);
  const out = Buffer.concat([header, Buffer.from(heights.buffer), Buffer.from(classes)]);
  writeFileSync(`${OUT_DIR}/swiss.bin`, out);
  // The legend: the classes present, with their share of Switzerland.
  const legend = CLASSES.map((c, i) => ({ ...c, index: i + 1, cells: counts[i + 1], share: Number((counts[i + 1] / inside).toFixed(6)) })).filter((c) => c.cells > 0);
  writeFileSync(`${OUT_DIR}/legend.json`, `[\n${legend.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`);
  console.log(`Baked ${W}x${H} Swiss grid (${cellM.toFixed(0)} m cells, ${inside} inside, ${minElev}-${maxElev} m, ${filled} voids filled) -> swiss.bin (${(out.length / 1024).toFixed(0)} KB); ` +
    legend.map((c) => `${c.name} ${c.cells}`).join(', '));
}

await bake();
