/**
 * 3D Volumetric Cumulus Clouds Simulation for CesiumJS Clouds reproduction.
 * Zero external runtime dependencies.
 */

export interface CloudPuff {
  x: number;
  y: number;
  z: number;
  radius: number;
  density: number;
  clusterId: number;
}

export function createCumulusClouds(
  clusterCount: number,
  puffsPerCluster: number,
  bounds: [number, number, number],
  baseAltitude = 300,
): CloudPuff[] {
  const [w, h, d] = bounds;
  const puffs: CloudPuff[] = [];

  for (let c = 0; c < clusterCount; c++) {
    // Cluster center
    const cx = (Math.random() - 0.5) * (w * 0.8);
    const cy = baseAltitude + (Math.random() - 0.5) * (h * 0.2);
    const cz = (Math.random() - 0.5) * (d * 0.8);
    const clusterScale = 1.0 + Math.random() * 0.8;

    for (let p = 0; p < puffsPerCluster; p++) {
      // Offset puff within cluster ellipsoid (wider horizontally, flatter vertically)
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.6) * 140 * clusterScale;
      const offX = Math.cos(angle) * dist;
      const offZ = Math.sin(angle) * dist;
      // Cumulus base is flat, top has cauliflower domed towers
      const heightFrac = Math.max(0, 1.0 - (dist / (140 * clusterScale)));
      const offY = (Math.random() * 0.6 + heightFrac * 0.6) * 60 * clusterScale;

      const radius = (35 + Math.random() * 45) * clusterScale;
      const density = 0.7 + Math.random() * 0.3;

      puffs.push({
        x: cx + offX,
        y: cy + offY,
        z: cz + offZ,
        radius,
        density,
        clusterId: c,
      });
    }
  }

  return puffs;
}

export function updateClouds(
  puffs: CloudPuff[],
  dt: number,
  wind: [number, number, number],
  bounds: [number, number, number],
): void {
  const [w, , d] = bounds;
  const halfW = w / 2;
  const halfD = d / 2;

  const dx = wind[0] * dt;
  const dy = wind[1] * dt;
  const dz = wind[2] * dt;

  for (let i = 0; i < puffs.length; i++) {
    const p = puffs[i];
    p.x += dx;
    p.y += dy;
    p.z += dz;

    // Wrap boundaries
    if (p.x < -halfW) p.x += w;
    if (p.x > halfW) p.x -= w;
    if (p.z < -halfD) p.z += d;
    if (p.z > halfD) p.z -= d;
  }
}

export function packCloudPuffs(puffs: CloudPuff[]): Float32Array {
  const stride = 5; // x, y, z, radius, density
  const buf = new Float32Array(puffs.length * stride);
  let offset = 0;
  for (let i = 0; i < puffs.length; i++) {
    const p = puffs[i];
    buf[offset++] = p.x;
    buf[offset++] = p.y;
    buf[offset++] = p.z;
    buf[offset++] = p.radius;
    buf[offset++] = p.density;
  }
  return buf;
}
