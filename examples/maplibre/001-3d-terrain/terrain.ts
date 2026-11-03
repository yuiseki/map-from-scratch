export interface TerrainMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

// Compute elevation in meters at local offset (x, y) from Fuji summit
export function computeFujiElevation(x: number, y: number): number {
  const r = Math.hypot(x, y);
  const RIM_R = 350;
  const PEAK_Z = 3776;

  let baseH: number;
  if (r <= RIM_R) {
    // Caldera crater floor drops 220m from summit rim
    const t = r / RIM_R;
    baseH = PEAK_Z - (1 - Math.sin(t * (Math.PI / 2))) * 220;
  } else {
    // Stratovolcano cone slope
    baseH = PEAK_Z * Math.exp(-Math.pow((r - RIM_R) / 6200, 1.25));
  }

  // Radial volcanic ravines / Osawa Kuzure
  const angle = Math.atan2(y, x);
  const ridges = Math.sin(angle * 8) * 35 * Math.exp(-r / 7500) * (r > 600 ? 1 : 0);
  const foothills = Math.sin(x * 0.0004) * Math.cos(y * 0.0004) * 80;

  return Math.max(250, baseH + ridges + foothills);
}

export function getHypsometricColor(height: number): [number, number, number] {
  if (height >= 3100) {
    // Snow-capped summit (bright white / pale glacial blue)
    const t = Math.min(1, (height - 3100) / 676);
    return [0.93 + 0.07 * t, 0.95 + 0.05 * t, 0.98 + 0.02 * t];
  } else if (height >= 2100) {
    // Volcanic scree / reddish dark basalt rock
    const t = (height - 2100) / 1000;
    return [
      0.45 + 0.48 * t,
      0.35 + 0.60 * t,
      0.32 + 0.66 * t,
    ];
  } else if (height >= 1100) {
    // Subalpine conifer forest (deep lush green)
    const t = (height - 1100) / 1000;
    return [
      0.22 + 0.23 * t,
      0.42 - 0.07 * t,
      0.18 + 0.14 * t,
    ];
  } else {
    // Foothills, lakeshore pasture, and lower plateau
    const t = Math.max(0, (height - 250) / 850);
    return [
      0.28 - 0.06 * t,
      0.54 - 0.12 * t,
      0.25 - 0.07 * t,
    ];
  }
}

export function generateTerrainMesh(cols: number, rows: number, extent: number): TerrainMesh {
  const numVerts = (cols + 1) * (rows + 1);
  const positions = new Float32Array(numVerts * 3);
  const normals = new Float32Array(numVerts * 3);
  const colors = new Float32Array(numVerts * 3);

  const stepX = (extent * 2) / cols;
  const stepY = (extent * 2) / rows;

  let vPtr = 0;
  for (let r = 0; r <= rows; r++) {
    const y = -extent + r * stepY;
    for (let c = 0; c <= cols; c++) {
      const x = -extent + c * stepX;
      const z = computeFujiElevation(x, y);

      positions[vPtr] = x;
      positions[vPtr + 1] = y;
      positions[vPtr + 2] = z;

      // Gradient for normal vector: finite differences
      const delta = 15;
      const dzdx = (computeFujiElevation(x + delta, y) - computeFujiElevation(x - delta, y)) / (2 * delta);
      const dzdy = (computeFujiElevation(x, y + delta) - computeFujiElevation(x, y - delta)) / (2 * delta);

      let nx = -dzdx;
      let ny = -dzdy;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;

      normals[vPtr] = nx;
      normals[vPtr + 1] = ny;
      normals[vPtr + 2] = nz;

      const rgb = getHypsometricColor(z);
      colors[vPtr] = rgb[0];
      colors[vPtr + 1] = rgb[1];
      colors[vPtr + 2] = rgb[2];

      vPtr += 3;
    }
  }

  const indices = new Uint32Array(cols * rows * 6);
  let iPtr = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c;
      const i1 = i0 + 1;
      const i2 = (r + 1) * (cols + 1) + c;
      const i3 = i2 + 1;

      // Triangle 1: i0 -> i2 -> i1
      indices[iPtr++] = i0;
      indices[iPtr++] = i2;
      indices[iPtr++] = i1;

      // Triangle 2: i1 -> i2 -> i3
      indices[iPtr++] = i1;
      indices[iPtr++] = i2;
      indices[iPtr++] = i3;
    }
  }

  return { positions, normals, colors, indices };
}
