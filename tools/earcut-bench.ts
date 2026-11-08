// Compare kits/earcut with mapbox/earcut: same output, and time.
//
//   node tools/earcut-bench.ts [upstream.js ...]
//
// Default reference: ref-repos/mapbox__earcut/src/earcut.js (ref-repos/clone.sh earcut).
// Inputs are upstream's benchmark set (bench/tiles-fixture.bin, 119,680 MVT
// polygons, split by size) and its test fixtures. Every input must give the
// same index array as the first reference, or the run exits 1 before timing;
// later references (an older release, say) only report how many differ.
//
// Timing alternates implementations round by round and reports the median
// round, so load on a shared machine falls on both alike.
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import earcut, { flatten, largePool, type Flat } from '../kits/earcut/earcut.ts';
import { readTilesFixture } from './earcut-tiles.ts';

type Earcut = (data: ArrayLike<number>, holes?: ArrayLike<number> | null, dim?: number) => number[];
const root = new URL('../', import.meta.url);
const refs = process.argv.slice(2);
if (!refs.length) refs.push(new URL('ref-repos/mapbox__earcut/src/earcut.js', root).pathname);
const others: [string, Earcut][] = [];
for (const r of refs) others.push([r.replace(/.*ref-repos\//, '').replace(/.*map-from-scratch\//, ''), (await import(pathToFileURL(r).href)).default as Earcut]);
const impls: [string, Earcut][] = [['kits/earcut', earcut], ...others];

const tiles = readTilesFixture();
// Stars of 20,000 to 60,000 vertices, half of them reflex: past the first
// node pool, so kits/earcut cuts them in a second pool compiled from source.
const stars: (Flat & { id: string })[] = [20000, 40000, 60000].map((n) => {
  const vertices: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = i % 2 ? 1 : 0.6 + 0.3 * Math.sin(i / 97);
    vertices.push(r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n));
  }
  return { id: `star-${n}`, vertices, holes: [], dimensions: 2 };
});
const fixDir = new URL('kits/earcut/fixtures/', root);
const fixtures = readdirSync(fixDir).filter((f) => f !== 'expected.json' && f.endsWith('.json'))
  .map((f) => ({ id: f.slice(0, -5), ...flatten(JSON.parse(readFileSync(new URL(f, fixDir), 'utf8'))) }));

// identical output on every input
for (const [k, [name, other]] of others.entries()) {
  let differ = 0;
  for (const d of [...tiles, ...fixtures, ...stars]) {
    const a = earcut(d.vertices, d.holes, d.dimensions), b = other(d.vertices, d.holes, d.dimensions);
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      if (differ++ < 5) console.log(`differs from ${name}: ${'id' in d ? d.id : `tile polygon of ${d.vertices.length / 2} vertices`}`);
    }
  }
  console.log(`same output as ${name}: ${differ ? `NO (${differ} inputs differ)` : `yes, ${tiles.length + fixtures.length + stars.length} inputs`}`);
  if (differ && k === 0) process.exit(1);
}

// The stars above made the second pool before any timing, so the first
// pool is timed as it runs once a second one exists.
const pool = largePool();
console.log(`second pool: ${pool ? `${pool.cap} nodes, ${pool.compiled ? 'compiled from source' : 'build() (eval refused)'}` : 'none'}`);
const verts = (d: Flat) => d.vertices.length / d.dimensions;
const big = fixtures.filter((d) => /^water-huge/.test(d.id));
const sets: [string, Flat[]][] = [
  ['MVT, all 119,680', tiles],
  ['MVT, 3-4 vertices', tiles.filter((d) => verts(d) <= 4)],
  ['MVT, <= 80 vertices (no z-hash)', tiles.filter((d) => verts(d) <= 80)],
  ['MVT, > 80 vertices (z-hash)', tiles.filter((d) => verts(d) > 80)],
  ['MVT, with holes', tiles.filter((d) => d.holes.length > 0)],
  ['water-huge 1-3 (fixtures)', big],
  ['all 61 fixtures', fixtures],
  ['stars 20k-60k (second pool)', stars],
];

function run(f: Earcut, set: Flat[]): number {
  let n = 0;
  for (const d of set) n += f(d.vertices, d.holes, d.dimensions).length;
  return n;
}
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
const ROUNDS = Number(process.env.ROUNDS ?? 25);

for (const [, f] of impls) for (let i = 0; i < 3; i++) run(f, tiles); // warm up
// The median is the typical round; the minimum is the round least disturbed
// by other work on the machine. Both are reported, as ratios to kits/earcut.
console.log(`\nms of ${ROUNDS} alternating rounds, median (min) (node ${process.version})`);
console.log(`${'set'.padEnd(34)}${impls.map(([n]) => n.slice(0, 22).padStart(24)).join('')}   ratio median (min)`);
for (const [label, set] of sets) {
  const t = impls.map(() => [] as number[]);
  for (let r = 0; r < ROUNDS; r++) {
    for (let k = 0; k < impls.length; k++) {
      const j = (k + r) % impls.length; // rotate who goes first
      const s = performance.now();
      run(impls[j][1], set);
      t[j].push(performance.now() - s);
    }
  }
  const m = t.map(median), lo = t.map((a) => Math.min(...a));
  console.log(`${label.padEnd(34)}${m.map((v, j) => `${v.toFixed(1)} (${lo[j].toFixed(1)})`.padStart(24)).join('')}   ${m.slice(1).map((v, j) => `${(v / m[0]).toFixed(2)}x (${(lo[j + 1] / lo[0]).toFixed(2)}x)`).join(' ')}`);
}
console.log('\nratio = reference time / kits/earcut time; above 1 means kits/earcut is faster');
