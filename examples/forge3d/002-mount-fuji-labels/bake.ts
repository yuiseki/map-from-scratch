import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { source } from '../../../tools/sources.ts';

// forge3d's "Mount Fuji Labels": the Fuji DEM with its placename dataset as
// labels. The terrain is baked the way forge3d-001 bakes Rainier (a 16-bit
// height grid plus a colour grid with the fixed sun's hillshade burnt in);
// the labels become grid coordinates and a priority, so the page only has to
// project them and decide which fit.

const RAW_DIR = 'data/raw/forge3d-002';
const OUT_DIR = 'data/baked/forge3d-002-mount-fuji-labels';
const TILE_Z = 11;
const MOSAIC = 512;
const OUT = 384; // 384 x 62.6 m = 24 km around the summit: every place fits
const SUMMIT = [138.7274, 35.3606]; // lon, lat: where the 2x2 tiles are centred
const SUN_AZ = 315;
const SUN_EL = 35;

mkdirSync(RAW_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const tileX = (lon: number): number => ((lon + 180) / 360) * 2 ** TILE_Z;
const tileY = (lat: number): number => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** TILE_Z;
};
const lonOf = (x: number): number => (x / 2 ** TILE_Z) * 360 - 180;
const latOf = (y: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** TILE_Z))) * 180) / Math.PI;
// The 2x2 block whose centre is nearest the summit.
const TILE_X = Math.round(tileX(SUMMIT[0])) - 1;
const TILE_Y = Math.round(tileY(SUMMIT[1])) - 1;

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
function parsePng(buf: Buffer): { width: number; height: number; pixels: Uint8Array } {
  let pos = 8;
  const idat: Buffer[] = [];
  let width = 0, height = 0;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(pos + 8, pos + 8 + len));
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 3, stride = 1 + width * bpp;
  const pixels = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    for (let x = 0; x < width * bpp; x++) {
      const val = raw[y * stride + 1 + x];
      const left = x >= bpp ? pixels[y * width * bpp + x - bpp] : 0;
      const up = y > 0 ? pixels[(y - 1) * width * bpp + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[(y - 1) * width * bpp + x - bpp] : 0;
      let res = val;
      if (filter === 1) res = val + left;
      else if (filter === 2) res = val + up;
      else if (filter === 3) res = val + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        res = val + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      pixels[y * width * bpp + x] = res & 0xff;
    }
  }
  return { width, height, pixels };
}

// Hypsometric tint: forest at the foot, the bare red-brown scoria of the
// upper cone, grey then snow at the crater.
const RAMP: [number, [number, number, number]][] = [
  [0, [96, 140, 86]],
  [900, [118, 150, 92]],
  [1600, [92, 124, 74]],
  [2300, [146, 112, 88]],
  [2900, [130, 96, 82]],
  [3400, [176, 170, 168]],
  [3700, [246, 248, 252]],
];
function tint(h: number): [number, number, number] {
  if (h <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    if (h > RAMP[i][0]) continue;
    const [h0, c0] = RAMP[i - 1], [h1, c1] = RAMP[i];
    const t = (h - h0) / (h1 - h0);
    return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as [number, number, number];
  }
  return RAMP[RAMP.length - 1][1];
}

// Which labels win when two collide: the summit, then the fifth stations
// (where the trails start), then the stations on the trails from the top
// down, then the villages.
interface Place { name: string; en: string; ele: number | null; lon: number; lat: number; rank: number; id: string }
function rankOf(p: Record<string, string | null>): number {
  if ((p.name ?? '').includes('五合目')) return 1;
  if (p.tourism === 'attraction') return 2;
  if (p.place === 'locality') return 3;
  return 4;
}

