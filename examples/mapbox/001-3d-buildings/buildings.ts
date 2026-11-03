import earcut from '../../../vendor/earcut/earcut.js';

export interface Skyscraper {
  id: string;
  height: number;
  base: number;
  glowColor?: [number, number, number];
  coordinates: [number, number][]; // [lon, lat]
}

export interface BuildingMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  count: number;
}

export function projectMercator(lon: number, lat: number): [number, number] {
  const x = (lon + 180) / 360;
  const sin = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.max(-0.9999, Math.min(0.9999, sin));
  const y = (1 - Math.log((1 + clamped) / (1 - clamped)) / (2 * Math.PI)) / 2;
  return [x, y];
}

export function toLocalMeters(lon: number, lat: number, centerLon: number, centerLat: number): [number, number] {
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegLon = 111320 * Math.cos(latRad);
  const metersPerDegLat = 110540;
  return [
    (lon - centerLon) * metersPerDegLon,
    (lat - centerLat) * metersPerDegLat,
  ];
}

export function generateSkyscraperPrisms(
  skyscrapers: Skyscraper[],
  center: [number, number],
): BuildingMesh {
  const posArr: number[] = [];
  const normArr: number[] = [];
  const colArr: number[] = [];

  for (const s of skyscrapers) {
    const coords = s.coordinates;
    const n = coords.length;
    if (n < 3) continue;

    const localPts: [number, number][] = coords.map((c) =>
      toLocalMeters(c[0], c[1], center[0], center[1])
    );

    const baseZ = s.base || 0;
    const topZ = s.height;
    const glow = s.glowColor || [0.15, 0.55, 0.95];

    // Wall Quads
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const p1 = localPts[i];
      const p2 = localPts[next];

      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;

      const nx = dy / len;
      const ny = -dx / len;

      const v0 = [p1[0], p1[1], baseZ];
      const v1 = [p2[0], p2[1], baseZ];
      const v2 = [p2[0], p2[1], topZ];
      const v3 = [p1[0], p1[1], topZ];

      const wallVerts = [v0, v1, v2, v0, v2, v3];
      for (const v of wallVerts) {
        posArr.push(v[0], v[1], v[2]);
        normArr.push(nx, ny, 0);

        // Nighttime dark glass wall with vertical luminescent gradient
        const t = Math.max(0, Math.min(1, (v[2] - baseZ) / (topZ - baseZ + 1e-3)));
        const r = 0.12 * (1 - t) + glow[0] * 0.45 * t;
        const g = 0.16 * (1 - t) + glow[1] * 0.45 * t;
        const b = 0.22 * (1 - t) + glow[2] * 0.55 * t;
        colArr.push(r, g, b);
      }
    }

    // Roof Triangles
    const flat: number[] = [];
    for (const pt of localPts) {
      flat.push(pt[0], pt[1]);
    }

    const indices = earcut(flat, null, 2);
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];

      const p0 = localPts[i0];
      const p1 = localPts[i1];
      const p2 = localPts[i2];

      const roofVerts = [
        [p0[0], p0[1], topZ],
        [p1[0], p1[1], topZ],
        [p2[0], p2[1], topZ],
      ];

      for (const v of roofVerts) {
        posArr.push(v[0], v[1], v[2]);
        normArr.push(0, 0, 1);
        // Illuminated rooftop
        colArr.push(glow[0] * 0.85, glow[1] * 0.85, glow[2] * 0.95);
      }
    }
  }

  return {
    positions: new Float32Array(posArr),
    normals: new Float32Array(normArr),
    colors: new Float32Array(colArr),
    count: posArr.length / 3,
  };
}

export const MAPBOX_DEFAULT_CENTER: [number, number] = [-74.0066, 40.7135];

export function createMapboxDefaultBuildings(): Skyscraper[] {
  const towers: Skyscraper[] = [];
  const baseLon = MAPBOX_DEFAULT_CENTER[0];
  const baseLat = MAPBOX_DEFAULT_CENTER[1];

  const rows = 14;
  const cols = 14;
  const blockW = 0.0011;
  const blockH = 0.00075;
  const streetGap = 0.00028;

  let id = 1;
  for (let r = -rows / 2; r < rows / 2; r++) {
    for (let c = -cols / 2; c < cols / 2; c++) {
      const minX = baseLon + c * (blockW + streetGap);
      const maxX = minX + blockW;
      const minY = baseLat + r * (blockH + streetGap);
      const maxY = minY + blockH;

      const dist = Math.hypot(c, r);
      const height = Math.max(35, Math.round(360 * Math.exp(-dist * 0.25) + Math.cos(c * 2 + r * 3) * 45));

      // Vary accent glow: cyan, electric blue, amber
      const glowType = (id % 3);
      const glowColor: [number, number, number] =
        glowType === 0 ? [0.2, 0.75, 1.0] :
        glowType === 1 ? [0.3, 0.55, 0.95] :
        [0.95, 0.7, 0.25];

      towers.push({
        id: `tower_${id++}`,
        height,
        base: 0,
        glowColor,
        coordinates: [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
        ],
      });
    }
  }

  // Empire State / Central Spire landmark
  towers.push({
    id: 'tower_spire',
    height: 480,
    base: 0,
    glowColor: [0.3, 0.85, 1.0],
    coordinates: [
      [baseLon - 0.00035, baseLat - 0.00035],
      [baseLon + 0.00035, baseLat - 0.00035],
      [baseLon + 0.00035, baseLat + 0.00035],
      [baseLon - 0.00035, baseLat + 0.00035],
    ],
  });

  return towers;
}
