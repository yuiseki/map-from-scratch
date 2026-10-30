import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import zlib from 'node:zlib';

// forge3d's headline example: an orbit camera over the Mt. Rainier DEM with a
// fixed sun. The renderer only needs two textures, so everything expensive is
// done here: four terrarium tiles are stitched, cropped around the summit and
// turned into (a) a 16-bit height grid the vertex shader displaces with and
// (b) a hillshaded colour grid the fragment shader samples.

const RAW_DIR = 'data/raw/forge3d-001';
const OUT_DIR = 'data/baked/forge3d-001-mount-rainier';
const TILE_Z = 11;
const TILE_X = 330; // 2x2 mosaic covering the summit at 53 m/px
const TILE_Y = 721;
const MOSAIC = 512;
const OUT = 384; // cropped around the summit
const SUN_AZ = 302;
const SUN_EL = 24;

mkdirSync(RAW_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

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
  const bpp = 3;
  const stride = 1 + width * bpp;
  const pixels = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const rowStart = y * stride + 1;
    const prevRowStart = (y - 1) * width * bpp;
    const curRowStart = y * width * bpp;
    for (let x = 0; x < width * bpp; x++) {
      const val = raw[rowStart + x];
      const left = x >= bpp ? pixels[curRowStart + x - bpp] : 0;
      const up = y > 0 ? pixels[prevRowStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[prevRowStart + x - bpp] : 0;

      let res = 0;
      if (filter === 0) res = val;
      else if (filter === 1) res = (val + left) & 0xff;
      else if (filter === 2) res = (val + up) & 0xff;
      else if (filter === 3) res = (val + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        res = (val + pr) & 0xff;
      }
      pixels[curRowStart + x] = res;
    }
  }
  return { width, height, pixels };
}

const lonOf = (x: number): number => (x / 2 ** TILE_Z) * 360 - 180;
const latOf = (y: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** TILE_Z))) * 180) / Math.PI;

