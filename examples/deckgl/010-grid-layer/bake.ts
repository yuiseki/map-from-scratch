import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

const id = 'deckgl-010-grid-layer';
const dir = `data/baked/${id}`;
mkdirSync(dir, { recursive: true });
const lines = readFileSync(source('deckgl-paris-trees'), 'utf8').trim().split(/\r?\n/);
if (lines[0] !== 'LIBELLEFRANCAIS;CIRCONFERENCE(CM);LATITUDE;LONGITUDE') throw new Error('unexpected CSV header');
const R = 6378137, lon0 = 2.345, lat0 = 48.857;
const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const y0 = mercY(lat0), localScale = Math.cos(lat0 * Math.PI / 180);
type Tree = { x: number; y: number; circumference: number; species: number };
const trees: Tree[] = [];
const species: string[] = [];
const speciesId = new Map<string, number>();
for (const line of lines.slice(1)) {
  const [name, circumferenceText, latText, lonText] = line.split(';');
  const lat = Number(latText), lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 48 || lat > 49.5 || lon < 1.5 || lon > 3.5) continue;
  const x = (lon - lon0) * Math.PI / 180 * R * localScale;
  const y = (mercY(lat) - y0) * localScale;
  let index = speciesId.get(name);
  if (index === undefined) { index = species.length; speciesId.set(name, index); species.push(name); }
  const circumference = Math.max(0, Math.min(65535, Math.round(Number(circumferenceText) || 0)));
  trees.push({ x, y, circumference, species: index });
}
if (species.length > 65535) throw new Error('too many species');
const raw = Buffer.allocUnsafe(8 + trees.length * 10);
raw.write('TR02', 0, 'ascii'); raw.writeUInt32LE(trees.length, 4);
const write24 = (at: number, value: number) => {
  if (value < -8388608 || value > 8388607) throw new Error('tree coordinate exceeds int24');
  raw[at] = value & 255; raw[at + 1] = (value >> 8) & 255; raw[at + 2] = (value >> 16) & 255;
};
trees.forEach((tree, i) => {
  const p = 8 + i * 10;
  write24(p, Math.round(tree.x * 20)); write24(p + 3, Math.round(tree.y * 20));
  raw.writeUInt16LE(tree.circumference, p + 6); raw.writeUInt16LE(tree.species, p + 8);
});
writeFileSync(`${dir}/trees.bin`, raw);
writeFileSync(`${dir}/species.json`, JSON.stringify(species));
const SIZES = [2048, 1024, 512, 256, 128, 64, 32, 16];
for (const size of SIZES) {
  const bins = new Map<string, { ix: number; iy: number; count: number }>();
  for (const tree of trees) {
    const ix = Math.floor(tree.x / size), iy = Math.floor(tree.y / size);
    const key = `${ix},${iy}`;
    const bin = bins.get(key);
    if (bin) bin.count++; else bins.set(key, { ix, iy, count: 1 });
  }
  const cells = [...bins.values()];
  const sorted = cells.map((c) => c.count).sort((a, b) => a - b);
  const cuts = [1, 2, 3, 4, 5].map((q) => sorted[Math.floor(q * (sorted.length - 1) / 6)]);
  const out = Buffer.allocUnsafe(12 + cells.length * 8);
  out.write('GC01', 0, 'ascii'); out.writeUInt32LE(cells.length, 4); out.writeUInt32LE(size, 8);
  cells.forEach((cell, i) => {
    const p = 12 + i * 8;
    if (cell.ix < -32768 || cell.ix > 32767 || cell.iy < -32768 || cell.iy > 32767) throw new Error('grid index exceeds int16');
    out.writeInt16LE(cell.ix, p);
    out.writeInt16LE(cell.iy, p + 2);
    out.writeUInt16LE(Math.min(65535, cell.count), p + 4);
    out[p + 6] = cuts.filter((cut) => cell.count > cut).length;
    out[p + 7] = 0;
  });
  writeFileSync(`${dir}/grid-${size}.bin`, out);
  console.log(`${size} m: ${cells.length} occupied cells`);
}
console.log(`${trees.length} trees, ${species.length} species`);
