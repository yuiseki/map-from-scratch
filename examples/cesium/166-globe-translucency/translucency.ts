export type Vec3 = [number, number, number];

export interface SubterraneanFeature {
  pos: Vec3;
  depth: number;
  type: 'magma_chamber' | 'seismic_fault' | 'core_plume';
}

export interface SphereGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

export interface LayeredGlobeMesh {
  crustPositions: Float32Array;
  crustNormals: Float32Array;
  crustIndices: Uint16Array;

  mantlePositions: Float32Array;
  mantleNormals: Float32Array;
  mantleIndices: Uint16Array;

  corePositions: Float32Array;
  coreNormals: Float32Array;
  coreIndices: Uint16Array;
}

/**
 * Calculates Fresnel limb opacity for translucent planetary shell:
 * Translucent when looking straight through (cosTheta = 1),
 * ramping up to higher opacity near grazing angles (cosTheta = 0).
 */
export function calculateFresnelAlpha(cosTheta: number, baseAlpha: number, power: number): number {
  const c = Math.max(0, Math.min(1, cosTheta));
  const limbFactor = Math.pow(1 - c, power);
  return baseAlpha * 0.2 + (1.0 - baseAlpha * 0.2) * limbFactor;
}

/**
 * Creates a sphere mesh of given radius and subdivisions.
 */
function createSphereGeometry(latSegments: number, lonSegments: number, radius: number): SphereGeometry {
  const numVertices = (latSegments + 1) * (lonSegments + 1);
  const positions = new Float32Array(numVertices * 3);
  const normals = new Float32Array(numVertices * 3);

  let vIdx = 0;
  for (let lat = 0; lat <= latSegments; lat++) {
    const theta = (lat / latSegments) * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= lonSegments; lon++) {
      const phi = (lon / lonSegments) * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const nx = sinTheta * cosPhi;
      const ny = cosTheta;
      const nz = sinTheta * sinPhi;

      const pOffset = vIdx * 3;
      positions[pOffset + 0] = nx * radius;
      positions[pOffset + 1] = ny * radius;
      positions[pOffset + 2] = nz * radius;

      normals[pOffset + 0] = nx;
      normals[pOffset + 1] = ny;
      normals[pOffset + 2] = nz;

      vIdx++;
    }
  }

  const numQuads = latSegments * lonSegments;
  const indices = new Uint16Array(numQuads * 6);
  let iIdx = 0;
  for (let lat = 0; lat < latSegments; lat++) {
    for (let lon = 0; lon < lonSegments; lon++) {
      const first = lat * (lonSegments + 1) + lon;
      const second = first + lonSegments + 1;

      indices[iIdx++] = first;
      indices[iIdx++] = second;
      indices[iIdx++] = first + 1;

      indices[iIdx++] = second;
      indices[iIdx++] = second + 1;
      indices[iIdx++] = first + 1;
    }
  }

  return { positions, normals, indices };
}

/**
 * Generates layered planetary interior & exterior meshes:
 * 1. Outer translucent crust (radius R)
 * 2. Convective mantle shell (radius 0.65 R)
 * 3. Radiant inner core (radius 0.30 R)
 */
export function generateLayeredGlobeMesh(latSegments: number, lonSegments: number, radius: number): LayeredGlobeMesh {
  const crust = createSphereGeometry(latSegments, lonSegments, radius);
  const mantle = createSphereGeometry(latSegments, lonSegments, radius * 0.65);
  const core = createSphereGeometry(Math.max(12, Math.floor(latSegments / 2)), Math.max(24, Math.floor(lonSegments / 2)), radius * 0.30);

  return {
    crustPositions: crust.positions,
    crustNormals: crust.normals,
    crustIndices: crust.indices,

    mantlePositions: mantle.positions,
    mantleNormals: mantle.normals,
    mantleIndices: mantle.indices,

    corePositions: core.positions,
    coreNormals: core.normals,
    coreIndices: core.indices,
  };
}

/**
 * Generates subsurface points situated within planetary interior.
 */
export function generateSubterraneanFeatures(globeRadius: number, count: number): SubterraneanFeature[] {
  const features: SubterraneanFeature[] = [];

  for (let i = 0; i < count; i++) {
    const depthFrac = 0.15 + (i / count) * 0.55; // radii between 0.45 R and 0.85 R
    const r = globeRadius * (1.0 - depthFrac);

    const theta = Math.acos(2 * ((i + 0.5) / count) - 1);
    const phi = (i * 2.3999632) % (Math.PI * 2); // golden angle

    const x = r * Math.sin(theta) * Math.cos(phi);
    const y = r * Math.cos(theta);
    const z = r * Math.sin(theta) * Math.sin(phi);

    features.push({
      pos: [x, y, z],
      depth: depthFrac * globeRadius,
      type: i % 3 === 0 ? 'magma_chamber' : i % 3 === 1 ? 'seismic_fault' : 'core_plume',
    });
  }

  return features;
}
