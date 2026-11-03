// Bake Natural Earth populated places (7,342) for a laptop hover map:
//   land.bin    land rings, Equal Earth, 16-bit, delta-coded, no triangles:
//               u32 nVerts, u32 nRings, u16 dx[nVerts], u16 dy[nVerts],
//               u32 ringLen[nRings]. The renderer fills them with a stencil
//               (even-odd), so neither indices nor holes need shipping.
//   borders.bin country border lines, same projection and quantization:
//               u32 nVerts, u32 nLines, u16 dx[nVerts], u16 dy[nVerts],
//               u16 lineLen[nLines]. Natural Earth's land boundaries only:
//               no coastline, which the land/sea colours already show, and
//               no duplicate of a shared border.
//   cities.bin  u32 n, u16 dx[n], u16 dy[n], u8 radius*10[n], u8 country[n],
//               u32 pop[n]       (records in draw order, planar)
//   names.bin   UTF-16LE text: country names, a blank line, city names, one
//               per line, cities in the same order as cities.bin
// Positions are differences from the previous value, mod 2^16.
// Draw order: bigger symbols first, so a small city is never hidden under a
// big one. Within one radius class order does not show, so cities are sorted
// there by Morton code: neighbours become neighbours in the file and the
// position deltas shrink for gzip.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { source } from '../../tools/sources.ts';
import { equalEarth, simplify, polygonsOf } from '../../tools/geo.ts';
import { morton, POP_MAX, radius10, R_MAX, R_MIN } from './city-encoding.ts';

// The fields of the Natural Earth files this bake reads.
interface LandCollection { features: { geometry: Parameters<typeof polygonsOf>[0] }[] }
interface LineCollection { features: { geometry: { type: string; coordinates: unknown } | null }[] }
interface CountryCollection { features: { properties: { ADM0_A3: string; NAME_JA: string | null } }[] }
interface PlaceCollection {
  features: {
    properties: { ADM0_A3: string; ADM0NAME: string; POP_MAX: number; NAME: string; NAME_JA: string | null };
    geometry: { coordinates: [number, number] };
  }[];
}

const OUT = 'data/baked/07-world-cities-hover';
const X = 2.7066, Y = 1.3174;
// Land is a backdrop: 1.5 px at 4x zoom on a 1280 px wide window (DPR 1).
// Deeper zooms show coarser coasts; the cities stay exact.
const LAND_TOL = (2 * X) / (1280 * 4) * 1.5;
// Borders are a backdrop, so they can be a little coarser than the coast:
// 2 CSS px at 4x instead of 1.5. The 150 KB page budget needs it.
const BORDER_TOL = LAND_TOL * 1.3;
const q = ([x, y]: number[]): [number, number] => [Math.round(((x + X) / (2 * X)) * 65535), Math.round(((Y - y) / (2 * Y)) * 65535)];
const delta16 = (a: number[]): number[] => a.map((v, i) => (v - (i ? a[i - 1] : 0)) & 0xffff);
const gz = (b: Uint8Array): number => gzipSync(b, { level: 9 }).length;
const bytes = (...arrays: ArrayBufferView[]): Buffer => Buffer.concat(arrays.map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)));

