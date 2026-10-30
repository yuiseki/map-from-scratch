// bake.ts for htmlcanvas-002-webgpu-map-label
// Prepares Tokyo landmarks data for GPU-instanced HTML label rendering.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../../../data/baked/htmlcanvas-002-webgpu-map-label');
mkdirSync(outDir, { recursive: true });

export interface MapLabelItem {
  id: string;
  name: string;
  category: string;
  rating: string;
  badgeColor: string;
  lon: number;
  lat: number;
  // Normalized Mercator coords (0..1)
  mx: number;
  my: number;
}

const rawLandmarks = [
  {
    id: 'tokyo-tower',
    name: '東京タワー',
    category: '総合電波塔',
    rating: '★ 4.6',
    badgeColor: '#0284c7',
    lon: 139.7454,
    lat: 35.6586,
  },
  {
    id: 'tokyo-skytree',
    name: '東京スカイツリー',
    category: '超高層電波塔',
    rating: '★ 4.7',
    badgeColor: '#7c3aed',
    lon: 139.8107,
    lat: 35.7100,
  },
  {
    id: 'imperial-palace',
    name: '皇居東御苑',
    category: '歴史・庭園',
    rating: '★ 4.8',
    badgeColor: '#16a34a',
    lon: 139.7528,
    lat: 35.6852,
  },
  {
    id: 'sensoji',
    name: '浅草寺 本堂',
    category: '寺社仏閣',
    rating: '★ 4.6',
    badgeColor: '#dc2626',
    lon: 139.7967,
    lat: 35.7148,
  },
  {
    id: 'shibuya-crossing',
    name: '渋谷交差点',
    category: '都市回廊',
    rating: '★ 4.5',
    badgeColor: '#ea580c',
    lon: 139.7006,
    lat: 35.6595,
  },
  {
    id: 'ueno-park',
    name: '上野恩賜公園',
    category: '文化・公園',
    rating: '★ 4.5',
    badgeColor: '#059669',
    lon: 139.7732,
    lat: 35.7140,
  },
];

function projectMercator(lon: number, lat: number): { mx: number; my: number } {
  const mx = (lon + 180) / 360;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const my = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { mx, my };
}

const landmarks: MapLabelItem[] = rawLandmarks.map((lm) => {
  const { mx, my } = projectMercator(lm.lon, lm.lat);
  return {
    ...lm,
    mx,
    my,
  };
});

const outFile = join(outDir, 'landmarks.json');
writeFileSync(outFile, JSON.stringify(landmarks, null, 2));
console.log(`Baked ${landmarks.length} landmarks to ${outFile}`);
