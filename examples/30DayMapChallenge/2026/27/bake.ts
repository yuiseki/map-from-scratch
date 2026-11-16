import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cellCenterInPolygon,
  decodeQuarterMesh,
  encodeQuarterMesh,
  includeInArea,
  populationForMesh,
  type Bounds,
  type CensusCell,
  type PolygonRings,
} from './mesh.ts';

const CENSUS = '/sata_hdd_24tb/hf_data/__published/estat-census-mesh-250m-2020/data/parquet/T001142.parquet';
const ADMIN = '/sata_hdd_24tb/hf_data/__published/jp-admin-2026-09/data/municipalities.parquet';
const OUTPUT = resolve('data/baked/30DayMapChallenge-2026-27');
const WARD_CODE = '131016';
const TABLE = 'T001142';
const VALUE_FIELD = 'T001142004';
const VALUE_LABEL = '0～14歳人口 総数';

interface AdminRow { name: string; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } }
interface CensusRow {
  KEY_CODE: string; HTKSYORI: string | null; HTKSAKI: string | null; GASSAN: string | null;
  [VALUE_FIELD]: string | null;
}
type Position = [number, number];

function query(sql: string, maxBuffer = 64 << 20): unknown[] {
  const raw = execFileSync('duckdb', ['-json', '-c', sql], { encoding: 'utf8', maxBuffer });
  const start = raw.indexOf('[{');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`DuckDB returned no JSON rows: ${raw.slice(0, 300)}`);
  return JSON.parse(raw.slice(start, end + 1)) as unknown[];
}

function normalizePolygon(row: AdminRow): PolygonRings[] {
  const coordinates = row.geometry.coordinates;
  if (row.geometry.type === 'Polygon' && Array.isArray(coordinates)) {
    return [coordinates.map((ring, i) => positions(ring, `polygon ring ${i}`))];
  }
  if (row.geometry.type === 'MultiPolygon' && Array.isArray(coordinates)) {
    return coordinates.map((polygon, p) => {
      if (!Array.isArray(polygon)) throw new Error(`Invalid polygon part ${p}`);
      return polygon.map((ring, i) => positions(ring, `polygon ${p} ring ${i}`));
    });
  }
  throw new Error(`Unexpected administrative geometry ${row.geometry.type}`);
}

function positions(value: unknown, label: string): Position[] {
  if (!Array.isArray(value) || value.length < 4) throw new Error(`Invalid ring ${label}`);
  return value.map((position) => {
    if (!Array.isArray(position) || position.length < 2 || !Number.isFinite(Number(position[0])) || !Number.isFinite(Number(position[1]))) {
      throw new Error(`Invalid coordinate in ${label}`);
    }
    return [Number(position[0]), Number(position[1])];
  });
}

function envelope(polygons: PolygonRings[]): Bounds {
  const points = polygons.flat(2);
  if (points.length === 0) throw new Error('Empty administrative boundary');
  return {
    west: Math.min(...points.map(([x]) => x)), south: Math.min(...points.map(([, y]) => y)),
    east: Math.max(...points.map(([x]) => x)), north: Math.max(...points.map(([, y]) => y)),
  };
}

function enumerateQuarterMeshes(area: Bounds, polygons: PolygonRings[]): Bounds[] {
  const cells: Bounds[] = [];
  let y = area.south + 1e-10;
  for (let row = 0; y < area.north && row < 500; row++) {
    let x = area.west + 1e-10;
    const rowStart = encodeQuarterMesh(x, y);
    if (!rowStart) throw new Error(`Cannot encode start of mesh row at ${x},${y}`);
    let current = rowStart;
    for (let column = 0; column < 500; column++) {
      const bounds = decodeQuarterMesh(current);
      if (!bounds || bounds.west >= area.east) break;
      if (includeInArea(bounds, [area.west, area.south, area.east, area.north]) && cellCenterInPolygon(bounds, polygons)) cells.push(bounds);
      const nextX = bounds.east + 1e-10;
      if (!(nextX > x)) throw new Error(`Mesh enumeration did not advance in longitude: ${current}`);
      x = nextX;
      const next = encodeQuarterMesh(x, (bounds.south + bounds.north) / 2);
      if (!next || next === current) throw new Error(`Cannot advance longitude after ${current}`);
      current = next;
    }
    const first = decodeQuarterMesh(rowStart)!;
    const nextY = first.north + 1e-10;
    if (!(nextY > y)) throw new Error(`Mesh enumeration did not advance in latitude: ${rowStart}`);
    y = nextY;
  }
  if (cells.length === 0) throw new Error('Selected area contains no quarter meshes');
  return cells;
}

// The municipality source is JGD2000 (EPSG:4612); transform the complete
// boundary with PROJ before comparing it to the census JGD2011 mesh grid.
const adminRows = query(`LOAD spatial; SELECT name, ST_AsGeoJSON(ST_Transform(geometry, 'EPSG:4612', 'EPSG:6668'))::JSON AS geometry FROM read_parquet('${ADMIN}') WHERE lg_code='${WARD_CODE}'`) as unknown as AdminRow[];
if (adminRows.length !== 1 || adminRows[0].name !== '千代田区') throw new Error(`Expected one Chiyoda boundary, received ${adminRows.length}`);
const admin = adminRows[0];
const polygon = normalizePolygon(admin);
const area = envelope(polygon);
const coverage = enumerateQuarterMeshes(area, polygon);

