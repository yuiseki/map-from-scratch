import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const SIZE = 256;
const BACKGROUND: [number, number, number] = [22, 38, 60];
const CELLS: { x: number; y: number; r: number; rgb: [number, number, number] }[] = [
  { x: 64, y: 64, r: 26, rgb: [46, 204, 113] },
  { x: 192, y: 64, r: 24, rgb: [241, 196, 15] },
  { x: 64, y: 192, r: 24, rgb: [230, 126, 34] },
  { x: 192, y: 192, r: 26, rgb: [231, 76, 60] },
];

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let rgb = BACKGROUND;
    for (const cell of CELLS) {
      if (Math.hypot(x - cell.x, y - cell.y) <= cell.r) rgb = cell.rgb;
    }
    const i = (y * SIZE + x) * 4;
    rgba[i] = rgb[0];
    rgba[i + 1] = rgb[1];
    rgba[i + 2] = rgb[2];
    rgba[i + 3] = 255;
  }
}

const dir = 'data/baked/mapbox-011-add-image';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/overlay.png`, encodePng(SIZE, SIZE, rgba));
console.log(`radar overlay ${SIZE}x${SIZE} -> ${dir}/overlay.png`);

const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const polygons: number[][][][] = [];
for (const feature of land.features) {
  const shapes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Ring[]]
    : feature.geometry.coordinates as Ring[][];
  for (const shape of shapes) {
    polygons.push(shape.map((ring) => ring.map(([lon, lat]) => [
      Number(mercX(lon).toFixed(5)),
      Number(mercY(Math.max(-85.051128, Math.min(85.051128, lat))).toFixed(5)),
    ])));
  }
}
writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
console.log(`${polygons.length} land polygons -> ${dir}/land.json`);