// --- land
// Countries dissolved into land first: shared borders would otherwise be
// shipped twice (62 KB -> 43 KB gzip at this tolerance).
mkdirSync(OUT, { recursive: true });
const landSrc = `${OUT}/land.geojson`;
if (!existsSync(landSrc)) {
  execFileSync('ogr2ogr', ['-f', 'GeoJSON', landSrc, source('ne-countries'), '-dialect', 'sqlite', '-sql',
    'SELECT ST_Union(ST_MakeValid(geometry)) AS geometry FROM ne_10m_admin_0_countries'], { stdio: 'inherit' });
}
const lx: number[] = [], ly: number[] = [], lens: number[] = [];
for (const f of (JSON.parse(readFileSync(landSrc, 'utf8')) as LandCollection).features) {
  for (const poly of polygonsOf(f.geometry)) {
    for (const r of poly) {
      let g = simplify(r.map(equalEarth), LAND_TOL).map(q);
      g = g.filter((p, i) => i === 0 || p[0] !== g[i - 1][0] || p[1] !== g[i - 1][1]);
      if (g.length < 4) continue;
      g.pop(); // closing point
      lens.push(g.length);
      for (const [x, y] of g) { lx.push(x); ly.push(y); }
    }
  }
}
if (lx.length > 65536) throw new Error(`${lx.length} land vertices do not fit 16-bit indices`);
const land = bytes(Uint32Array.of(lx.length, lens.length), Uint16Array.from(delta16(lx)), Uint16Array.from(delta16(ly)),
  ...(lx.length % 2 ? [new Uint16Array(1)] : []), Uint32Array.from(lens));

// --- borders
// Natural Earth's land boundaries carry each shared border once and leave
// out the coast, which the land/sea colours already show.
const linesOf = (g: LineCollection['features'][number]['geometry']): [number, number][][] => {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates as [number, number][]];
  if (g.type === 'MultiLineString') return g.coordinates as [number, number][][];
  return [];
};
// Natural Earth splits the network at every junction: ~7,900 lines of 2.3
// vertices on average. Simplifying those pieces removes nothing, so join
// them through shared endpoints first. Junctions with more than two lines
// just continue into one of them; the drawing is lines, not rings.
const key = ([x, y]: number[]): string => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
const raw = (JSON.parse(readFileSync(source('ne-boundary-lines'), 'utf8')) as LineCollection).features
  .flatMap((f) => linesOf(f.geometry)).filter((l) => l.length >= 2);
const ends = new Map<string, number[]>();
for (const [i, line] of raw.entries()) for (const p of [line[0], line[line.length - 1]]) {
  const k = key(p);
  if (!ends.has(k)) ends.set(k, []);
  ends.get(k)!.push(i);
}
const used = new Uint8Array(raw.length);
const chains: [number, number][][] = [];
for (let i = 0; i < raw.length; i++) {
  if (used[i]) continue;
  used[i] = 1;
  let chain = raw[i].slice();
  for (const dir of [1, -1] as const) {
    for (;;) {
      const at = dir === 1 ? chain[chain.length - 1] : chain[0];
      const next = ends.get(key(at))!.find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      const line = key(raw[next][0]) === key(at) ? raw[next] : raw[next].slice().reverse();
      chain = dir === 1 ? chain.concat(line.slice(1)) : line.slice(0, -1).concat(chain);
    }
  }
  chains.push(chain);
}
const qchains = chains.map((chain) => simplify(chain.map(equalEarth), BORDER_TOL).map(q)
  .filter((p, i, g) => i === 0 || p[0] !== g[i - 1][0] || p[1] !== g[i - 1][1]))
  .filter((g) => g.length >= 2);
// Order chains by walking to the nearest unused end. The file then moves
// over the map, so the delta from one chain to the next is small and gzip
// has less noise to store.
const ordered: [number, number][][] = [];
let cur = qchains.shift();
if (cur) ordered.push(cur);
while (cur && qchains.length) {
  const last = cur[cur.length - 1];
  let best = 0, bestD = Infinity, flip = false;
  for (const [i, g] of qchains.entries()) {
    const da = (g[0][0] - last[0]) ** 2 + (g[0][1] - last[1]) ** 2;
    const db = (g[g.length - 1][0] - last[0]) ** 2 + (g[g.length - 1][1] - last[1]) ** 2;
    if (da < bestD) { bestD = da; best = i; flip = false; }
    if (db < bestD) { bestD = db; best = i; flip = true; }
  }
  cur = qchains.splice(best, 1)[0];
  if (flip) cur.reverse();
  ordered.push(cur);
}
const bx: number[] = [], by: number[] = [], blens: number[] = [];
for (const g of ordered) {
  blens.push(g.length);
  for (const [x, y] of g) { bx.push(x); by.push(y); }
}
console.log(`borders: ${raw.length} pieces joined into ${chains.length} chains, simplified to ${blens.length}`);
if (Math.max(...blens) > 65535) throw new Error('a border chain does not fit a 16-bit length');
const borders = bytes(Uint32Array.of(bx.length, blens.length), Uint16Array.from(delta16(bx)), Uint16Array.from(delta16(by)),
  Uint16Array.from(blens));

