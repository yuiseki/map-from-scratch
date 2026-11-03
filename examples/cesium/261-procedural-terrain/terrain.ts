/**
 * Procedural Fractal Mountain Terrain Generator for CesiumJS Procedural Terrain reproduction.
 * Zero external runtime dependencies.
 */

function pseudoHash(x: number, z: number): number {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  // Cubic Hermite smoothstep
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uz = fz * fz * (3.0 - 2.0 * fz);

  const a = pseudoHash(ix, iz);
  const b = pseudoHash(ix + 1, iz);
  const c = pseudoHash(ix, iz + 1);
  const d = pseudoHash(ix + 1, iz + 1);

  return a * (1 - ux) * (1 - uz) +
         b * ux * (1 - uz) +
         c * (1 - ux) * uz +
         d * ux * uz;
}

export function evaluateElevation(x: number, z: number, octaves = 5, maxAltitude = 160): number {
  let elevation = 0;
  let freq = 0.0018;
  let amp = maxAltitude;
  let weight = 1.0;

  for (let o = 0; o < octaves; o++) {
    const n = smoothNoise(x * freq, z * freq);
    // Ridged multifractal shaping for sharp mountain crests and glacial cirques
    const ridged = 1.0 - Math.abs(n * 2.0 - 1.0);
    elevation += ridged * amp * weight;

    freq *= 2.1;
    amp *= 0.48;
    weight = Math.min(1.0, elevation / (maxAltitude * 0.45));
  }

  // Valley base flattening
  return elevation - maxAltitude * 0.25;
}

export function computeTerrainNormal(x: number, z: number, step = 2.0, maxAltitude = 160): [number, number, number] {
  const hL = evaluateElevation(x - step, z, 4, maxAltitude);
  const hR = evaluateElevation(x + step, z, 4, maxAltitude);
  const hD = evaluateElevation(x, z - step, 4, maxAltitude);
  const hU = evaluateElevation(x, z + step, 4, maxAltitude);

  const nx = -(hR - hL) / (2 * step);
  const nz = -(hU - hD) / (2 * step);
  const ny = 1.0;

  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

export type BiomeType = 'water' | 'sand' | 'grass' | 'rock' | 'snow';

export function classifyBiome(
  height: number,
  slope: number,
  waterLevel = 10,
  snowLevel = 110,
): BiomeType {
  if (height <= waterLevel) {
    return 'water';
  }
  if (height <= waterLevel + 5) {
    return 'sand';
  }
  if (height >= snowLevel && slope < 0.55) {
    return 'snow';
  }
  if (slope > 0.45 || height > snowLevel * 0.8) {
    return 'rock';
  }
  return 'grass';
}

export interface TerrainMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

export function generateTerrainGrid(
  cols: number,
  rows: number,
  size: number,
  options: { maxAltitude?: number; octaves?: number } = {},
): TerrainMesh {
  const maxAltitude = options.maxAltitude ?? 160;
  const octaves = options.octaves ?? 5;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const half = size / 2;
  const stepX = size / cols;
  const stepZ = size / rows;

  for (let r = 0; r <= rows; r++) {
    const z = -half + r * stepZ;
    for (let c = 0; c <= cols; c++) {
      const x = -half + c * stepX;
      const y = evaluateElevation(x, z, octaves, maxAltitude);
      const normal = computeTerrainNormal(x, z, stepX * 0.5, maxAltitude);

      positions.push(x, y, z);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(c / cols, r / rows);
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * (cols + 1) + c;
      const next = idx + (cols + 1);

      indices.push(idx, next, idx + 1);
      indices.push(next, next + 1, idx + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}
