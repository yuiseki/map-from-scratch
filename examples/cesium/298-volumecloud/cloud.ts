export type Vec3 = [number, number, number];

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v: Vec3): Vec3 {
  const len = length(v) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Calculates ray-sphere intersection distances [t_near, t_far].
 * Returns null if the ray does not intersect or is entirely behind the ray.
 */
export function raySphereIntersect(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  radius: number,
): [number, number] | null {
  const lx = origin[0] - center[0];
  const ly = origin[1] - center[1];
  const lz = origin[2] - center[2];

  const a = dot(dir, dir);
  const b = 2.0 * (lx * dir[0] + ly * dir[1] + lz * dir[2]);
  const c = lx * lx + ly * ly + lz * lz - radius * radius;

  const disc = b * b - 4.0 * a * c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t0 = (-b - sqrtDisc) / (2.0 * a);
  const t1 = (-b + sqrtDisc) / (2.0 * a);

  if (t1 < 0) return null; // Sphere is behind ray origin

  const tNear = Math.max(0.0, t0);
  const tFar = t1;
  return [tNear, tFar];
}

/**
 * Calculates entry and exit ray distances through an atmospheric spherical shell.
 */
export function rayCloudLayerBounds(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  innerRadius: number,
  outerRadius: number,
): [number, number] | null {
  const outerHit = raySphereIntersect(origin, dir, center, outerRadius);
  if (!outerHit) return null;

  const innerHit = raySphereIntersect(origin, dir, center, innerRadius);

  const distToCenter = Math.hypot(origin[0] - center[0], origin[1] - center[1], origin[2] - center[2]);

  if (distToCenter >= outerRadius) {
    // Camera is outside outer sphere
    const tNear = outerHit[0];
    const tFar = innerHit ? innerHit[0] : outerHit[1];
    return [tNear, tFar];
  } else if (distToCenter <= innerRadius) {
    // Camera is inside earth sphere
    if (!innerHit) return null;
    return [innerHit[1], outerHit[1]];
  } else {
    // Camera is inside cloud layer
    const tNear = 0.0;
    const tFar = innerHit ? innerHit[0] : outerHit[1];
    return [tNear, tFar];
  }
}

/**
 * Computes light transmittance according to the Beer-Lambert law: T = exp(-extinction * density * stepSize)
 */
export function beerLambert(density: number, stepSize: number, extinction: number): number {
  if (density <= 0 || stepSize <= 0) return 1.0;
  return Math.exp(-extinction * density * stepSize);
}

/**
 * Henyey-Greenstein anisotropic phase function for forward/backward cloud droplet scattering.
 */
export function henyeyGreenstein(cosTheta: number, g: number): number {
  const g2 = g * g;
  const denom = 4.0 * Math.PI * Math.pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
  return (1.0 - g2) / Math.max(1e-5, denom);
}

// Deterministic hash noise helper
function hash31(p: Vec3): number {
  const h = Math.sin(p[0] * 127.1 + p[1] * 311.7 + p[2] * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

/**
 * Procedural 3D noise sample representing atmospheric cloud density in range [0, 1].
 */
export function cloudDensityAt(pos: Vec3, normAlt: number, time: number): number {
  if (normAlt < 0.0 || normAlt > 1.0) return 0.0;

  // Height profile: soft curve peaking around mid-troposphere
  const heightProfile = 4.0 * normAlt * (1.0 - normAlt);

  // Multi-octave sinusoidal cloud density perturbation
  const scale = 0.4;
  const px = pos[0] * scale + time * 0.02;
  const py = pos[1] * scale;
  const pz = pos[2] * scale + time * 0.015;

  const n1 = Math.sin(px * 1.5 + Math.cos(py * 2.1 + pz * 1.7)) * 0.5 + 0.5;
  const n2 = Math.sin(px * 3.3 - pz * 2.8 + Math.cos(py * 3.5)) * 0.5 + 0.5;
  const n3 = Math.cos(px * 7.1 + py * 6.3 - pz * 5.9) * 0.5 + 0.5;

  const fbm = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;

  // Threshold coverage
  const density = Math.max(0.0, Math.min(1.0, (fbm - 0.35) * 1.8 * heightProfile));
  return density;
}

export function computeSunDirection(azimuth: number, elevation: number): Vec3 {
  const cosEl = Math.cos(elevation);
  return normalize([
    Math.sin(azimuth) * cosEl,
    Math.sin(elevation),
    Math.cos(azimuth) * cosEl,
  ]);
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

export function mat4LookAt(out: Float32Array, eye: Vec3, center: Vec3, up: Vec3): void {
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

export function mat4Invert(out: Float32Array, m: Float32Array): boolean {
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];

  const b00 = m00 * m11 - m01 * m10;
  const b01 = m00 * m12 - m02 * m10;
  const b02 = m00 * m13 - m03 * m10;
  const b03 = m01 * m12 - m02 * m11;
  const b04 = m01 * m13 - m03 * m11;
  const b05 = m02 * m13 - m03 * m12;
  const b06 = m20 * m31 - m21 * m30;
  const b07 = m20 * m32 - m22 * m30;
  const b08 = m20 * m33 - m23 * m30;
  const b09 = m21 * m32 - m22 * m31;
  const b10 = m21 * m33 - m23 * m31;
  const b11 = m22 * m33 - m23 * m32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return false;
  const invDet = 1.0 / det;

  out[0] = (m11 * b11 - m12 * b10 + m13 * b09) * invDet;
  out[1] = (-m01 * b11 + m02 * b10 - m03 * b09) * invDet;
  out[2] = (m31 * b05 - m32 * b04 + m33 * b03) * invDet;
  out[3] = (-m21 * b05 + m22 * b04 - m23 * b03) * invDet;
  out[4] = (-m10 * b11 + m12 * b08 - m13 * b07) * invDet;
  out[5] = (m00 * b11 - m02 * b08 + m03 * b07) * invDet;
  out[6] = (-m30 * b05 + m32 * b02 - m33 * b01) * invDet;
  out[7] = (m20 * b05 - m22 * b02 + m23 * b01) * invDet;
  out[8] = (m10 * b10 - m11 * b08 + m13 * b06) * invDet;
  out[9] = (-m00 * b10 + m01 * b08 - m03 * b06) * invDet;
  out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * invDet;
  out[11] = (-m20 * b04 + m21 * b02 - m23 * b00) * invDet;
  out[12] = (-m10 * b09 + m11 * b07 - m12 * b06) * invDet;
  out[13] = (m00 * b09 - m01 * b07 + m02 * b06) * invDet;
  out[14] = (-m30 * b03 + m31 * b01 - m32 * b00) * invDet;
  out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * invDet;

  return true;
}

