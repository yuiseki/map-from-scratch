export interface CommuteFlow {
  id: string;
  fromName: string;
  toName: string;
  fromLon: number;
  fromLat: number;
  toLon: number;
  toLat: number;
  volume: number; // Daily commuters count
}

export interface ArcMesh {
  positions: Float32Array; // x, y, z in meters
  colors: Float32Array; // r, g, b
  count: number;
}

export const UK_CENTER: [number, number] = [-1.8, 52.6];

export function toLocalMeters(lon: number, lat: number, centerLon: number, centerLat: number): [number, number] {
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegLon = 111320 * Math.cos(latRad);
  const metersPerDegLat = 110540;
  return [
    (lon - centerLon) * metersPerDegLon,
    (lat - centerLat) * metersPerDegLat,
  ];
}

export const UK_CITIES: { name: string; lon: number; lat: number; weight: number }[] = [
  { name: 'London', lon: -0.1278, lat: 51.5074, weight: 1.0 },
  { name: 'Reading', lon: -0.9781, lat: 51.4543, weight: 0.35 },
  { name: 'Oxford', lon: -1.2577, lat: 51.7520, weight: 0.30 },
  { name: 'Cambridge', lon: 0.1218, lat: 52.2053, weight: 0.30 },
  { name: 'Brighton', lon: -0.1372, lat: 50.8225, weight: 0.25 },
  { name: 'Southampton', lon: -1.4043, lat: 50.9097, weight: 0.25 },
  { name: 'Bristol', lon: -2.5879, lat: 51.4545, weight: 0.50 },
  { name: 'Cardiff', lon: -3.1791, lat: 51.4816, weight: 0.40 },
  { name: 'Birmingham', lon: -1.8904, lat: 52.4862, weight: 0.75 },
  { name: 'Coventry', lon: -1.5197, lat: 52.4068, weight: 0.30 },
  { name: 'Leicester', lon: -1.1398, lat: 52.6369, weight: 0.35 },
  { name: 'Nottingham', lon: -1.1581, lat: 52.9548, weight: 0.40 },
  { name: 'Sheffield', lon: -1.4701, lat: 53.3811, weight: 0.45 },
  { name: 'Manchester', lon: -2.2426, lat: 53.4808, weight: 0.70 },
  { name: 'Liverpool', lon: -2.9916, lat: 53.4084, weight: 0.55 },
  { name: 'Leeds', lon: -1.5491, lat: 53.8008, weight: 0.60 },
  { name: 'Newcastle', lon: -1.6178, lat: 54.9783, weight: 0.45 },
];

export function getVolumeColor(vol: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, vol / 35000));
  // Cyan -> Magenta -> Fiery Neon Orange/Yellow
  if (t < 0.35) {
    const s = t / 0.35;
    return [0.10 * (1 - s) + 0.35 * s, 0.85 * (1 - s) + 0.20 * s, 1.0 * (1 - s) + 0.90 * s];
  } else if (t < 0.70) {
    const s = (t - 0.35) / 0.35;
    return [0.35 * (1 - s) + 0.95 * s, 0.20 * (1 - s) + 0.25 * s, 0.90 * (1 - s) + 0.20 * s];
  } else {
    const s = (t - 0.70) / 0.30;
    return [0.95 * (1 - s) + 1.0 * s, 0.25 * (1 - s) + 0.90 * s, 0.20 * (1 - s) + 0.15 * s];
  }
}

export function generateUkCommuteFlows(count = 140): CommuteFlow[] {
  const flows: CommuteFlow[] = [];
  const n = UK_CITIES.length;

  let id = 1;
  for (let i = 0; i < count; i++) {
    const o = i % n;
    let d = (i * 5 + 3) % n;
    if (d === o) d = (d + 1) % n;

    const c1 = UK_CITIES[o];
    const c2 = UK_CITIES[d];

    // Commute volume depends on city weights and distance
    const distDeg = Math.hypot(c2.lon - c1.lon, c2.lat - c1.lat);
    const volume = Math.round(
      Math.max(500, Math.min(48000, 32000 * (c1.weight * c2.weight) / Math.max(0.5, distDeg * 0.8)))
    );

    flows.push({
      id: `flow_${id++}`,
      fromName: c1.name,
      toName: c2.name,
      fromLon: c1.lon,
      fromLat: c1.lat,
      toLon: c2.lon,
      toLat: c2.lat,
      volume,
    });
  }

  return flows;
}

export function buildCommuteArcMesh(flows: CommuteFlow[], center: [number, number]): ArcMesh {
  const posArr: number[] = [];
  const colArr: number[] = [];

  const segs = 32;
  for (const flow of flows) {
    const [x1, y1] = toLocalMeters(flow.fromLon, flow.fromLat, center[0], center[1]);
    const [x2, y2] = toLocalMeters(flow.toLon, flow.toLat, center[0], center[1]);

    const dist = Math.hypot(x2 - x1, y2 - y1);
    const maxHeight = dist * 0.22; // Height proportional to distance
    const rgb = getVolumeColor(flow.volume);

    for (let s = 0; s < segs; s++) {
      const t1 = s / segs;
      const t2 = (s + 1) / segs;

      // Parabolic altitude: 4 * t * (1 - t)
      const z1 = maxHeight * 4 * t1 * (1 - t1);
      const z2 = maxHeight * 4 * t2 * (1 - t2);

      const px1 = x1 + (x2 - x1) * t1;
      const py1 = y1 + (y2 - y1) * t1;

      const px2 = x1 + (x2 - x1) * t2;
      const py2 = y1 + (y2 - y1) * t2;

      // Vertex 1
      posArr.push(px1, py1, z1);
      colArr.push(rgb[0], rgb[1], rgb[2]);

      // Vertex 2
      posArr.push(px2, py2, z2);
      colArr.push(rgb[0], rgb[1], rgb[2]);
    }
  }

  return {
    positions: new Float32Array(posArr),
    colors: new Float32Array(colArr),
    count: posArr.length / 3,
  };
}
