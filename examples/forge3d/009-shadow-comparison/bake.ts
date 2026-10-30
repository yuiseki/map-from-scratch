import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import zlib from 'node:zlib';

// Raster hillshade comparison: the same Mt. Rainier DEM shaded without and
// with cast shadows. Both passes are computed here, so the renderer only
// blits two prepared images; the sun direction never has to be known at run
// time.

const RAW_DIR = 'data/raw/forge3d-009';
const OUT_DIR = 'data/baked/forge3d-009-shadow-comparison';
const RAW_FILE = `${RAW_DIR}/terrarium_10_165_360.png`;
const TILE = { z: 10, x: 165, y: 360 };
const W = 200;
const H = 200;

mkdirSync(RAW_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

async function getPngBuffer(): Promise<Buffer> {
  if (existsSync(RAW_FILE)) return readFileSync(RAW_FILE);
  const res = await fetch(`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${TILE.z}/${TILE.x}/${TILE.y}.png`);
  if (!res.ok) throw new Error(`terrarium tile ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(RAW_FILE, buf);
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

const lonOf = (x: number): number => (x / 2 ** TILE.z) * 360 - 180;
const latOf = (y: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** TILE.z))) * 180) / Math.PI;

async function heights(): Promise<Int16Array> {
  const png = parsePng(await getPngBuffer());
  const out = new Int16Array(W * H);
  const at = (x: number, y: number): number => {
    const i = (y * png.width + x) * 3;
    return png.pixels[i] * 256 + png.pixels[i + 1] + png.pixels[i + 2] / 256 - 32768;
  };
  // Bilinear, not nearest: rounding 256 samples onto 200 skips every fourth
  // or fifth source row and column, and the uneven spacing showed in the
  // slopes as a grid.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = (x / (W - 1)) * (png.width - 1), fy = (y / (H - 1)) * (png.height - 1);
      const x0 = Math.min(png.width - 2, Math.floor(fx)), y0 = Math.min(png.height - 2, Math.floor(fy));
      const tx = fx - x0, ty = fy - y0;
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out[y * W + x] = Math.round(top * (1 - ty) + bot * ty);
    }
  }
  return out;
}

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

// Sun from the north-west at 45 degrees (azimuth 315). North is up in the
// image, so "toward the sun" is -x (west) and -y (north).
const AZ = 315;
const EL = 45;
const sunEast = Math.sin((AZ * Math.PI) / 180) * Math.cos((EL * Math.PI) / 180);
const sunNorth = Math.cos((AZ * Math.PI) / 180) * Math.cos((EL * Math.PI) / 180);
const sunUp = Math.sin((EL * Math.PI) / 180);
const STEP_X = sunEast / Math.hypot(sunEast, sunNorth); // -0.707
const STEP_Y = -sunNorth / Math.hypot(sunEast, sunNorth); // -0.707 (image y grows south)
const TAN_EL = Math.tan((EL * Math.PI) / 180);

async function bake(): Promise<void> {
  const elev = await heights();
  const tileWidthM = (40075016 / 2 ** TILE.z) * Math.cos((46.85 * Math.PI) / 180);
  const cellM = tileWidthM / W;

  let minElev = Infinity, maxElev = -Infinity, peak = 0;
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] < minElev) minElev = elev[i];
    if (elev[i] > maxElev) { maxElev = elev[i]; peak = i; }
  }

  const diffuse = new Uint8Array(W * H * 3);
  const shadow = new Uint8Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const h = elev[i];
      const dzdx = (elev[y * W + Math.min(W - 1, x + 1)] - elev[y * W + Math.max(0, x - 1)]) / (2 * cellM);
      // Normal in (east, north, up): y grows south, so north gradient flips.
      const dzdyN = -(elev[Math.min(H - 1, y + 1) * W + x] - elev[Math.max(0, y - 1) * W + x]) / (2 * cellM);
      const nx = -dzdx, ny = -dzdyN, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const lambert = Math.max(0, (nx * sunEast + ny * sunNorth + nz * sunUp) / len);

      // Cast shadow: march up to 60 cells toward the sun, looking for terrain
      // above the ray. The cell is ~134 m, so the ray rises tan(45) per cell.
      let lit = 1;
      const h0 = h;
      for (let t = 1; t <= 60; t++) {
        const sx = Math.round(x + STEP_X * t);
        const sy = Math.round(y + STEP_Y * t);
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) break;
        if (elev[sy * W + sx] > h0 + t * cellM * TAN_EL) { lit = 0; break; }
      }
      shadow[i] = lit ? 255 : 0;

      const c = tint(h);
      const k = 0.3 + 0.7 * lambert;
      diffuse[i * 3] = Math.min(255, Math.round(c[0] * k));
      diffuse[i * 3 + 1] = Math.min(255, Math.round(c[1] * k));
      diffuse[i * 3 + 2] = Math.min(255, Math.round(c[2] * k));
    }
  }

  const header = Buffer.alloc(38);
  header.write('SHAD', 0, 'ascii');
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(W, 6);
  header.writeUInt16LE(H, 8);
  header.writeFloatLE(Number(lonOf(TILE.x).toFixed(5)), 10);
  header.writeFloatLE(Number(latOf(TILE.y + 1).toFixed(5)), 14);
  header.writeFloatLE(Number(lonOf(TILE.x + 1).toFixed(5)), 18);
  header.writeFloatLE(Number(latOf(TILE.y).toFixed(5)), 22);
  header.writeUInt16LE(Math.round(minElev), 26);
  header.writeUInt16LE(Math.round(maxElev), 28);
  header.writeFloatLE(Number(((peak % W) / (W - 1)).toFixed(4)), 30);
  header.writeFloatLE(Number((Math.floor(peak / W) / (H - 1)).toFixed(4)), 34);

  const out = Buffer.concat([header, Buffer.from(diffuse), Buffer.from(shadow)]);
  writeFileSync(`${OUT_DIR}/relief.bin`, out);

  let shaded = 0;
  for (let i = 0; i < shadow.length; i++) if (shadow[i] === 0) shaded++;
  console.log(`Baked ${W}x${H} relief (${minElev}-${maxElev} m, ${((shaded / shadow.length) * 100).toFixed(1)}% in cast shadow) -> ${OUT_DIR}/relief.bin (${(out.length / 1024).toFixed(0)} KB)`);
}

void bake();
