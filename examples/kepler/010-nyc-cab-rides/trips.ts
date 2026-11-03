export interface TripWaypoint {
  lon: number;
  lat: number;
  t: number; // Seconds within the simulation cycle (0 to 1800s)
}

export interface CabTrip {
  id: string;
  startTime: number;
  endTime: number;
  color: [number, number, number];
  waypoints: TripWaypoint[];
}

export interface TripsMesh {
  positions: Float32Array; // x, y, z in local meters
  timestamps: Float32Array; // t in seconds
  colors: Float32Array; // r, g, b
  count: number;
}

export const MANHATTAN_CENTER: [number, number] = [-73.985, 40.748];

export function toLocalMeters(lon: number, lat: number, centerLon: number, centerLat: number): [number, number] {
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegLon = 111320 * Math.cos(latRad);
  const metersPerDegLat = 110540;
  return [
    (lon - centerLon) * metersPerDegLon,
    (lat - centerLat) * metersPerDegLat,
  ];
}

// Manhattan street corridors (Avenues oriented ~29° NE, Streets ~119° SE)
export function generateNycCabTrips(count = 120): CabTrip[] {
  const trips: CabTrip[] = [];

  // Key Manhattan origin-destination hubs:
  // Lower Manhattan, Financial District, Midtown, Times Square, Grand Central, Central Park South, Brooklyn Bridge, Upper East Side
  const hubs: [number, number][] = [
    [-74.013, 40.706], // Wall Street
    [-74.009, 40.713], // City Hall / WTC
    [-74.002, 40.722], // SoHo
    [-73.990, 40.735], // Union Square
    [-73.987, 40.748], // Empire State
    [-73.985, 40.758], // Times Square
    [-73.977, 40.752], // Grand Central
    [-73.976, 40.765], // Central Park South
    [-73.960, 40.775], // Upper East Side
    [-73.970, 40.710], // FDR Drive South
  ];

  const SIMULATION_DURATION = 1200; // 20 minute loop

  for (let i = 0; i < count; i++) {
    const originIdx = i % hubs.length;
    let destIdx = (i * 3 + 4) % hubs.length;
    if (destIdx === originIdx) destIdx = (destIdx + 1) % hubs.length;

    const startPt = hubs[originIdx];
    const endPt = hubs[destIdx];

    const startTime = (i * 9.5) % (SIMULATION_DURATION - 200);
    const duration = 120 + ((i * 17) % 180); // 2 to 5 minutes duration
    const endTime = startTime + duration;

    // Build intermediate waypoints along grid
    const numPoints = 8 + (i % 6);
    const waypoints: TripWaypoint[] = [];

    // Taxi cab colors: Classic Yellow Cab, Electric Lime Boro Taxi, Neon Orange
    const colorType = i % 4;
    const color: [number, number, number] =
      colorType === 0 ? [1.0, 0.88, 0.12] : // Classic yellow cab
      colorType === 1 ? [1.0, 0.72, 0.08] : // Golden amber
      colorType === 2 ? [0.20, 0.95, 0.45] : // Boro green taxi
      [0.98, 0.42, 0.15]; // Sunset orange

    for (let p = 0; p <= numPoints; p++) {
      const frac = p / numPoints;
      // Manhattan street grid interpolation (L-shaped turns)
      const t = startTime + frac * duration;

      let lon: number;
      let lat: number;
      if (frac < 0.5) {
        // Move along avenue first
        const f = frac * 2;
        lon = startPt[0] + (endPt[0] - startPt[0]) * 0.1 * f;
        lat = startPt[1] + (endPt[1] - startPt[1]) * f * 0.8;
      } else {
        // Turn onto cross street then avenue
        const f = (frac - 0.5) * 2;
        lon = (startPt[0] + (endPt[0] - startPt[0]) * 0.1) + (endPt[0] - startPt[0]) * 0.9 * f;
        lat = (startPt[1] + (endPt[1] - startPt[1]) * 0.8) + (endPt[1] - startPt[1]) * 0.2 * f;
      }

      // Add small wiggle to simulate block turns
      const wiggle = Math.sin(frac * Math.PI * 4) * 0.0004;
      waypoints.push({
        lon: lon + wiggle,
        lat: lat + wiggle * 0.5,
        t,
      });
    }

    trips.push({
      id: `cab_${i + 1}`,
      startTime,
      endTime,
      color,
      waypoints,
    });
  }

  return trips;
}

export function buildTripsBuffer(trips: CabTrip[], center: [number, number]): TripsMesh {
  const posArr: number[] = [];
  const timeArr: number[] = [];
  const colArr: number[] = [];

  for (const trip of trips) {
    const pts = trip.waypoints;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];

      const [x1, y1] = toLocalMeters(p1.lon, p1.lat, center[0], center[1]);
      const [x2, y2] = toLocalMeters(p2.lon, p2.lat, center[0], center[1]);
      const z = 2.0; // Slightly above pavement

      // Segment vertex 1
      posArr.push(x1, y1, z);
      timeArr.push(p1.t);
      colArr.push(trip.color[0], trip.color[1], trip.color[2]);

      // Segment vertex 2
      posArr.push(x2, y2, z);
      timeArr.push(p2.t);
      colArr.push(trip.color[0], trip.color[1], trip.color[2]);
    }
  }

  return {
    positions: new Float32Array(posArr),
    timestamps: new Float32Array(timeArr),
    colors: new Float32Array(colArr),
    count: posArr.length / 3,
  };
}
