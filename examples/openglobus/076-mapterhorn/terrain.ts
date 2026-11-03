export interface TerrainMesh {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** Convert Mapterhorn's RGB Terrarium pixels into metre elevations. */
export function decodeTerrarium(rgba: Uint8Array, width: number, height: number): Float32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) {
    throw new RangeError('Terrarium pixel count does not match its dimensions');
  }
  const elevations = new Float32Array(width * height);
  for (let pixel = 0; pixel < elevations.length; pixel++) {
    const i = pixel * 4;
    elevations[pixel] = rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768;
  }
  return elevations;
}

const STOPS: [number, [number, number, number]][] = [
  [0, [0.035, 0.14, 0.28]],
  [1, [0.13, 0.36, 0.2]],
  [1500, [0.42, 0.39, 0.31]],
  [3000, [0.73, 0.7, 0.62]],
  [4000, [0.92, 0.95, 1]],
];

export function hypsometricColor(elevation: number): [number, number, number] {
  if (elevation < 0) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [upper, color] = STOPS[i];
    const [lower, previous] = STOPS[i - 1];
    if (elevation <= upper) {
      const t = (elevation - lower) / (upper - lower);
      return [
        previous[0] + (color[0] - previous[0]) * t,
        previous[1] + (color[1] - previous[1]) * t,
        previous[2] + (color[2] - previous[2]) * t,
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** Downsample a height raster into a centered, indexed grid ready for one GPU upload. */
export function createTerrainMesh(
  elevations: Float32Array,
  width: number,
  height: number,
  columns: number,
  rows: number,
  verticalScale: number,
): TerrainMesh {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || elevations.length !== width * height
    || !Number.isInteger(columns) || !Number.isInteger(rows) || columns < 2 || rows < 2
    || !Number.isFinite(verticalScale) || verticalScale <= 0) {
    throw new RangeError('Terrain mesh dimensions or vertical scale are invalid');
  }
  let minimum = Infinity;
  for (const elevation of elevations) minimum = Math.min(minimum, elevation);
  const positions = new Float32Array(columns * rows * 3);
  const colors = new Float32Array(columns * rows * 3);
  for (let row = 0; row < rows; row++) {
    const sourceY = Math.round(row * (height - 1) / (rows - 1));
    for (let column = 0; column < columns; column++) {
      const sourceX = Math.round(column * (width - 1) / (columns - 1));
      const elevation = elevations[sourceY * width + sourceX];
      const vertex = row * columns + column;
      positions.set([
        column * 2 / (columns - 1) - 1,
        row * 2 / (rows - 1) - 1,
        (elevation - minimum) * verticalScale,
      ], vertex * 3);
      colors.set(hypsometricColor(elevation), vertex * 3);
    }
  }
  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
  let offset = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.set([a, b, c, b, d, c], offset);
      offset += 6;
    }
  }
  return { positions, colors, indices };
}

export function orbitCamera(yaw: number, pitch: number, dx: number, dy: number): [number, number] {
  return [yaw + dx * 0.015, Math.max(0.25, Math.min(1.2, pitch + dy * 0.005))];
}

export function zoomTerrain(distance: number, deltaY: number): number {
  return Math.max(2.4, Math.min(8, distance + deltaY * 0.004));
}