// Hypsometric tint, 400 m (forest) to 4392 m (summit snow).
const RAMP: [number, [number, number, number]][] = [
  [400, [63, 107, 58]],
  [900, [104, 128, 70]],
  [1500, [143, 134, 92]],
  [2200, [156, 143, 126]],
  [3000, [186, 178, 170]],
  [3600, [240, 244, 248]],
  [4392, [255, 255, 255]],
];
function tint(h: number): [number, number, number] {
  if (h <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    if (h <= RAMP[i][0]) {
      const [h0, c0] = RAMP[i - 1];
      const [h1, c1] = RAMP[i];
      const t = (h - h0) / (h1 - h0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

async function bake(): Promise<void> {
  const elev = new Int16Array(MOSAIC * MOSAIC);
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const png = parsePng(await getTile(TILE_X + tx, TILE_Y + ty));
      if (png.width !== 256 || png.height !== 256) throw new Error(`unexpected tile size ${png.width}x${png.height}`);
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const i = (y * png.width + x) * 3;
          const h = Math.round(png.pixels[i] * 256 + png.pixels[i + 1] + png.pixels[i + 2] / 256 - 32768);
          elev[(ty * 256 + y) * MOSAIC + tx * 256 + x] = h;
        }
      }
    }
  }

  let peak = 0;
  for (let i = 1; i < elev.length; i++) if (elev[i] > elev[peak]) peak = i;
  const peakX = peak % MOSAIC, peakY = Math.floor(peak / MOSAIC);
  // Crop around the summit, clamped to the mosaic.
  const x0 = Math.max(0, Math.min(MOSAIC - OUT, peakX - OUT / 2));
  const y0 = Math.max(0, Math.min(MOSAIC - OUT, peakY - OUT / 2));

  // One Mercator texel is square; take the east-west size at the summit's
  // latitude (the mosaic spans 0.09 degrees of latitude, so the error is small).
  const latC = latOf(TILE_Y + (y0 + OUT / 2) / 256);
  const cellM = ((40075016 / 2 ** TILE_Z) * Math.cos((latC * Math.PI) / 180)) / 256;

  const heights = new Uint16Array(OUT * OUT);
  const colours = new Uint8Array(OUT * OUT * 3);
  let minElev = Infinity, maxElev = -Infinity;

  const az = (SUN_AZ * Math.PI) / 180, el = (SUN_EL * Math.PI) / 180;
  const sunEast = Math.sin(az) * Math.cos(el);
  const sunNorth = Math.cos(az) * Math.cos(el);
  const sunUp = Math.sin(el);

  for (let y = 0; y < OUT; y++) {
    for (let x = 0; x < OUT; x++) {
      const mx = x0 + x, my = y0 + y;
      const h = elev[my * MOSAIC + mx];
      heights[y * OUT + x] = h;
      if (h < minElev) minElev = h;
      if (h > maxElev) maxElev = h;

      const hw = elev[my * MOSAIC + Math.max(0, mx - 1)];
      const he = elev[my * MOSAIC + Math.min(MOSAIC - 1, mx + 1)];
      const hn = elev[Math.max(0, my - 1) * MOSAIC + mx];
      const hs = elev[Math.min(MOSAIC - 1, my + 1) * MOSAIC + mx];
      const nx = -(he - hw) / (2 * cellM);
      const ny = (hs - hn) / (2 * cellM); // image y grows south, so north is -y
      const len = Math.hypot(nx, ny, 1);
      const lambert = Math.max(0, (nx * sunEast + ny * sunNorth + sunUp) / len);
      const k = 0.3 + 0.7 * lambert;
      const c = tint(h);
      colours[(y * OUT + x) * 3] = Math.min(255, Math.round(c[0] * k));
      colours[(y * OUT + x) * 3 + 1] = Math.min(255, Math.round(c[1] * k));
      colours[(y * OUT + x) * 3 + 2] = Math.min(255, Math.round(c[2] * k));
    }
  }

  // Bounds of the crop: fractional tile coordinates of its edges.
  const fx = (mx: number): number => lonOf(TILE_X + mx / 256);
  const fy = (my: number): number => latOf(TILE_Y + my / 256);
  const bounds = [fx(x0), fy(y0 + OUT), fx(x0 + OUT), fy(y0)].map((v) => Number(v.toFixed(5)));

  const header = Buffer.alloc(42);
  header.write('RAIN', 0, 'ascii');
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(OUT, 6);
  header.writeUInt16LE(OUT, 8);
  header.writeFloatLE(bounds[0], 10);
  header.writeFloatLE(bounds[1], 14);
  header.writeFloatLE(bounds[2], 18);
  header.writeFloatLE(bounds[3], 22);
  header.writeUInt16LE(minElev, 26);
  header.writeUInt16LE(maxElev, 28);
  header.writeFloatLE(Number(((peakX - x0 + 0.5) / OUT).toFixed(5)), 30);
  header.writeFloatLE(Number(((peakY - y0 + 0.5) / OUT).toFixed(5)), 34);
  header.writeFloatLE(Number(cellM.toFixed(3)), 38);

  const out = Buffer.concat([header, Buffer.from(heights.buffer, heights.byteOffset, heights.byteLength), Buffer.from(colours)]);
  writeFileSync(`${OUT_DIR}/rainier.bin`, out);
  console.log(
    `Baked ${OUT}x${OUT} Rainier terrain (${minElev}-${maxElev} m, ${cellM.toFixed(1)} m/px, summit at ` +
      `u=${((peakX - x0 + 0.5) / OUT).toFixed(3)} v=${((peakY - y0 + 0.5) / OUT).toFixed(3)}) -> ` +
      `${OUT_DIR}/rainier.bin (${(out.length / 1024).toFixed(0)} KB)`,
  );
}

void bake();
