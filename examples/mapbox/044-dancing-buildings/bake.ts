// Bake for mapbox-044-dancing-buildings: PLATEAU 2025 LOD1 buildings of the
// nine 3rd-order meshes around Tokyo Station (Marunouchi, Otemachi, Yaesu,
// Nihonbashi, Ginza, Yurakucho, Kasumigaseki) -> dance.bin (format.ts) and
// truth.json (bench only: the tallest building, read from the GML).
//
//   node examples/mapbox/044-dancing-buildings/bake.ts
//
// The building GML files are those example 16 extracts to
// data/raw/plateau/gml/; when they are missing they are extracted here
// from the same zips with Python's zipfile (ZIP64; the image has no unzip).
import { createReadStream, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lod1Reader, type Lod1Building } from './gml.ts';
import { extrude, footprints, type Footprint } from './mesh.ts';
import { encode, bandOf, ringEdges, BANDS, type Vertex } from './format.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const ID = 'mapbox-044-dancing-buildings';
const OUT = join(root, 'data/baked', ID);
const SHARED_GML = join(root, 'data/raw/plateau/gml');
const OWN_GML = join(root, 'data/raw', ID, 'gml');
const SRC = '/sata_hdd_24tb/hf_data/plateau-citygml-jp/data/raw';
const ZIPS = [
  `${SRC}/13101_chiyoda-ku/2025/13101_chiyoda-ku_pref_2025_citygml_1_op.zip`,
  `${SRC}/13102_chuo-ku/2025/13102_chuo-ku_pref_2025_citygml_1_op.zip`,
];
const MESHES = ['53394600', '53394601', '53394602', '53394610', '53394611', '53394612', '53394620', '53394621', '53394622'];
// Centre: Tokyo Station (Marunouchi building). Bands are rings around it
// holding equal numbers of buildings (format.ts bandOf, ringEdges).
const LAT0 = 35.6812, LON0 = 139.7671;

mkdirSync(OUT, { recursive: true });

function gmlPath(mesh: string): string {
  const shared = join(SHARED_GML, `${mesh}.gml`);
  if (existsSync(shared)) return shared;
  const own = join(OWN_GML, `${mesh}.gml`);
  if (existsSync(own)) return own;
  mkdirSync(OWN_GML, { recursive: true });
  const py = `import sys, zipfile, shutil
name = 'udx/bldg/' + sys.argv[1] + '_bldg_6697_op.gml'
for z in sys.argv[3:]:
    with zipfile.ZipFile(z) as f:
        if name in f.namelist():
            with f.open(name) as src, open(sys.argv[2] + '.part', 'wb') as dst: shutil.copyfileobj(src, dst, 1 << 20)
            sys.exit(0)
sys.exit('not in any zip: ' + name)`;
  execFileSync('python3', ['-I', '-c', py, mesh, own, ...ZIPS], { stdio: 'inherit' });
  execFileSync('mv', [own + '.part', own]);
  return own;
}

interface Kept { b: Lod1Building; f: Footprint; mesh: string }
const kept: Kept[] = [];
let read = 0, noFootprint = 0;
const heightDiff: number[] = [];
for (const mesh of MESHES) {
  const path = gmlPath(mesh);
  const reader = new Lod1Reader((b) => {
    read++;
    const f = footprints(b.lod1, LAT0, LON0);
    if (!f.rings.length || !(f.height > 0)) { noFootprint++; return; }
    if (b.measuredHeight !== null && b.measuredHeight > 0) heightDiff.push(Math.abs(f.height - b.measuredHeight));
    kept.push({ b, f, mesh });
  });
  const dec = new TextDecoder();
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) reader.push(dec.decode(chunk, { stream: true }));
  reader.push(dec.decode());
  reader.end();
  console.log(`${mesh}: ${(statSync(path).size / 1e6).toFixed(0)} MB, ${kept.length} buildings so far`);
}

// Nearest first: a ring's buildings are contiguous in the buffer.
kept.sort((p, q) => Math.hypot(p.f.cx, p.f.cy) - Math.hypot(q.f.cx, q.f.cy));
const edges = ringEdges(kept.map((k) => Math.hypot(k.f.cx, k.f.cy)));
const verts: Vertex[] = [], indices: number[] = [];
for (const k of kept) extrude(k.f, edges, verts, indices);
const bin = encode({ edges, buildings: kept.length, verts, indices });
writeFileSync(join(OUT, 'dance.bin'), new Uint8Array(bin));

// The tallest building, for the bench's height checks: its outer ring and
// height in the units the page draws in.
const tallest = kept.reduce((a, k) => (k.f.height > a.f.height ? k : a));
const outer = tallest.f.rings.reduce((a, p) => (p[0].length > a.length ? p[0] : a), [] as number[]);
const perBand = new Array(BANDS).fill(0);
for (const k of kept) perBand[bandOf(k.f.cx, k.f.cy, edges)]++;
heightDiff.sort((a, b) => a - b);
const truth = {
  centre: { lat: LAT0, lon: LON0, name: 'Tokyo Station' },
  edges: edges.map((e) => Math.round(e)),
  buildings: kept.length,
  vertices: verts.length,
  triangles: indices.length / 3,
  perBand,
  tallest: {
    id: tallest.b.id, name: tallest.b.name, mesh: tallest.mesh,
    measuredHeight: tallest.b.measuredHeight, height: Math.round(tallest.f.height * 10) / 10,
    cx: Math.round(tallest.f.cx * 10) / 10, cy: Math.round(tallest.f.cy * 10) / 10,
    band: bandOf(tallest.f.cx, tallest.f.cy, edges),
    ring: outer.map((v) => Math.round(v * 10) / 10),
  },
};
writeFileSync(join(OUT, 'truth.json'), JSON.stringify(truth, null, 1) + '\n');
const pct = (p: number) => heightDiff[Math.min(heightDiff.length - 1, Math.floor(p * heightDiff.length))].toFixed(2);
console.log(`read ${read} buildings, ${noFootprint} without a footprint, kept ${kept.length}`);
console.log(`lod1 height vs measuredHeight |diff| p50 ${pct(0.5)} m, p99 ${pct(0.99)} m, max ${pct(1)} m`);
console.log(`${verts.length} vertices, ${indices.length / 3} triangles -> dance.bin ${(bin.byteLength / 1e6).toFixed(2)} MB`);
console.log(`per band ${perBand.join(' ')}`);
console.log(`tallest ${tallest.b.id} ${tallest.b.name ?? ''} ${tallest.f.height.toFixed(1)} m (measured ${tallest.b.measuredHeight}) at ${tallest.f.cx.toFixed(0)}, ${tallest.f.cy.toFixed(0)} band ${truth.tallest.band}`);
