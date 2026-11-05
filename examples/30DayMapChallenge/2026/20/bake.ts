import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeMercator, validateHexGrid, type HexCell } from './globe.ts';

const sourcePath = process.env.DAY20_PARQUET
  ?? '/sata_hdd_24tb/hf_data/kontur-population-2023-11-01-22km/data/parquet/kontur_population_20231101_r4.parquet';
const outputDir = resolve('data/baked/30DayMapChallenge-2026-20');
const quote = (value: string) => value.replaceAll("'", "''");

interface Row { h3: string; population: number; geometry: { type: string; coordinates: unknown } }
type Projected = [number, number];

function rings(geometry: Row['geometry'], id: string): Projected[][] {
  let polygons: unknown[];
  if (geometry.type === 'Polygon') polygons = [geometry.coordinates];
  else if (geometry.type === 'MultiPolygon') polygons = geometry.coordinates as unknown[];
  else throw new Error(`Unexpected Kontur geometry ${geometry.type} for ${id}`);
  return polygons.map((polygon) => {
    const polygonRings = polygon as Projected[][];
    if (polygonRings.length !== 1) throw new Error(`Unexpected interior hole in Kontur cell ${id}`);
    const ring = polygonRings[0]!.map(([x, y]) => {
      const [lon, lat] = decodeMercator(x, y);
      return [Math.round(lon * 100_000) / 100_000, Math.round(lat * 100_000) / 100_000] as Projected;
    });
    if (ring.length > 3 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]) ring.pop();
    if (ring.length < 3) throw new Error(`Kontur cell ${id} has fewer than three vertices`);
    return [ring];
  }).flat();
}

const output = execFileSync('duckdb', ['-json', '-c', `LOAD spatial;
SELECT h3, population, ST_AsGeoJSON(geometry)::JSON AS geometry
FROM read_parquet('${quote(sourcePath)}') ORDER BY h3`], {
  encoding: 'utf8', maxBuffer: 192 << 20,
});
const jsonStart = output.indexOf('[{'), jsonEnd = output.lastIndexOf(']');
if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error(`DuckDB returned no JSON rows: ${output.slice(0, 300)}`);
const rows = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as Row[];
const cells: HexCell[] = rows.map((row) => ({ h3: row.h3, population: row.population, polygons: rings(row.geometry, row.h3) }));
const populationTotal = cells.reduce((sum, cell) => sum + cell.population, 0);
const maximumPopulation = cells.reduce((max, cell) => Math.max(max, cell.population), 0);
const grid = { release: '2023-11-01', populationTotal, maximumPopulation, cells };
validateHexGrid(grid);
if (cells.length !== 71_283 || populationTotal !== 8_031_924_024 || maximumPopulation !== 22_732_635) {
  throw new Error(`Unexpected Kontur snapshot statistics: ${JSON.stringify({ cells: cells.length, populationTotal, maximumPopulation })}`);
}

const payload = JSON.stringify(grid);
const vertexCount = cells.reduce((sum, cell) => sum + cell.polygons.reduce((n, ring) => n + ring.length, 0), 0);
const stats = {
  source: 'Kontur Population dataset © Kontur, release 2023-11-01; HDX GeoParquet conversion',
  sourceUrl: 'https://www.kontur.io/datasets/population-dataset/',
  license: 'Creative Commons Attribution (CC BY), HDX license id cc-by',
  hdxUrl: 'https://data.humdata.org/dataset/kontur-population-dataset-22km',
  sourceFile: 'kontur_population_20231101_r4.parquet',
  sourceCrs: 'EPSG:3857 (WGS 84 / Pseudo-Mercator)',
  displayCoordinates: 'WGS 84 longitude/latitude decoded from EPSG:3857 and quantized to 0.00001 degree',
  releaseDate: grid.release,
  resolution: 4,
  approximateCellDiameterKm: 22,
  cells: cells.length,
  distinctH3: new Set(cells.map((cell) => cell.h3)).size,
  populationTotal,
  minimumPopulation: Math.min(...cells.map((cell) => cell.population)),
  maximumPopulation,
  zeroPopulationCells: cells.filter((cell) => cell.population === 0).length,
  nullPopulationCells: cells.filter((cell) => !Number.isFinite(cell.population)).length,
  geometryParts: cells.reduce((sum, cell) => sum + cell.polygons.length, 0),
  outlineVertices: vertexCount,
  outputBytes: Buffer.byteLength(payload),
  processing: 'No features or source population values filtered. GeoParquet Polygon/MultiPolygon outer rings only (source has no interior rings) transformed into lon/lat; antimeridian split components remain separate; coordinates rounded to 1e-5 degree.',
  interpretation: 'Cell values are Kontur model estimates for population, not census counts. The release date is not a census date. Resolution 4 is coarse (~22 km); no sub-cell or individual precision is implied.',
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'kontur.json'), payload);
writeFileSync(resolve(outputDir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
console.log(`Kontur H3 r4: ${stats.cells.toLocaleString()} cells, ${stats.geometryParts.toLocaleString()} parts, ${stats.outlineVertices.toLocaleString()} outline vertices; estimated population sum ${populationTotal.toLocaleString()}; JSON ${stats.outputBytes.toLocaleString()} B`);
