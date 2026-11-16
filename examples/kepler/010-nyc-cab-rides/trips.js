export const MANHATTAN_CENTER = [
    -73.985,
    40.748
];
export function toLocalMeters(lon, lat, centerLon, centerLat) {
    const latRad = centerLat * Math.PI / 180;
    const metersPerDegLon = 111320 * Math.cos(latRad);
    const metersPerDegLat = 110540;
    return [
        (lon - centerLon) * metersPerDegLon,
        (lat - centerLat) * metersPerDegLat
    ];
}
export function generateNycCabTrips(count = 120) {
    const trips = [];
    const hubs = [
        [
            -74.013,
            40.706
        ],
        [
            -74.009,
            40.713
        ],
        [
            -74.002,
            40.722
        ],
        [
            -73.990,
            40.735
        ],
        [
            -73.987,
            40.748
        ],
        [
            -73.985,
            40.758
        ],
        [
            -73.977,
            40.752
        ],
        [
            -73.976,
            40.765
        ],
        [
            -73.960,
            40.775
        ],
        [
            -73.970,
            40.710
        ]
    ];
    const SIMULATION_DURATION = 1200;
    for(let i = 0; i < count; i++){
        const originIdx = i % hubs.length;
        let destIdx = (i * 3 + 4) % hubs.length;
        if (destIdx === originIdx) destIdx = (destIdx + 1) % hubs.length;
        const startPt = hubs[originIdx];
        const endPt = hubs[destIdx];
        const startTime = i * 9.5 % (SIMULATION_DURATION - 200);
        const duration = 120 + i * 17 % 180;
        const endTime = startTime + duration;
        const numPoints = 8 + i % 6;
        const waypoints = [];
        const colorType = i % 4;
        const color = colorType === 0 ? [
            1.0,
            0.88,
            0.12
        ] : colorType === 1 ? [
            1.0,
            0.72,
            0.08
        ] : colorType === 2 ? [
            0.20,
            0.95,
            0.45
        ] : [
            0.98,
            0.42,
            0.15
        ];
        for(let p = 0; p <= numPoints; p++){
            const frac = p / numPoints;
            const t = startTime + frac * duration;
            let lon;
            let lat;
            if (frac < 0.5) {
                const f = frac * 2;
                lon = startPt[0] + (endPt[0] - startPt[0]) * 0.1 * f;
                lat = startPt[1] + (endPt[1] - startPt[1]) * f * 0.8;
            } else {
                const f = (frac - 0.5) * 2;
                lon = startPt[0] + (endPt[0] - startPt[0]) * 0.1 + (endPt[0] - startPt[0]) * 0.9 * f;
                lat = startPt[1] + (endPt[1] - startPt[1]) * 0.8 + (endPt[1] - startPt[1]) * 0.2 * f;
            }
            const wiggle = Math.sin(frac * Math.PI * 4) * 0.0004;
            waypoints.push({
                lon: lon + wiggle,
                lat: lat + wiggle * 0.5,
                t
            });
        }
        trips.push({
            id: `cab_${i + 1}`,
            startTime,
            endTime,
            color,
            waypoints
        });
    }
    return trips;
}
export function buildTripsBuffer(trips, center) {
    const posArr = [];
    const timeArr = [];
    const colArr = [];
    for (const trip of trips){
        const pts = trip.waypoints;
        for(let i = 0; i < pts.length - 1; i++){
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const [x1, y1] = toLocalMeters(p1.lon, p1.lat, center[0], center[1]);
            const [x2, y2] = toLocalMeters(p2.lon, p2.lat, center[0], center[1]);
            const z = 2.0;
            posArr.push(x1, y1, z);
            timeArr.push(p1.t);
            colArr.push(trip.color[0], trip.color[1], trip.color[2]);
            posArr.push(x2, y2, z);
            timeArr.push(p2.t);
            colArr.push(trip.color[0], trip.color[1], trip.color[2]);
        }
    }
    return {
        positions: new Float32Array(posArr),
        timestamps: new Float32Array(timeArr),
        colors: new Float32Array(colArr),
        count: posArr.length / 3
    };
}
