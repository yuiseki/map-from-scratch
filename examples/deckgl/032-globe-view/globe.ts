export interface SphereMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface ArcGeometry {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

export function latLonToVector3(lat: number, lon: number, r = 1.0): [number, number, number] {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  return [
    r * cosPhi * Math.cos(lambda),
    r * cosPhi * Math.sin(lambda),
    r * Math.sin(phi),
  ];
}

export function interpolateGreatCircleArc(
  startLatLon: [number, number],
  endLatLon: [number, number],
  segments = 32,
  maxAlt = 0.25,
): [number, number, number][] {
  const p1 = latLonToVector3(startLatLon[0], startLatLon[1], 1.0);
  const p2 = latLonToVector3(endLatLon[0], endLatLon[1], 1.0);

  // Angle between p1 and p2
  let dot = p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2];
  dot = Math.max(-1.0, Math.min(1.0, dot));
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);

  const points: [number, number, number][] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let x: number, y: number, z: number;

    if (sinTheta < 1e-5) {
      x = p1[0] * (1 - t) + p2[0] * t;
      y = p1[1] * (1 - t) + p2[1] * t;
      z = p1[2] * (1 - t) + p2[2] * t;
    } else {
      const a = Math.sin((1 - t) * theta) / sinTheta;
      const b = Math.sin(t * theta) / sinTheta;
      x = a * p1[0] + b * p2[0];
      y = a * p1[1] + b * p2[1];
      z = a * p1[2] + b * p2[2];
    }

    // Parabolic altitude profile: 4 * t * (1 - t) reaches 1 at t = 0.5
    const alt = maxAlt * 4 * t * (1 - t);
    const radius = 1.0 + alt;

    const len = Math.hypot(x, y, z);
    points.push([
      (x / len) * radius,
      (y / len) * radius,
      (z / len) * radius,
    ]);
  }

  return points;
}

export function generateSphereMesh(latSegs = 64, lonSegs = 64): SphereMesh {
  const numVerts = (latSegs + 1) * (lonSegs + 1);
  const positions = new Float32Array(numVerts * 3);
  const normals = new Float32Array(numVerts * 3);
  const uvs = new Float32Array(numVerts * 2);

  let vPtr = 0;
  let uvPtr = 0;

  for (let i = 0; i <= latSegs; i++) {
    const lat = -90 + (180 * i) / latSegs;
    const v = i / latSegs;
    for (let j = 0; j <= lonSegs; j++) {
      const lon = -180 + (360 * j) / lonSegs;
      const u = j / lonSegs;

      const p = latLonToVector3(lat, lon, 1.0);
      positions[vPtr] = p[0];
      positions[vPtr + 1] = p[1];
      positions[vPtr + 2] = p[2];

      normals[vPtr] = p[0];
      normals[vPtr + 1] = p[1];
      normals[vPtr + 2] = p[2];

      uvs[uvPtr] = u;
      uvs[uvPtr + 1] = v;

      vPtr += 3;
      uvPtr += 2;
    }
  }

  const indices = new Uint32Array(latSegs * lonSegs * 6);
  let iPtr = 0;

  for (let i = 0; i < latSegs; i++) {
    for (let j = 0; j < lonSegs; j++) {
      const i0 = i * (lonSegs + 1) + j;
      const i1 = i0 + 1;
      const i2 = (i + 1) * (lonSegs + 1) + j;
      const i3 = i2 + 1;

      // Triangle 1
      indices[iPtr++] = i0;
      indices[iPtr++] = i1;
      indices[iPtr++] = i2;

      // Triangle 2
      indices[iPtr++] = i1;
      indices[iPtr++] = i3;
      indices[iPtr++] = i2;
    }
  }

  return { positions, normals, uvs, indices };
}

export interface FlightRoute {
  from: string;
  to: string;
  start: [number, number]; // [lat, lon]
  end: [number, number];
}

export const GLOBAL_FLIGHT_ROUTES: FlightRoute[] = [
  { from: 'Tokyo', to: 'San Francisco', start: [35.6762, 139.6503], end: [37.7749, -122.4194] },
  { from: 'London', to: 'New York', start: [51.5074, -0.1278], end: [40.7128, -74.0060] },
  { from: 'Paris', to: 'Tokyo', start: [48.8566, 2.3522], end: [35.6762, 139.6503] },
  { from: 'Singapore', to: 'Sydney', start: [1.3521, 103.8198], end: [-33.8688, 151.2093] },
  { from: 'New York', to: 'Sao Paulo', start: [40.7128, -74.0060], end: [-23.5505, -46.6333] },
  { from: 'Dubai', to: 'London', start: [25.2048, 55.2708], end: [51.5074, -0.1278] },
  { from: 'Johannesburg', to: 'London', start: [-26.2041, 28.0473], end: [51.5074, -0.1278] },
  { from: 'Los Angeles', to: 'Sydney', start: [34.0522, -118.2437], end: [-33.8688, 151.2093] },
  { from: 'Tokyo', to: 'Singapore', start: [35.6762, 139.6503], end: [1.3521, 103.8198] },
  { from: 'Frankfurt', to: 'Buenos Aires', start: [50.1109, 8.6821], end: [-34.6037, -58.3816] },
  { from: 'Dubai', to: 'Hong Kong', start: [25.2048, 55.2708], end: [22.3193, 114.1694] },
  { from: 'San Francisco', to: 'London', start: [37.7749, -122.4194], end: [51.5074, -0.1278] },
];

export function generateFlightArcsGeometry(routes: FlightRoute[] = GLOBAL_FLIGHT_ROUTES): ArcGeometry {
  const posArr: number[] = [];
  const colArr: number[] = [];

  const segs = 36;
  for (const route of routes) {
    const pts = interpolateGreatCircleArc(route.start, route.end, segs, 0.28);

    for (let i = 0; i < segs; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];

      // Segment line
      posArr.push(p1[0], p1[1], p1[2]);
      posArr.push(p2[0], p2[1], p2[2]);

      const t1 = i / segs;
      const t2 = (i + 1) / segs;

      // Color gradient: warm sunset magenta/orange -> electric cyan/azure
      // Origin: (1.0, 0.35, 0.15) -> Dest: (0.1, 0.9, 1.0)
      const r1 = 1.0 * (1 - t1) + 0.1 * t1;
      const g1 = 0.35 * (1 - t1) + 0.9 * t1;
      const b1 = 0.15 * (1 - t1) + 1.0 * t1;

      const r2 = 1.0 * (1 - t2) + 0.1 * t2;
      const g2 = 0.35 * (1 - t2) + 0.9 * t2;
      const b2 = 0.15 * (1 - t2) + 1.0 * t2;

      colArr.push(r1, g1, b1);
      colArr.push(r2, g2, b2);
    }
  }

  return {
    positions: new Float32Array(posArr),
    colors: new Float32Array(colArr),
    count: posArr.length / 3,
  };
}