// --- cities
const countries = (JSON.parse(readFileSync(source('ne-countries'), 'utf8')) as CountryCollection).features;
const jaCountry = new Map<string, string | null>(countries.map((f) => [f.properties.ADM0_A3, f.properties.NAME_JA]));
// Codes the admin-0 layer does not have.
Object.entries({ SSD: '南スーダン', SJM: 'スヴァールバル諸島およびヤンマイエン島', TKL: 'トケラウ' })
  .forEach(([k, v]) => jaCountry.set(k, v));
const places = (JSON.parse(readFileSync(source('ne-populated-places'), 'utf8')) as PlaceCollection).features;
const cnames: string[] = [], cindex = new Map<string, number>();
const cities = places.map((f) => {
  const p = f.properties;
  const country = jaCountry.get(p.ADM0_A3) ?? p.ADM0NAME;
  if (!cindex.has(country)) { cindex.set(country, cnames.length); cnames.push(country); }
  const [x, y] = q(equalEarth(f.geometry.coordinates));
  return { x, y, m: morton(x, y), r: radius10(p.POP_MAX), c: cindex.get(country)!, pop: Math.max(0, p.POP_MAX), name: p.NAME_JA || p.NAME };
});
if (cnames.length > 256) throw new Error(`${cnames.length} countries do not fit a byte`);
cities.sort((a, b) => b.r - a.r || (a.m < b.m ? -1 : a.m > b.m ? 1 : 0));

const n = cities.length;
type City = (typeof cities)[number];
const col = <K extends keyof City>(k: K): City[K][] => cities.map((c) => c[k]);
const cityBin = bytes(Uint32Array.of(n), Uint16Array.from(delta16(col('x'))), Uint16Array.from(delta16(col('y'))),
  Uint8Array.from(col('r')), Uint8Array.from(col('c')), ...(n % 2 ? [new Uint16Array(1)] : []), Uint32Array.from(col('pop')));
const text = `${cnames.join('\n')}\n\n${col('name').join('\n')}`;
if (/\n\n/.test(col('name').join('\n')) || cnames.some((c) => !c)) throw new Error('empty name would break the format');
const names = Buffer.from(text, 'utf16le');

writeFileSync(`${OUT}/land.bin`, land);
writeFileSync(`${OUT}/borders.bin`, borders);
writeFileSync(`${OUT}/cities.bin`, cityBin);
writeFileSync(`${OUT}/names.bin`, names);

// Counts to look at: bounding box, radius classes, sizes.
const xs = col('x'), ys = col('y');
console.log(`land: ${lx.length} vertices, ${lens.length} rings, ${land.length} B, gzip ${gz(land)} B`);
console.log(`borders: ${bx.length} vertices, ${blens.length} lines, ${borders.length} B, gzip ${gz(borders)} B`);
console.log(`cities: ${n}, ${cnames.length} countries, x ${Math.min(...xs)}..${Math.max(...xs)}, y ${Math.min(...ys)}..${Math.max(...ys)}, ` +
  `radius classes ${new Set(col('r')).size}, at minimum ${cities.filter((c) => c.r === R_MIN * 10).length}`);
console.log(`cities.bin ${cityBin.length} B, gzip ${gz(cityBin)} B; names.bin ${names.length} B, gzip ${gz(names)} B`);
console.log(`data gzip total ${gz(land) + gz(borders) + gz(cityBin) + gz(names)} B`);
