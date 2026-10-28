// Bake the basemap of the "add a canvas source" map: the countries of the
// MapLibre demo style (demotiles), drawn from Natural Earth 10m instead of
// the demotiles vector tiles.
//
//   basemap.json  {g: grid, c: [fill colours], f: [[colour, name, lx, ly, x0, y0, x1, y1, d], ...]}
//     - Web Mercator, unit square scaled to a grid of g units (2^16).
//     - d is one SVG path string per country (absolute first point of a
//       ring, then relative integer steps), parsed by the browser's Path2D.
//     - x0..y1 is the country's bounding box on the grid, for culling.
//     - lx, ly is Natural Earth's label point (LABEL_X/LABEL_Y), name NAME.
//     - Countries are in label priority order (LABELRANK, then size), so
//       the renderer places labels greedily in file order.
//   The fill colours are the demotiles style's "countries-fill" match on
//   ADM0_A3 (the colour groups below), so the map looks like the original.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mercator, simplify, polygonsOf } from '../../tools/geo.ts';

interface Country {
  properties: { ADM0_A3: string; NAME: string; LABEL_X: number; LABEL_Y: number; LABELRANK: number };
  geometry: Parameters<typeof polygonsOf>[0];
}

const OUT = 'data/baked/26-ml-add-a-canvas-source';
const RAW = 'data/raw/26-ml-add-a-canvas-source';
const SHP = '/sata_hdd_24tb/hf_data/__published/ne-admin0-10m/v5.1.1/shapefile/ne_10m_admin_0_countries.shp';
const REMOTE = '/vsizip//vsicurl/https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip';
const G = 65536;
// Grid units. The original opens at zoom 5, where one grid unit is 0.25 CSS
// px: TOL 4 is 1 px there (2 px at zoom 6), about the detail of the demo
// tiles. Rings smaller than MIN_AREA units² (1 px² at zoom 5) are dropped.
// Measured (gzip): TOL 1 523 KB, 2 411 KB, 4 300 KB, 8 201 KB; most of it is
// Arctic and Antarctic coast, which Mercator enlarges.
const TOL = Number(process.env.TOL ?? 4);
const MIN_AREA = Number(process.env.MIN_AREA ?? 16);

// demotiles style.json, layer countries-fill: fill-color match on ADM0_A3.
const GROUPS: [string, string][] = [
  ['#D6C7FF', 'ARM ATG AUS BTN CAN COG CZE GHA GIN HTI ISL JOR KHM KOR LVA MLT MNE MOZ PER SAH SGP SLV SOM TJK TUV UKR WSM'],
  ['#EBCA8A', 'AZE BGD CHL CMR CSI DEU DJI GUY HUN IOA JAM LBN LBY LSO MDG MKD MNG MRT NIU NZL PCN PYF SAU SHN STP TTO UGA UZB ZMB'],
  ['#C1E599', 'AGO ASM ATF BDI BFA BGR BLZ BRA CHN CRI ESP HKG HRV IDN IRN ISR KNA LBR LCA MAC MUS NOR PLW POL PRI SDN TUN UMI USA USG VIR VUT'],
  ['#E7E58F', 'ARE ARG BHS CIV CLP DMA ETH GAB GRD HMD IND IOT IRL IRQ ITA KOS LUX MEX NAM NER PHL PRT RUS SEN SUR TZA VAT'],
  ['#98DDA1', 'AUT BEL BHR BMU BRB CYN DZA EST FLK GMB GUM HND JEY KGZ LIE MAF MDA NGA NRU SLB SOL SRB SWZ THA TUR VEN VGB'],
  ['#83D5F4', 'AIA BIH BLM BRN CAF CHE COM CPV CUB ECU ESB FSM GAZ GBR GEO KEN LTU MAR MCO MDV NFK NPL PNG PRY QAT SLE SPM SYC TCA TKM TLS VNM WEB WSB YEM ZWE'],
  ['#B1BBF9', 'ABW ALB AND ATC BOL COD CUW CYM CYP EGY FJI GGY IMN KAB KAZ KWT LAO MLI MNP MSR MYS NIC NLD PAK PAN PRK ROU SGS SVN SWE TGO TWN VCT ZAF'],
  ['#FFFFFF', 'ATA GRL'],
  ['#EAB38F', ''], // everything else
];
const colourOf = (a3: string): number => {
  const i = GROUPS.findIndex(([, list]) => list.split(' ').includes(a3));
  return i < 0 ? GROUPS.length - 1 : i;
};

mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });
const src = `${RAW}/countries.geojson`;
if (!existsSync(src)) {
  execFileSync('ogr2ogr', ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-lco', 'COORDINATE_PRECISION=6',
    '-select', 'ADM0_A3,NAME,LABEL_X,LABEL_Y,LABELRANK', src, existsSync(SHP) ? SHP : REMOTE], { stdio: 'inherit' });
}
const features = (JSON.parse(readFileSync(src, 'utf8')) as { features: Country[] }).features;

type XY = [number, number];
const q = (p: number[]): XY => { const [x, y] = mercator(p); return [Math.round(x * G), Math.round(y * G)]; };
const area = (r: XY[]): number => Math.abs(r.reduce((a, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return a + x * y2 - x2 * y; }, 0)) / 2;

let rings = 0, vertices = 0, dropped = 0;
const rows = features.map((f) => {
  const p = f.properties;
  let d = '', x0 = G, y0 = G, x1 = 0, y1 = 0, size = 0;
  for (const poly of polygonsOf(f.geometry)) {
    for (const r of poly) {
      // Project first, simplify on the grid, then round and drop repeats.
      const pr = r.map((pt) => { const [x, y] = mercator(pt); return [x * G, y * G]; });
      let g = simplify(pr, TOL).map(([x, y]): XY => [Math.round(x), Math.round(y)]);
      g = g.filter((pt, i) => i === 0 || pt[0] !== g[i - 1][0] || pt[1] !== g[i - 1][1]);
      if (g.length > 1 && g[0][0] === g.at(-1)![0] && g[0][1] === g.at(-1)![1]) g.pop();
      if (g.length < 3 || area(g) < MIN_AREA) { dropped++; continue; }
      rings++;
      vertices += g.length;
      size += area(g);
      for (const [x, y] of g) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      d += `M${g[0][0]} ${g[0][1]}l`;
      for (let j = 1; j < g.length; j++) {
        const dx = g[j][0] - g[j - 1][0], dy = g[j][1] - g[j - 1][1];
        // SVG path numbers: a minus sign separates by itself.
        d += (j > 1 && dx >= 0 ? ' ' : '') + dx + (dy >= 0 ? ' ' : '') + dy;
      }
      d += 'z';
    }
  }
  const [lx, ly] = q([p.LABEL_X, p.LABEL_Y]);
  return { rank: p.LABELRANK, size, row: [colourOf(p.ADM0_A3), p.NAME, lx, ly, x0, y0, x1, y1, d] as const };
}).filter((r) => r.row[8] !== '');
rows.sort((a, b) => a.rank - b.rank || b.size - a.size);

const json = JSON.stringify({ g: G, c: GROUPS.map(([c]) => c), f: rows.map((r) => r.row) });
writeFileSync(`${OUT}/basemap.json`, json);
const mmr = rows.find((r) => r.row[1] === 'Myanmar');
console.log(`countries ${rows.length}, rings ${rings} (dropped ${dropped}), vertices ${vertices}, TOL ${TOL}`);
console.log(`Myanmar bbox ${mmr?.row.slice(4, 8).join(',')}, colour ${mmr && GROUPS[mmr.row[0]][0]}`);
console.log(`basemap.json ${json.length} B, gzip ${gzipSync(json, { level: 9 }).length} B`);
