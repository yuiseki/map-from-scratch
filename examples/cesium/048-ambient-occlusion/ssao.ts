export interface CityMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
}

/**
 * Generates hemisphere sample vectors for SSAO, clustered near the origin.
 */
export function generateSampleKernel(size: number): Float32Array {
  const kernel = new Float32Array(size * 3);

  for (let i = 0; i < size; i++) {
    // Deterministic pseudo-random sequence
    const rx = Math.sin((i + 1) * 12.9898) * 43758.5453;
    const ry = Math.cos((i + 1) * 78.233) * 43758.5453;
    const rz = Math.sin((i + 1) * 37.719) * 43758.5453;

    let x = (rx - Math.floor(rx)) * 2.0 - 1.0;
    let y = (ry - Math.floor(ry)) * 2.0 - 1.0;
    let z = (rz - Math.floor(rz)); // [0, 1] hemisphere

    const len = Math.hypot(x, y, z) || 1;
    x /= len;
    y /= len;
    z /= len;

    // Scale sample quadratically to cluster near origin
    let scale = (i + 1) / size;
    scale = 0.1 + scale * scale * 0.9;

    kernel[i * 3 + 0] = x * scale;
    kernel[i * 3 + 1] = y * scale;
    kernel[i * 3 + 2] = z * scale;
  }

  return kernel;
}

/**
 * Generates a 4x4 rotation noise texture for randomizing SSAO kernel orientation.
 */
export function generateNoiseTexture(dim: number): Float32Array {
  const noise = new Float32Array(dim * dim * 3);

  for (let i = 0; i < dim * dim; i++) {
    const rx = Math.sin((i + 1) * 91.345) * 43758.5453;
    const ry = Math.cos((i + 1) * 47.812) * 43758.5453;

    let x = (rx - Math.floor(rx)) * 2.0 - 1.0;
    let y = (ry - Math.floor(ry)) * 2.0 - 1.0;
    const len = Math.hypot(x, y) || 1;
    x /= len;
    y /= len;

    noise[i * 3 + 0] = x;
    noise[i * 3 + 1] = y;
    noise[i * 3 + 2] = 0.0;
  }

  return noise;
}

/**
 * Computes the distance-attenuated occlusion factor between a sample depth and an occluder depth.
 */
export function computeOcclusionFactor(sampleDepth: number, occluderDepth: number, radius: number): number {
  if (occluderDepth > sampleDepth) return 0.0;
  const diff = sampleDepth - occluderDepth;
  if (diff > radius) return 0.0;

  // Smooth quadratic falloff within radius
  const norm = 1.0 - (diff / radius);
  return norm * norm;
}

/**
 * Procedural 3D urban canyon city geometry.
 */
export function buildBlockCityGeometry(gridX: number, gridZ: number): CityMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  let vertCount = 0;

  function addQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    n: [number, number, number],
    rgba: [number, number, number, number],
  ) {
    positions.push(...p0, ...p1, ...p2, ...p3);
    for (let i = 0; i < 4; i++) {
      normals.push(...n);
      colors.push(...rgba);
    }
    indices.push(
      vertCount, vertCount + 1, vertCount + 2,
      vertCount, vertCount + 2, vertCount + 3,
    );
    vertCount += 4;
  }

  function addBox(
    cx: number, cz: number,
    w: number, d: number, h: number,
    rgba: [number, number, number, number],
  ) {
    const x0 = cx - w * 0.5, x1 = cx + w * 0.5;
    const z0 = cz - d * 0.5, z1 = cz + d * 0.5;

    // Top (+Y)
    addQuad([x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0], [0, 1, 0], rgba);
    // Front (+Z)
    addQuad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1], rgba);
    // Back (-Z)
    addQuad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [0, 0, -1], rgba);
    // Right (+X)
    addQuad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [1, 0, 0], rgba);
    // Left (-X)
    addQuad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [-1, 0, 0], rgba);
  }

  // Base ground plane
  const groundSize = 100.0;
  addQuad(
    [-groundSize, 0, -groundSize],
    [-groundSize, 0, groundSize],
    [groundSize, 0, groundSize],
    [groundSize, 0, -groundSize],
    [0, 1, 0],
    [0.72, 0.74, 0.76, 1.0],
  );

  // Urban block city grid with varying tower heights
  const spacing = 12.0;
  const startX = -((gridX - 1) * spacing) * 0.5;
  const startZ = -((gridZ - 1) * spacing) * 0.5;

  for (let gx = 0; gx < gridX; gx++) {
    for (let gz = 0; gz < gridZ; gz++) {
      const cx = startX + gx * spacing;
      const cz = startZ + gz * spacing;

      // Deterministic pseudo-random building properties
      const seed = Math.sin(gx * 7.1 + gz * 13.9) * 43758.5453;
      const frac = seed - Math.floor(seed);

      const bw = 7.0 + frac * 2.0;
      const bd = 7.0 + (1.0 - frac) * 2.0;
      const bh = 10.0 + frac * 32.0;

      // Subtle architectural shade variation
      const baseLuma = 0.65 + frac * 0.25;
      const buildingColor: [number, number, number, number] = [
        baseLuma * 0.95,
        baseLuma,
        baseLuma * 1.05,
        1.0,
      ];

      addBox(cx, cz, bw, bd, bh, buildingColor);

      // Rooftop utility structures
      if (bh > 20.0) {
        addBox(cx, cz, bw * 0.45, bd * 0.45, bh + 4.0, [0.55, 0.55, 0.60, 1.0]);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices),
  };
}

export function mat4Perspective(out: Float32Array, fovy: number, aspect: number, near: number, far: number): void {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = (2 * far * near) * nf;
}

export function mat4LookAt(out: Float32Array, eye: [number, number, number], center: [number, number, number], up: [number, number, number]): void {
  let z0 = eye[0] - center[0];
  let z1 = eye[1] - center[1];
  let z2 = eye[2] - center[2];
  let len = Math.hypot(z0, z1, z2) || 1;
  z0 /= len; z1 /= len; z2 /= len;

  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  len = Math.hypot(x0, x1, x2) || 1;
  x0 /= len; x1 /= len; x2 /= len;

  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;

  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
}

export function mat4Multiply(out: Float32Array, a: Float32Array, b: Float32Array): void {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[c * 4 + r] =
        a[r + 0] * b[c * 4 + 0] +
        a[r + 4] * b[c * 4 + 1] +
        a[r + 8] * b[c * 4 + 2] +
        a[r + 12] * b[c * 4 + 3];
    }
  }
}

