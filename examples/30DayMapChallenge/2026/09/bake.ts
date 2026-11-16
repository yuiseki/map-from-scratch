import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { encodeUrbanCells, URBAN_EXTENT, URBAN_RECORD_BYTES, type UrbanCell } from './urban.ts';

const output = 'data/baked/30DayMapChallenge-2026-09';
const tiles = ['R5_C32', 'R5_C33', 'R6_C31', 'R6_C32', 'R6_C33'] as const;
const populationPaths = tiles.map((tile) => source(`ghsl-population-${tile}`));
const builtPaths = tiles.map((tile) => source(`ghsl-built_surface-${tile}`));
const japan = source('ne-countries');
const list = (paths: string[]) => `[${paths.map((path) => `'${path.replaceAll("'", "''")}'`).join(',')}]`;
const tileCrop = `(tile_code='R6_C31' AND cell_col BETWEEN 240 AND 1199)
  OR tile_code='R6_C32'
  OR (tile_code='R6_C33' AND cell_col BETWEEN 0 AND 782)
  OR (tile_code='R5_C32' AND cell_row BETWEEN 370 AND 1199)
  OR (tile_code='R5_C33' AND cell_row BETWEEN 370 AND 1199 AND cell_col BETWEEN 0 AND 782)`;
const sql = `LOAD spatial;
WITH pop AS MATERIALIZED (
  SELECT tile_code,cell_row,cell_col,population_estimate,geometry,ST_Centroid(geometry) AS center
  FROM read_parquet(${list(populationPaths)})
  WHERE (${tileCrop}) AND population_estimate>0
    AND ST_Y(ST_Centroid(geometry)) BETWEEN 29.0995 AND 46.0
), built AS MATERIALIZED (
  SELECT tile_code,cell_row,cell_col,built_surface_m2,geometry,ST_Centroid(geometry) AS center
  FROM read_parquet(${list(builtPaths)})
  WHERE (${tileCrop}) AND built_surface_m2>0
    AND ST_Y(ST_Centroid(geometry)) BETWEEN 29.0995 AND 46.0
), jpn AS (SELECT geom FROM ST_Read('${japan.replaceAll("'", "''")}') WHERE ADM0_A3='JPN')
SELECT ST_X(pop.center),ST_Y(pop.center),pop.population_estimate,coalesce(built.built_surface_m2,0)
FROM pop LEFT JOIN built
  ON built.tile_code=pop.tile_code AND built.cell_row=pop.cell_row AND built.cell_col=pop.cell_col
  AND ST_Contains(built.geometry,pop.center)
CROSS JOIN jpn
WHERE ST_Covers(jpn.geom,pop.center)
UNION ALL
SELECT ST_X(built.center),ST_Y(built.center),0,built.built_surface_m2
FROM built LEFT JOIN pop
  ON pop.tile_code=built.tile_code AND pop.cell_row=built.cell_row AND pop.cell_col=built.cell_col
  AND ST_Contains(pop.geometry,built.center)
CROSS JOIN jpn
WHERE pop.tile_code IS NULL AND ST_Covers(jpn.geom,built.center)`;
const text = execFileSync('duckdb', ['-noheader', '-list', '-separator', '|', '-c', sql], {
  encoding: 'utf8', maxBuffer: 256 << 20,
});
const cells: UrbanCell[] = text.trimEnd().split('\n').filter(Boolean).map((row) => {
  const values = row.split('|').map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) throw new Error(`Malformed GHSL record: ${row.slice(0, 100)}`);
  const [longitude, latitude, population, builtSurfaceM2] = values as [number, number, number, number];
  return { longitude, latitude, population, builtSurfaceM2 };
});
const populationCells = cells.filter((cell) => cell.population > 0).length;
const builtOnlyCells = cells.filter((cell) => cell.population === 0 && cell.builtSurfaceM2 > 0).length;
const matchedCellCount = cells.filter((cell) => cell.population > 0 && cell.builtSurfaceM2 > 0).length;
const populationEstimate = cells.reduce((sum, cell) => sum + cell.population, 0);
const builtSurfaceM2 = cells.reduce((sum, cell) => sum + cell.builtSurfaceM2, 0);
if (cells.length < 100_000 || populationEstimate < 100_000_000 || builtOnlyCells < 1) {
  throw new Error(`Unexpected GHSL Japan coverage: ${cells.length} cells, ${populationEstimate} population, ${builtOnlyCells} built-only`);
}
const bytes = encodeUrbanCells(cells, URBAN_EXTENT);
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/urban.bin`, new Uint8Array(bytes));
writeFileSync(`${output}/stats.json`, JSON.stringify({ sourceRelease: 'GHSL R2023A E2020', resolutionArcseconds: 30,
  crs: 'EPSG:4326', cells: cells.length, populationCells, builtOnlyCells, matchedCellCount, populationEstimate, builtSurfaceM2,
  extent: { west: 122.0, east: 146.0, south: 29.0995, north: 46.0 },
  recordBytes: URBAN_RECORD_BYTES, outputBytes: bytes.byteLength, populationProduct: 'GHS-POP R2023A E2020', builtProduct: 'GHS-BUILT-S R2023A E2020',
  spatialJoin: 'built polygon contains the population-cell centroid; differing product grid origins are preserved' }));
console.log(`GHSL Japan urban/rural: ${cells.length.toLocaleString()} active cells (${populationCells.toLocaleString()} with population, ${builtOnlyCells.toLocaleString()} built-only), estimated population ${Math.round(populationEstimate).toLocaleString()}`);
