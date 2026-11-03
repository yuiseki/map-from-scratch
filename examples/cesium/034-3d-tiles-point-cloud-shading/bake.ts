// Bakes a three-level point-cloud tileset of Marunouchi and Tokyo Station
// from GSJ's mixed Point Cloud PNG tiles (Tokyo Metropolitan Government
// digital twin, ward-area point cloud).
//
//   level 0  2 x 2 GSJ z16 tiles (~1 km square), ~49,000 points each
//   level 1  4 x 4 z17 tiles, level 2  8 x 8 z18 tiles (the leaves)
//
// GSJ already thins each zoom to about 50,000 points a tile, so its pyramid
// is a replace-refinement LOD tree: a child covers a quarter of its parent
// with as many points. Each node keeps its tile's points, projected to
// metres east/north of Tokyo Station (web mercator scaled by cos(latitude),
// true scale here), quantised to uint16 over the node box.
//
// Run with `bin/mfs bake cesium-034-3d-tiles-point-cloud-shading`. The WebP
// tiles are cached under src/ (not published); gdal_translate (in mfs-base)
// turns each into raw pixels.
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePointCloudImage } from './pcpng.ts';
import { encodeNode, surfaceSpacing, type TileNode, type Tileset, type Vec3 } from './format.ts';

const OUT = 'data/baked/cesium-034-3d-tiles-point-cloud-shading';
const SRC = join(OUT, 'src');
const SOURCE = 'https://tiles.gsj.jp/tiles/pcpng/mixed/tiles';
const ORIGIN = { lon: 139.7671, lat: 35.6812 };         // Tokyo Station, Marunouchi building
const ROOT_Z = 16, ROOT_X = 58211, ROOT_Y = 25806, ROOT_N = 2, LEVELS = 3;
// Heights outside this range are noise (birds, multipath); the tallest
// building in the area is about 200 m.
const Z_MIN = -15, Z_MAX = 320;
const ATTRIBUTION = '点群: 東京都デジタルツイン実現プロジェクト 区部点群データ（CC BY 4.0）、産総研 地質調査総合センター 統合点群タイルを加工';

const world = 40075016.68557849 * Math.cos(ORIGIN.lat * Math.PI / 180);
const mx0 = (ORIGIN.lon + 180) / 360;
const my0 = (1 - Math.asinh(Math.tan(ORIGIN.lat * Math.PI / 180)) / Math.PI) / 2;

mkdirSync(join(OUT, 'nodes'), { recursive: true });
mkdirSync(SRC, { recursive: true });

async function fetchTile(z: number, x: number, y: number): Promise<string | null> {
  const file = join(SRC, `${z}-${x}-${y}.webp`);
  if (existsSync(file)) return file;
  const response = await fetch(`${SOURCE}/${z}/${x}/${y}.webp`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${z}/${x}/${y}: HTTP ${response.status}`);
  writeFileSync(file, new Uint8Array(await response.arrayBuffer()));
  return file;
}

function readPixels(webp: string) {
  const dir = mkdtempSync(join(tmpdir(), 'pcpng-'));
  try {
    const raw = join(dir, 'tile.raw');
    const r = spawnSync('gdal_translate', ['-q', '-of', 'ENVI', '-co', 'INTERLEAVE=BIP', webp, raw], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`gdal_translate ${webp}: ${r.stderr}`);
    const hdr = readFileSync(join(dir, 'tile.hdr'), 'utf8');
    const num = (k: string) => Number(hdr.match(new RegExp(`${k}\\s*=\\s*(\\d+)`))![1]);
    return { pixels: new Uint8Array(readFileSync(raw)), width: num('samples'), height: num('lines'), channels: num('bands') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const nodes: TileNode[] = [];
const index = new Map<string, number>();
let dropped = 0, totalPoints = 0, totalBytes = 0;

async function bakeTile(level: number, z: number, x: number, y: number) {
  const webp = await fetchTile(z, x, y);
  if (!webp) { console.log(`${z}/${x}/${y}: 404`); return; }
  const { pixels, width, height, channels } = readPixels(webp);
  const cloud = decodePointCloudImage(pixels, width, height, channels);
  const xyz = new Float32Array(cloud.count * 3), rgb = new Uint8Array(cloud.count * 3);
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (let i = 0; i < cloud.count; i++) {
    const h = cloud.z[i];
    if (!(h >= Z_MIN && h <= Z_MAX)) { dropped++; continue; }
    const p = [(cloud.mx[i] - mx0) * world, (my0 - cloud.my[i]) * world, h];
    for (let a = 0; a < 3; a++) { xyz[n * 3 + a] = p[a]; min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
    rgb.set(cloud.rgb.subarray(i * 3, i * 3 + 3), n * 3);
    n++;
  }
  // Round the box outwards to the centimetre so the JSON stays short.
  for (let a = 0; a < 3; a++) { min[a] = Math.floor(min[a] * 100) / 100; max[a] = Math.ceil(max[a] * 100) / 100; }
  const bytes = encodeNode(xyz.subarray(0, n * 3), rgb.subarray(0, n * 3), min, max);
  const file = `nodes/${z}-${x}-${y}.bin`;
  writeFileSync(join(OUT, file), bytes);
  const leaf = level === LEVELS - 1;
  index.set(`${z}/${x}/${y}`, nodes.length);
  nodes.push({ key: `${z}/${x}/${y}`, level, min, max, count: n, geometricError: leaf ? 0 : Math.round(surfaceSpacing(min, max, n) * 1000) / 1000, children: [], file });
  totalPoints += n; totalBytes += bytes.byteLength;
  console.log(`${z}/${x}/${y}: ${n} points, x ${min[0].toFixed(0)}..${max[0].toFixed(0)} y ${min[1].toFixed(0)}..${max[1].toFixed(0)} z ${min[2].toFixed(1)}..${max[2].toFixed(1)}, ${bytes.byteLength} B`);
}

for (let level = 0; level < LEVELS; level++) {
  const z = ROOT_Z + level, k = 2 ** level;
  const jobs: [number, number][] = [];
  for (let y = ROOT_Y * k; y < (ROOT_Y + ROOT_N) * k; y++) for (let x = ROOT_X * k; x < (ROOT_X + ROOT_N) * k; x++) jobs.push([x, y]);
  // Four downloads at a time; decoding runs in between.
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(jobs.slice(i, i + 4).map(([x, y]) => fetchTile(z, x, y)));
    for (const [x, y] of jobs.slice(i, i + 4)) await bakeTile(level, z, x, y);
  }
}
for (const node of nodes) {
  const [z, x, y] = node.key.split('/').map(Number);
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const child = index.get(`${z + 1}/${x * 2 + dx}/${y * 2 + dy}`);
    if (child !== undefined) node.children.push(child);
  }
  if (node.level < LEVELS - 1 && node.children.length === 0) node.geometricError = 0;
}
const tileset: Tileset = { origin: ORIGIN, roots: nodes.filter((n) => n.level === 0).map((n) => index.get(n.key)!), nodes, attribution: ATTRIBUTION };
writeFileSync(join(OUT, 'tileset.json'), JSON.stringify(tileset));
console.log(`${nodes.length} nodes, ${totalPoints} points, ${totalBytes} B of node files, ${dropped} points outside ${Z_MIN}..${Z_MAX} m dropped`);