const sourceRows = query(`SELECT KEY_CODE, HTKSYORI, HTKSAKI, GASSAN, ${VALUE_FIELD} FROM read_parquet('${CENSUS}') WHERE prefecture='13'`) as unknown as CensusRow[];
const sourceByCode = new Map(sourceRows.map((row) => [row.KEY_CODE, row]));
const cells: CensusCell[] = coverage.map((bounds) => {
  const code = encodeQuarterMesh((bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2);
  if (!code) throw new Error('Could not derive census key from quarter-mesh center');
  const row = sourceByCode.get(code);
  const state = populationForMesh(Boolean(row), row?.[VALUE_FIELD]);
  if (!state) throw new Error(`Could not interpret source field ${VALUE_FIELD} for ${code}`);
  return {
    code,
    bounds,
    status: state.status,
    value: state.value,
    rawValue: row ? row[VALUE_FIELD] : null,
    source: row ? {
      prefecture: '13', table: TABLE, field: VALUE_FIELD,
      HTKSYORI: row.HTKSYORI, HTKSAKI: row.HTKSAKI, GASSAN: row.GASSAN,
    } : null,
  } as CensusCell;
});

const statusCounts = Object.fromEntries(['count', 'zero', 'suppressed', 'no-row', 'unavailable'].map((status) => [status, cells.filter((cell) => cell.status === status).length]));
const sourceRowsInArea = cells.filter((cell) => cell.status !== 'no-row').length;
const missingSourceCodes = cells.filter((cell) => cell.status === 'no-row').map((cell) => cell.code);
const geo = { type: admin.geometry.type, coordinates: admin.geometry.coordinates };
const data = { schema: 1, area: { name: '東京都千代田区', municipalCode: WARD_CODE, crs: 'EPSG:6668', bounds: area, polygon: geo }, table: TABLE, valueField: VALUE_FIELD, valueLabel: VALUE_LABEL, censusDate: '2020-10-01', cells };
const json = JSON.stringify(data);
const stats = {
  dataset: '2020 Census 250 m quarter-mesh population by age group',
  censusSource: 'e-Stat Statistical GIS, 2020 Population Census mesh statistics (令和2年国勢調査)',
  censusUrl: 'https://www.e-stat.go.jp/gis/statmap-search?page=1&type=1&toukeiCode=00200521&toukeiYear=2020&aggregateUnit=Q&serveyId=Q002005112020&statsId=T001102',
  censusLicense: 'CC BY 4.0-compatible e-Stat terms; processed from source',
  censusAttribution: '出典：政府統計の総合窓口(e-Stat)「令和2年国勢調査」（総務省統計局）を加工して作成',
  adminBoundarySource: 'yuiseki/jp-admin-2026-09, municipality 131016 千代田区, geometry sourced from 2020 Census small-area aggregation',
  adminBoundaryLicense: 'CC BY 4.0',
  adminBoundaryAttribution: '出典：政府統計の総合窓口(e-Stat)「令和2年国勢調査」（総務省統計局）、行政区域は2020年国勢調査小地域境界を加工して作成',
  sourceTable: TABLE,
  sourceTableName: '人口及び世帯（JGD2011）',
  sourceField: VALUE_FIELD,
  sourceFieldLabel: VALUE_LABEL,
  selectedArea: '東京都千代田区 (local government code 131016); full quarter-mesh squares retained when their centroids fall inside the source municipal polygon',
  sourceMeshCode: '10-digit 1/4 regional mesh (JIS X 0410), derived from first/second/third mesh digits and fourth/fifth mesh quadrant digits',
  censusCrs: 'EPSG:6668 JGD2011 longitude/latitude quarter-mesh coordinates; municipal boundary source EPSG:4612 JGD2000 transformed to EPSG:6668 by DuckDB Spatial ST_Transform (PROJ) before polygon selection',
  boundaryTransform: { source: 'EPSG:4612 (JGD2000)', target: 'EPSG:6668 (JGD2011)', operation: "DuckDB Spatial ST_Transform(geometry, 'EPSG:4612', 'EPSG:6668')", purpose: 'Compare polygon and mesh centers in a shared CRS before centroid inclusion.' },
  rowsScannedInTokyo: sourceRows.length,
  cells: cells.length,
  sourceRowsInArea,
  byStatus: statusCounts,
  absentSourceCellCodes: missingSourceCodes,
  outputBytes: Buffer.byteLength(json),
  interpretation: 'A cell is one source 250 m mesh, not an individual or household point. Census date is 2020-10-01 and values are not current population. The 0–14 total may be suppressed (*); the source flags and raw string are kept. Meshes with no source row are rendered as no-row status, never as a zero count. Each full mesh is selected by centroid and is not clipped to the ward boundary.',
};

mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'cells.json'), json);
writeFileSync(resolve(OUTPUT, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
console.log(`Day27 Chiyoda: ${cells.length} cells (${sourceRowsInArea} source rows), statuses ${JSON.stringify(statusCounts)}, JSON ${stats.outputBytes} B`);
