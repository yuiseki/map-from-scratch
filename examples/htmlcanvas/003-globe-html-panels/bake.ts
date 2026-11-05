// Bakes htmlcanvas-003-globe-html-panels (run: bin/mfs bake htmlcanvas-003-globe-html-panels):
//   panels.json  five cities from Natural Earth 10m populated places (public domain) with the
//                urban agglomeration population every 5 years 1950-2025 that Natural Earth
//                carries from the UN World Urbanization Prospects, and the country's urban
//                population share for the same years from World Bank WDI 2026-10-01 (CC BY 4.0)
//   earth.jpg    the Solar System Scope texture of examples/threejs/006-earth (CC BY 4.0)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePanels, type Place } from './data.ts';

const ID = 'htmlcanvas-003-globe-html-panels';
const OUT = `data/baked/${ID}`;
const NE = '/sata_hdd_24tb/hf_data/__published/natural-earth/data/parquet/v5.1.2';
const WDI = '/sata_hdd_24tb/hf_data/__published/worldbank-wdi/data/parquet/2026-10-01/data.parquet';
const DAY = 'examples/threejs/006-earth/earth.jpg';
const DAY_SHA256 = '2faa400d1eade3bc44caf6750d1b772bd9bbb6d87362c02bc7c3304e78fa0a9d';
// Spread around the globe so that some panels are always behind the horizon.
const CITIES: [id: string, neName: string, iso3: string][] = [
  ['london', 'London', 'GBR'], ['lagos', 'Lagos', 'NGA'], ['new-york', 'New York', 'USA'],
  ['sao-paulo', 'São Paulo', 'BRA'], ['tokyo', 'Tokyo', 'JPN'],
];
const YEARS = Array.from({ length: 16 }, (_, i) => 1950 + 5 * i);

mkdirSync(OUT, { recursive: true });

const day = readFileSync(DAY);
const sha = createHash('sha256').update(day).digest('hex');
if (sha !== DAY_SHA256) throw new Error(`${DAY}: sha256 ${sha}, expected ${DAY_SHA256}`);
copyFileSync(DAY, `${OUT}/earth.jpg`);
console.log(`earth.jpg ${day.length} bytes`);

const duck = (sql: string): Record<string, unknown>[] =>
  JSON.parse(execFileSync('duckdb', ['-json', '-c', sql], { encoding: 'utf8' }) || '[]');
const list = (xs: string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(',');

// SCALERANK 0-1 keeps the capital or the megacity, not a same-named small town.
const rows = duck(`
  select p.NAME as name, p.ADM0_A3 as iso3, p.LONGITUDE as lon, p.LATITUDE as lat, p.WIKIDATAID as wikidata,
         p.NAME_JA as name_ja, c.NAME_JA as country_ja, ${YEARS.map((y) => `p.POP${y}`).join(', ')}
  from '${NE}/10m_cultural/ne_10m_populated_places.parquet' p
  join '${NE}/110m_cultural/ne_110m_admin_0_countries.parquet' c on c.ADM0_A3 = p.ADM0_A3
  where p.NAME in (${list(CITIES.map((c) => c[1]))}) and p.SCALERANK <= 1`);
const urban = duck(`
  select country_code as iso3, year, value from '${WDI}'
  where indicator_code = 'SP.URB.TOTL.IN.ZS' and country_code in (${list(CITIES.map((c) => c[2]))})
    and year in (${YEARS.join(',')})`);

const places: Place[] = CITIES.map(([id, neName, iso3]) => {
  const hits = rows.filter((r) => r.name === neName && r.iso3 === iso3);
  if (hits.length !== 1) throw new Error(`${neName}: ${hits.length} rows in Natural Earth`);
  const r = hits[0];
  const u = new Map(urban.filter((x) => x.iso3 === iso3).map((x) => [x.year as number, x.value as number]));
  return {
    id, name: neName,
    // Natural Earth names Tokyo 東京都 (the prefecture); the panel is about the agglomeration.
    name_ja: id === 'tokyo' ? '東京' : String(r.name_ja),
    country_ja: String(r.country_ja), iso3,
    lon: Math.round((r.lon as number) * 1e4) / 1e4, lat: Math.round((r.lat as number) * 1e4) / 1e4,
    wikidata: String(r.wikidata),
    // POPyyyy is in thousands; 0 means no estimate.
    pop: YEARS.map((y) => (r[`POP${y}`] as number) > 0 ? r[`POP${y}`] as number : null),
    urban: YEARS.map((y) => u.has(y) ? Math.round(u.get(y)! * 10) / 10 : null),
  };
});

const panels = decodePanels({ years: YEARS, places });
const json = JSON.stringify(panels);
writeFileSync(`${OUT}/panels.json`, json);
for (const p of panels.places) {
  console.log(`${p.id.padEnd(10)} ${p.name_ja}/${p.country_ja} ${p.lon},${p.lat} ${p.wikidata} pop ${p.pop[0]}..${p.pop.at(-1)} k, urban ${p.urban.filter((v) => v !== null).length}/${YEARS.length} years (${p.urban.at(-1)}%)`);
}
console.log(`panels.json ${json.length} bytes`);