async function bake(): Promise<void> {
  const elev = new Int16Array(MOSAIC * MOSAIC);
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const png = parsePng(await getTile(TILE_X + tx, TILE_Y + ty));
      if (png.width !== 256 || png.height !== 256) throw new Error(`unexpected tile size ${png.width}x${png.height}`);
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const i = (y * 256 + x) * 3;
          elev[(ty * 256 + y) * MOSAIC + tx * 256 + x] = Math.round(png.pixels[i] * 256 + png.pixels[i + 1] + png.pixels[i + 2] / 256 - 32768);
        }
      }
    }
  }

  let peak = 0;
  for (let i = 1; i < elev.length; i++) if (elev[i] > elev[peak]) peak = i;
  const peakX = peak % MOSAIC, peakY = Math.floor(peak / MOSAIC);
  const x0 = Math.max(0, Math.min(MOSAIC - OUT, peakX - OUT / 2));
  const y0 = Math.max(0, Math.min(MOSAIC - OUT, peakY - OUT / 2));
  const latC = latOf(TILE_Y + (y0 + OUT / 2) / 256);
  const cellM = ((40075016 / 2 ** TILE_Z) * Math.cos((latC * Math.PI) / 180)) / 256;

  const heights = new Uint16Array(OUT * OUT);
  const colours = new Uint8Array(OUT * OUT * 3);
  let minElev = Infinity, maxElev = -Infinity;
  const az = (SUN_AZ * Math.PI) / 180, el = (SUN_EL * Math.PI) / 180;
  const sun = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  for (let y = 0; y < OUT; y++) {
    for (let x = 0; x < OUT; x++) {
      const mx = x0 + x, my = y0 + y;
      const h = Math.max(0, elev[my * MOSAIC + mx]); // the bay to the south is below 0 in places
      heights[y * OUT + x] = h;
      minElev = Math.min(minElev, h);
      maxElev = Math.max(maxElev, h);
      const at = (ax: number, ay: number): number => Math.max(0, elev[Math.min(MOSAIC - 1, Math.max(0, ay)) * MOSAIC + Math.min(MOSAIC - 1, Math.max(0, ax))]);
      const nx = -(at(mx + 1, my) - at(mx - 1, my)) / (2 * cellM);
      const ny = (at(mx, my + 1) - at(mx, my - 1)) / (2 * cellM); // image y grows south
      const lambert = Math.max(0, (nx * sun[0] + ny * sun[1] + sun[2]) / Math.hypot(nx, ny, 1));
      const k = 0.35 + 0.75 * lambert;
      const c = tint(h);
      for (let j = 0; j < 3; j++) colours[(y * OUT + x) * 3 + j] = Math.min(255, Math.round(c[j] * k));
    }
  }
  const bounds = [lonOf(TILE_X + x0 / 256), latOf(TILE_Y + (y0 + OUT) / 256), lonOf(TILE_X + (x0 + OUT) / 256), latOf(TILE_Y + y0 / 256)];

  // Places as grid fractions (u east, v south) in the crop.
  const geo = JSON.parse(readFileSync(source('forge3d-mount-fuji-places'), 'utf8'));
  const places: Place[] = geo.features.map((f: { properties: Record<string, string | null>; geometry: { coordinates: number[] } }) => ({
    id: f.properties.osm_id,
    name: f.properties.name ?? '',
    en: f.properties['name.en'] ?? '',
    ele: f.properties.ele ? Number(f.properties.ele) : null,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    rank: rankOf(f.properties),
  }));
  const uOf = (lon: number): number => ((tileX(lon) - TILE_X) * 256 - x0) / OUT;
  const vOf = (lat: number): number => ((tileY(lat) - TILE_Y) * 256 - y0) / OUT;
  const labels = [
    // forge3d's sketch adds the mountain's own label at the summit.
    { name: '富士山', en: 'Mount Fuji', ele: null, u: (peakX - x0 + 0.5) / OUT, v: (peakY - y0 + 0.5) / OUT, rank: 0 },
    ...places
      .sort((a, b) => a.rank - b.rank || (b.ele ?? 0) - (a.ele ?? 0) || a.id.localeCompare(b.id))
      .map((p) => ({ name: p.name, en: p.en, ele: p.ele, u: uOf(p.lon), v: vOf(p.lat), rank: p.rank })),
  ].map((l) => ({ ...l, u: Number(l.u.toFixed(5)), v: Number(l.v.toFixed(5)) }));
  const outside = labels.filter((l) => l.u < 0 || l.u > 1 || l.v < 0 || l.v > 1);
  if (outside.length) throw new Error(`labels outside the crop: ${outside.map((l) => l.name).join(', ')}`);

  const header = Buffer.alloc(42);
  header.write('FUJI', 0, 'ascii');
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(OUT, 6);
  header.writeUInt16LE(OUT, 8);
  bounds.forEach((b, i) => header.writeFloatLE(b, 10 + i * 4));
  header.writeUInt16LE(minElev, 26);
  header.writeUInt16LE(maxElev, 28);
  header.writeFloatLE((peakX - x0 + 0.5) / OUT, 30);
  header.writeFloatLE((peakY - y0 + 0.5) / OUT, 34);
  header.writeFloatLE(cellM, 38);
  const terrain = Buffer.concat([header, Buffer.from(heights.buffer), Buffer.from(colours)]);
  writeFileSync(`${OUT_DIR}/fuji.bin`, terrain);
  // One label per line, in priority order.
  writeFileSync(`${OUT_DIR}/labels.json`, `[\n${labels.map((l) => JSON.stringify(l)).join(',\n')}\n]\n`);
  console.log(
    `Baked ${OUT}x${OUT} Fuji terrain (${minElev}-${maxElev} m, ${cellM.toFixed(1)} m/px, tiles ${TILE_X}-${TILE_X + 1}/${TILE_Y}-${TILE_Y + 1}) ` +
      `-> fuji.bin (${(terrain.length / 1024).toFixed(0)} KB); ${labels.length} labels -> labels.json`,
  );
}

await bake();
