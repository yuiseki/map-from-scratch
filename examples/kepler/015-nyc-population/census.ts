import earcut from '../../../vendor/earcut/earcut.js';

export interface CensusTract {
  id: string;
  population: number;
  coordinates: [number, number][]; // [lon, lat]
}

export interface CensusMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  count: number;
}

export const CENSUS_CENTER: [number, number] = [-73.98, 40.73];

export function toLocalMeters(lon: number, lat: number, centerLon: number, centerLat: number): [number, number] {
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegLon = 111320 * Math.cos(latRad);
  const metersPerDegLat = 110540;
  return [
    (lon - centerLon) * metersPerDegLon,
    (lat - centerLat) * metersPerDegLat,
  ];
}

// Viridis color ramp: deep violet -> blue -> teal -> chartreuse -> radiant yellow
export function getPopulationColor(pop: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, pop / 16000));
  if (t < 0.25) {
    const s = t / 0.25;
    return [0.27 * (1 - s) + 0.19 * s, 0.01 * (1 - s) + 0.40 * s, 0.33 * (1 - s) + 0.55 * s];
  } else if (t < 0.50) {
    const s = (t - 0.25) / 0.25;
    return [0.19 * (1 - s) + 0.13 * s, 0.40 * (1 - s) + 0.57 * s, 0.55 * (1 - s) + 0.55 * s];
  } else if (t < 0.75) {
    const s = (t - 0.50) / 0.25;
    return [0.13 * (1 - s) + 0.21 * s, 0.57 * (1 - s) + 0.72 * s, 0.55 * (1 - s) + 0.47 * s];
  } else {
    const s = (t - 0.75) / 0.25;
    return [0.21 * (1 - s) + 0.99 * s, 0.72 * (1 - s) + 0.90 * s, 0.47 * (1 - s) + 0.14 * s];
  }
}

export function generateNycCensusTracts(): CensusTract[] {
  const tracts: CensusTract[] = [];
  const baseLon = CENSUS_CENTER[0];
  const baseLat = CENSUS_CENTER[1];

  const rows = 16;
  const cols = 14;
  const tractW = 0.0022; // ~180m
  const tractH = 0.0016; // ~170m
  const gap = 0.0003;

  let id = 1;
  for (let r = -rows / 2; r < rows / 2; r++) {
    for (let c = -cols / 2; c < cols / 2; c++) {
      const minX = baseLon + c * (tractW + gap);
      const maxX = minX + tractW;
      const minY = baseLat + r * (tractH + gap);
      const maxY = minY + tractH;

      // Density pattern: high in Midtown / Lower Manhattan and parts of Brooklyn
      const distManhattan = Math.hypot(c + 1, r - 1);
      const distBrooklyn = Math.hypot(c - 3, r + 4);

      const popManhattan = 15000 * Math.exp(-distManhattan * 0.3);
      const popBrooklyn = 12000 * Math.exp(-distBrooklyn * 0.4);
      const noise = (Math.sin(c * 2.5 + r * 3.7) + 1) * 1500;

      const pop = Math.round(Math.max(400, Math.min(22000, popManhattan + popBrooklyn + noise)));

      tracts.push({
        id: `tract_${id++}`,
        population: pop,
        coordinates: [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
        ],
      });
    }
  }

  return tracts;
}

export function buildCensusMesh(tracts: CensusTract[], center: [number, number]): CensusMesh {
  const posArr: number[] = [];
  const normArr: number[] = [];
  const colArr: number[] = [];

  for (const t of tracts) {
    const coords = t.coordinates;
    const n = coords.length;
    if (n < 3) continue;

    const localPts: [number, number][] = coords.map((c) =>
      toLocalMeters(c[0], c[1], center[0], center[1])
    );

    // Height proportional to population (max ~650m)
    const baseZ = 0;
    const topZ = Math.max(25, t.population * 0.038);
    const rgb = getPopulationColor(t.population);

    // 1. Vertical side walls
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

        // Ambient occlusion gradient along wall
        const frac = Math.max(0, Math.min(1, v[2] / (topZ + 1e-3)));
        const shade = 0.55 + 0.40 * frac;
        colArr.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade);
      }
    }

    // 2. Rooftop polygon
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
        colArr.push(rgb[0], rgb[1], rgb[2]); // Full vibrant top color
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
