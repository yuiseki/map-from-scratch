// Helper module for GridCellLayer 3D cubes and GC01 grid data.

export interface GridCell {
  ix: number;
  iy: number;
  count: number;
  quantile: number;
}

export interface GridDataset {
  count: number;
  size: number;
  cells: GridCell[];
}

export function gridToWorld(ix: number, iy: number, cellSize: number): [number, number] {
  return [ix * cellSize, iy * cellSize];
}

// Unit cube with top face and 4 vertical sides (5 faces * 2 triangles * 3 vertices = 30 vertices)
// Base face (bottom, z=0) omitted as it sits on the ground.
export function createUnitCubeMesh(): Float32Array {
  const stride = 6; // pos: vec3f, normal: vec3f
  const data = new Float32Array(30 * stride);
  let offset = 0;

  const pushV = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    const idx = offset * stride;
    data[idx] = x; data[idx + 1] = y; data[idx + 2] = z;
    data[idx + 3] = nx; data[idx + 4] = ny; data[idx + 5] = nz;
    offset++;
  };

  const pushQuad = (
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    p4: [number, number, number],
    n: [number, number, number],
  ) => {
    // 2 triangles: p1-p2-p3 and p1-p3-p4
    pushV(p1[0], p1[1], p1[2], n[0], n[1], n[2]);
    pushV(p2[0], p2[1], p2[2], n[0], n[1], n[2]);
    pushV(p3[0], p3[1], p3[2], n[0], n[1], n[2]);

    pushV(p1[0], p1[1], p1[2], n[0], n[1], n[2]);
    pushV(p3[0], p3[1], p3[2], n[0], n[1], n[2]);
    pushV(p4[0], p4[1], p4[2], n[0], n[1], n[2]);
  };

  // 1. Top face (z = 1)
  pushQuad([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]);

  // 2. North face (y = 1)
  pushQuad([1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1], [0, 1, 0]);

  // 3. South face (y = 0)
  pushQuad([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, -1, 0]);

  // 4. East face (x = 1)
  pushQuad([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], [1, 0, 0]);

  // 5. West face (x = 0)
  pushQuad([0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1], [-1, 0, 0]);

  return data;
}

// Color ramp: warm lime (#d7e354) -> emerald (#2bb673) -> ocean cyan (#00a8cc) -> purple/indigo (#49227d)
export function treeDensityColor(count: number, maxCount: number): [number, number, number, number] {
  if (count <= 0) return [0.2, 0.4, 0.3, 0.8];
  const t = Math.min(1.0, Math.max(0.0, Math.log10(count + 1) / Math.max(1.0, Math.log10(maxCount + 1))));

  let r = 0, g = 0, b = 0;
  if (t < 0.33) {
    const s = t / 0.33;
    r = 0.84 - s * 0.67; g = 0.89 + s * 0.05; b = 0.33 + s * 0.12;
  } else if (t < 0.66) {
    const s = (t - 0.33) / 0.33;
    r = 0.17 - s * 0.17; g = 0.94 - s * 0.28; b = 0.45 + s * 0.35;
  } else {
    const s = (t - 0.66) / 0.34;
    r = 0.0 + s * 0.29;  g = 0.66 - s * 0.53; b = 0.80 + s * 0.15;
  }
  return [r, g, b, 0.92];
}

export function decodeGridCells(buffer: ArrayBuffer): GridDataset {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'GC01') throw new Error(`Invalid magic: ${magic}`);

  const count = view.getUint32(4, true);
  const size = view.getUint32(8, true);

  const cells: GridCell[] = new Array(count);
  let offset = 12;
  for (let i = 0; i < count; i++) {
    const ix = view.getInt16(offset, true);
    const iy = view.getInt16(offset + 2, true);
    const cellCount = view.getUint16(offset + 4, true);
    const quantile = view.getUint16(offset + 6, true);
    cells[i] = { ix, iy, count: cellCount, quantile };
    offset += 8;
  }

  return { count, size, cells };
}
