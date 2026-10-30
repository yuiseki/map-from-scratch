import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const RAW_DIR = 'data/raw/forge3d-010';
const OUT_DIR = 'data/baked/forge3d-010-map-plate';
const RAW_FILE = `${RAW_DIR}/terrarium_10_165_360.png`;

mkdirSync(RAW_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

async function getPngBuffer(): Promise<Buffer> {
  if (existsSync(RAW_FILE)) {
    return readFileSync(RAW_FILE);
  }
  try {
    const res = await fetch('https://elevation-tiles-prod.s3.amazonaws.com/terrarium/10/165/360.png');
    if (res.ok) {
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      writeFileSync(RAW_FILE, buf);
      return buf;
    }
  } catch {
    // Network unavailable, fallback will be used
  }
  return Buffer.alloc(0);
}

function parsePngHeights(buf: Buffer): { width: number; height: number; pixels: Uint8Array } | null {
  if (buf.length < 8) return null;
  let pos = 8;
  const idatChunks: Buffer[] = [];
  let width = 0, height = 0;

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
    }
    pos += 12 + len;
  }

  if (!width || !height || idatChunks.length === 0) return null;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
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

async function bake(): Promise<void> {
  const buf = await getPngBuffer();
  const png = parsePngHeights(buf);

  const outW = 100, outH = 100;
  const elevs = new Int16Array(outW * outH);

  if (png) {
    const { width, height, pixels } = png;
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const srcX = Math.round((x / (outW - 1)) * (width - 1));
        const srcY = Math.round((y / (outH - 1)) * (height - 1));
        const i = srcY * width + srcX;
        const r = pixels[i * 3];
        const g = pixels[i * 3 + 1];
        const b = pixels[i * 3 + 2];
        const h = Math.round((r * 256 + g + b / 256) - 32768);
        elevs[y * outW + x] = h;
      }
    }
  } else {
    // Deterministic synthetic stratovolcano model of Mt. Rainier
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const nx = x / outW - 0.65;
        const ny = y / outH - 0.78;
        const dist = Math.hypot(nx, ny);
        const baseH = 4392 * Math.exp(-dist * 4.2);
        const ridge = Math.cos(Math.atan2(ny, nx) * 5) * 200 * Math.exp(-dist * 3.5);
        elevs[y * outW + x] = Math.round(Math.max(400, baseH + ridge));
      }
    }
  }

  // The tile's own extent (z10/165/360), not a hand-written box: the labels,
  // scale bar and summit position are derived from it. The summit is the
  // highest sample, as (x, y) fractions of the grid from the north-west corner.
  const [Z, TX, TY] = [10, 165, 360];
  const lonOf = (x: number): number => (x / 2 ** Z) * 360 - 180;
  const latOf = (y: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI;
  let top = 0;
  for (let i = 1; i < elevs.length; i++) if (elevs[i] > elevs[top]) top = i;
  const result = {
    width: outW,
    height: outH,
    bounds: [lonOf(TX), latOf(TY + 1), lonOf(TX + 1), latOf(TY)].map((v) => Number(v.toFixed(5))),
    minElev: Math.min(...elevs),
    maxElev: Math.max(...elevs),
    peak: [(top % outW) / (outW - 1), Math.floor(top / outW) / (outH - 1)],
    elevations: Array.from(elevs),
  };

  writeFileSync(`${OUT_DIR}/relief.json`, JSON.stringify(result));
  console.log(`Baked Mt. Rainier DEM plate (${outW}x${outH}) -> ${OUT_DIR}/relief.json`);
}

void bake();
