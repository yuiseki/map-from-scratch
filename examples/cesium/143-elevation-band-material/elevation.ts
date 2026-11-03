/**
 * 3D Terrain mesh generator and Elevation Band classification
 * for Cesium Elevation Band Material reproduction.
 * Zero external runtime dependencies.
 */

export interface ElevationBand {
  minHeight: number;
  maxHeight: number;
  color: [number, number, number, number]; // RGBA [0-255]
}

export const DEFAULT_ELEVATION_BANDS: ElevationBand[] = [
  { minHeight: 0, maxHeight: 1000, color: [46, 125, 50, 255] },     // Valley forest green
  { minHeight: 1000, maxHeight: 1800, color: [139, 195, 74, 255] }, // Subalpine light green
  { minHeight: 1800, maxHeight: 2500, color: [255, 238, 88, 255] }, // Alpine meadow yellow/gold
  { minHeight: 2500, maxHeight: 3200, color: [245, 124, 0, 255] },  // Rocky scree orange
  { minHeight: 3200, maxHeight: 4200, color: [255, 255, 255, 255] },// Summit snow white
];

export function computeElevationBandColor(
  height: number,
  bands: ElevationBand[] = DEFAULT_ELEVATION_BANDS,
): [number, number, number, number] {
  for (const band of bands) {
    if (height >= band.minHeight && height < band.maxHeight) {
      return band.color;
    }
  }
  if (height >= bands[bands.length - 1].maxHeight) {
    return bands[bands.length - 1].color;
  }
  return bands[0].color;
}

export interface TerrainMesh {
  positions: Float32Array;
  normals: Float32Array;
  elevations: Float32Array;
  indices: Uint16Array;
}

function sampleHeight(x: number, z: number, maxHeight: number): number {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);

  // Volcanic cone exponential falloff
  const cone = maxHeight * Math.exp(-Math.pow(r / 6500, 1.3));

  // Radial erosion gullies & ridges
  const ridge = 1.0 + 0.08 * Math.cos(8 * theta) + 0.04 * Math.sin(14 * theta);
  let h = cone * ridge;

  // Summit caldera crater depression (r < 700m)
  if (r < 700) {
    const crater = 200 * Math.exp(-Math.pow(r / 350, 2));
    h -= crater;
  }

  // Foothills undulation
  const hills = 120 * Math.sin(x * 0.0008) * Math.cos(z * 0.0008);
  h = Math.max(80, h + hills);

  return h;
}

export function generateMountainTerrain(gridSize: number, maxHeight = 3776): TerrainMesh {
  const vertexCount = (gridSize + 1) * (gridSize + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const elevations = new Float32Array(vertexCount);

  const halfExtent = 18000; // 36km x 36km area
  const step = (halfExtent * 2) / gridSize;

  let vIdx = 0;
  let eIdx = 0;

  for (let gz = 0; gz <= gridSize; gz++) {
    const z = -halfExtent + gz * step;
    for (let gx = 0; gx <= gridSize; gx++) {
      const x = -halfExtent + gx * step;

      const y = sampleHeight(x, z, maxHeight);

      positions[vIdx] = x;
      positions[vIdx + 1] = y;
      positions[vIdx + 2] = z;

      elevations[eIdx++] = y;

      // Normal by finite differences
      const delta = step * 0.5;
      const hL = sampleHeight(x - delta, z, maxHeight);
      const hR = sampleHeight(x + delta, z, maxHeight);
      const hD = sampleHeight(x, z - delta, maxHeight);
      const hU = sampleHeight(x, z + delta, maxHeight);

      const nx = -(hR - hL);
      const ny = 2 * delta;
      const nz = -(hU - hD);
      const len = Math.hypot(nx, ny, nz);

      normals[vIdx] = nx / len;
      normals[vIdx + 1] = ny / len;
      normals[vIdx + 2] = nz / len;

      vIdx += 3;
    }
  }

  const indexCount = gridSize * gridSize * 6;
  const indices = new Uint16Array(indexCount);
  let iIdx = 0;

  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const row1 = gz * (gridSize + 1) + gx;
      const row2 = (gz + 1) * (gridSize + 1) + gx;

      indices[iIdx++] = row1;
      indices[iIdx++] = row2;
      indices[iIdx++] = row1 + 1;

      indices[iIdx++] = row2;
      indices[iIdx++] = row2 + 1;
      indices[iIdx++] = row1 + 1;
    }
  }

  return { positions, normals, elevations, indices };
}
