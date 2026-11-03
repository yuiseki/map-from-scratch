// Bake Akita Kumadas wildlife sighting dataset and prefecture boundary
// into minimal GPU-ready buffers for the timeline renderer.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { source } from '../../tools/sources.ts';
import { simplify, triangulatePolygon, polygonsOf, type Ring } from '../../tools/geo.ts';
import { BASE_DATE, MS_PER_DAY, parseCSV, parseDateToDays } from './data.ts';

const OUT = 'data/baked/25-akita-bear-sighting';
mkdirSync(OUT, { recursive: true });

// Geographical bounds covering Akita prefecture with surrounding context
const MIN_LON = 139.5, MAX_LON = 141.0;
const MIN_LAT = 38.8, MAX_LAT = 40.6;
// 1. Bake Background Map (Akita + neighbor prefectures)
console.log('Baking prefecture boundaries...');
type PrefFeature = {
  properties: { iso_3166_2: string; name_ja?: string };
  geometry: { type: string; coordinates: unknown } | null;
};
const prefGeojson: { features: PrefFeature[] } = JSON.parse(readFileSync(source('ne-japan-prefectures'), 'utf8'));

// Background vertices: x (u16), y (u16), isAkita (u8), pad (u8) = 6 bytes per vertex
const landVertices: number[] = [];

for (const feature of prefGeojson.features) {
  const code = feature.properties.iso_3166_2;
  const isAkita = code === 'JP-05' ? 1 : 0;
  // We keep Akita and surrounding prefectures: Aomori (JP-02), Iwate (JP-03), Yamagata (JP-06), Miyagi (JP-04)
  if (!['JP-05', 'JP-02', 'JP-03', 'JP-06', 'JP-04'].includes(code)) continue;

  for (const poly of polygonsOf(feature.geometry)) {
    // Simplify rings slightly to save triangles
    const simplifiedRings: Ring[] = [];
    for (const ring of poly) {
      if (ring.length < 4) continue;
      // Filter points to near Akita region
      const simplified = simplify(ring, 0.002);
      if (simplified.length >= 3) {
        simplifiedRings.push(simplified);
      }
    }
    if (simplifiedRings.length === 0) continue;

    const { vertices, indices } = triangulatePolygon(simplifiedRings);
    for (const idx of indices) {
      const lon = vertices[idx * 2];
      const lat = vertices[idx * 2 + 1];
      // Normalize to 0..65535
      const u16x = Math.max(0, Math.min(65535, Math.round(((lon - MIN_LON) / (MAX_LON - MIN_LON)) * 65535)));
      const u16y = Math.max(0, Math.min(65535, Math.round(((lat - MIN_LAT) / (MAX_LAT - MIN_LAT)) * 65535)));
      landVertices.push(u16x, u16y, isAkita);
    }
  }
}

// Write land binary: 3 vertices per triangle * 6 bytes (u16 x, u16 y, u8 isAkita, u8 0)
const landBuf = Buffer.allocUnsafe((landVertices.length / 3) * 6);
for (let i = 0, off = 0; i < landVertices.length; i += 3, off += 6) {
  landBuf.writeUInt16LE(landVertices[i], off);
  landBuf.writeUInt16LE(landVertices[i + 1], off + 2);
  landBuf.writeUInt8(landVertices[i + 2], off + 4);
  landBuf.writeUInt8(0, off + 5);
}
writeFileSync(join(OUT, 'akita.bin'), landBuf);
console.log(`Baked ${landVertices.length / 3} background vertices (${landBuf.byteLength} bytes)`);

// 2. Bake Sighting Points
console.log('Parsing kumadas CSV...');
const csvText = readFileSync(source('akita-kumadas'), 'utf8');
const rows = parseCSV(csvText);

const animalMap: Record<string, number> = {
  'ツキノワグマ': 1,
  'イノシシ': 2,
  'ニホンジカ': 3,
};

const kindMap: Record<string, number> = {
  '目撃': 1,
  '痕跡(その他)': 2,
  '痕跡(食害)': 3,
  '人身被害': 4,
};

// 25 Municipalities of Akita
const CITIES = [
  '秋田市', '能代市', '横手市', '大館市', '男鹿市', '湯沢市', '鹿角市', '由利本荘市',
  '潟上市', '大仙市', '北秋田市', 'にかほ市', '仙北市', '小坂町', '上小阿仁村', '藤里町',
  '三種町', '八峰町', '五城目町', '八郎潟町', '井川町', '大潟村', '美郷町', '羽後町', '東成瀬村'
];
const cityMap = Object.fromEntries(CITIES.map((c, i) => [c, i + 1]));

interface SightingRecord {
  x: number;
  y: number;
  day: number;
  animal: number;
  kind: number;
  city: number;
  heads: number;
  hour: number;
  incidentIdx: number;
}

const records: SightingRecord[] = [];
const incidents: { id: number; date: string; city: string; kind: string; desc: string }[] = [];

// Header: 出没情報ID, 情報種別, 市町村, 地番情報, 目撃日時, 獣種, 性別, 単独か親子, 頭数, 目撃時の状況, x(緯度), y(経度)
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (r.length < 12) continue;
  const [idStr, infoType, city, address, dateStr, animal, sex, parentChild, numHead, situ, latStr, lonStr] = r;

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  if (lat < MIN_LAT || lat > MAX_LAT || lon < MIN_LON || lon > MAX_LON) continue;

  const day = parseDateToDays(dateStr);
  const animalCode = animalMap[animal] || 1;
  const kindCode = kindMap[infoType] || 1;
  const cityCode = cityMap[city] || 0;
  const heads = Math.max(1, Math.min(255, parseInt(numHead, 10) || 1));

  // Extract hour
  const hourMatch = dateStr.match(/\s(\d{1,2}):/);
  const hour = hourMatch ? Math.min(23, parseInt(hourMatch[1], 10)) : 12;

  const u16x = Math.max(0, Math.min(65535, Math.round(((lon - MIN_LON) / (MAX_LON - MIN_LON)) * 65535)));
  const u16y = Math.max(0, Math.min(65535, Math.round(((lat - MIN_LAT) / (MAX_LAT - MIN_LAT)) * 65535)));

  let incidentIdx = 0;
  // If human injury or prominent remark, save to incidents table
  if (kindCode === 4 || (situ && situ.length > 10 && !situ.includes('【投稿】'))) {
    if (incidents.length < 255) {
      incidents.push({
        id: parseInt(idStr, 10) || 0,
        date: dateStr,
        city,
        kind: infoType,
        desc: situ.replace(/\s+/g, ' ').slice(0, 100),
      });
      incidentIdx = incidents.length;
    }
  }

  records.push({
    x: u16x,
    y: u16y,
    day,
    animal: animalCode,
    kind: kindCode,
    city: cityCode,
    heads,
    hour,
    incidentIdx,
  });
}

// Sort by day for smooth chronological streaming & binary search
records.sort((a, b) => a.day - b.day);

console.log(`Total valid sighting points: ${records.length}`);

// Binary layout per record (12 bytes):
// offset 0: x (u16)
// offset 2: y (u16)
// offset 4: day (u16)
// offset 6: animal (u8)
// offset 7: kind (u8)
// offset 8: city (u8)
// offset 9: heads (u8)
// offset 10: hour (u8)
// offset 11: incidentIdx (u8)
const RECORD_SIZE = 12;
const sightingsBuf = Buffer.allocUnsafe(records.length * RECORD_SIZE);
for (let i = 0; i < records.length; i++) {
  const rec = records[i];
  const off = i * RECORD_SIZE;
  sightingsBuf.writeUInt16LE(rec.x, off);
  sightingsBuf.writeUInt16LE(rec.y, off + 2);
  sightingsBuf.writeUInt16LE(rec.day, off + 4);
  sightingsBuf.writeUInt8(rec.animal, off + 6);
  sightingsBuf.writeUInt8(rec.kind, off + 7);
  sightingsBuf.writeUInt8(rec.city, off + 8);
  sightingsBuf.writeUInt8(rec.heads, off + 9);
  sightingsBuf.writeUInt8(rec.hour, off + 10);
  sightingsBuf.writeUInt8(rec.incidentIdx, off + 11);
}
writeFileSync(join(OUT, 'sightings.bin'), sightingsBuf);
console.log(`Baked ${records.length} sightings into ${sightingsBuf.byteLength} bytes`);

// Monthly aggregation for timeline histogram / stats
const monthlyCounts: Record<string, { bear: number; boar: number; deer: number; injury: number }> = {};
let maxDay = 0;
for (const rec of records) {
  if (rec.day > maxDay) maxDay = rec.day;
  const d = new Date(BASE_DATE + rec.day * MS_PER_DAY);
  const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  if (!monthlyCounts[monthKey]) {
    monthlyCounts[monthKey] = { bear: 0, boar: 0, deer: 0, injury: 0 };
  }
  const stat = monthlyCounts[monthKey];
  if (rec.animal === 1) stat.bear++;
  else if (rec.animal === 2) stat.boar++;
  else if (rec.animal === 3) stat.deer++;
  if (rec.kind === 4) stat.injury++;
}

// Write metadata and incidents
const meta = {
  bounds: { minLon: MIN_LON, maxLon: MAX_LON, minLat: MIN_LAT, maxLat: MAX_LAT },
  baseDate: '2022-04-01',
  maxDays: maxDay,
  totalRecords: records.length,
  recordSize: RECORD_SIZE,
  monthlyCounts,
  cities: CITIES,
  animals: { 1: 'ツキノワグマ', 2: 'イノシシ', 3: 'ニホンジカ' },
  kinds: { 1: '目撃', 2: '痕跡(その他)', 3: '痕跡(食害)', 4: '人身被害' },
};
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta));
writeFileSync(join(OUT, 'incidents.json'), JSON.stringify(incidents));

console.log('Bake complete! Output in', OUT);
