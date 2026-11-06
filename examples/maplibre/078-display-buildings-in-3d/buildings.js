import earcut from '../../../vendor/earcut/earcut.js';
export function projectMercator(lon, lat) {
    const x = (lon + 180) / 360;
    const sin = Math.sin(lat * Math.PI / 180);
    const clamped = Math.max(-0.9999, Math.min(0.9999, sin));
    const y = (1 - Math.log((1 + clamped) / (1 - clamped)) / (2 * Math.PI)) / 2;
    return [
        x,
        y
    ];
}
export function toLocalMeters(lon, lat, centerLon, centerLat) {
    const latRad = centerLat * Math.PI / 180;
    const metersPerDegLon = 111320 * Math.cos(latRad);
    const metersPerDegLat = 110540;
    const dx = (lon - centerLon) * metersPerDegLon;
    const dy = (lat - centerLat) * metersPerDegLat;
    return [
        dx,
        dy
    ];
}
export function generateBuildingPrisms(buildings, center, _scale = 1) {
    const posArr = [];
    const normArr = [];
    const colArr = [];
    for (const b of buildings){
        const coords = b.coordinates;
        const n = coords.length;
        if (n < 3) continue;
        const localPts = coords.map((c)=>toLocalMeters(c[0], c[1], center[0], center[1]));
        const baseZ = b.base || 0;
        const topZ = b.height;
        for(let i = 0; i < n; i++){
            const next = (i + 1) % n;
            const p1 = localPts[i];
            const p2 = localPts[next];
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) continue;
            const nx = dy / len;
            const ny = -dx / len;
            const v0 = [
                p1[0],
                p1[1],
                baseZ
            ];
            const v1 = [
                p2[0],
                p2[1],
                baseZ
            ];
            const v2 = [
                p2[0],
                p2[1],
                topZ
            ];
            const v3 = [
                p1[0],
                p1[1],
                topZ
            ];
            const wallVerts = [
                v0,
                v1,
                v2,
                v0,
                v2,
                v3
            ];
            for (const v of wallVerts){
                posArr.push(v[0], v[1], v[2]);
                normArr.push(nx, ny, 0);
                const t = Math.max(0, Math.min(1, (v[2] - baseZ) / (topZ - baseZ + 1e-3)));
                const shade = 0.55 + 0.35 * t;
                colArr.push(0.68 * shade, 0.72 * shade, 0.78 * shade);
            }
        }
        const flat = [];
        for (const pt of localPts){
            flat.push(pt[0], pt[1]);
        }
        const indices = earcut(flat, null, 2);
        for(let i = 0; i < indices.length; i += 3){
            const i0 = indices[i];
            const i1 = indices[i + 1];
            const i2 = indices[i + 2];
            const p0 = localPts[i0];
            const p1 = localPts[i1];
            const p2 = localPts[i2];
            const roofVerts = [
                [
                    p0[0],
                    p0[1],
                    topZ
                ],
                [
                    p1[0],
                    p1[1],
                    topZ
                ],
                [
                    p2[0],
                    p2[1],
                    topZ
                ]
            ];
            for (const v of roofVerts){
                posArr.push(v[0], v[1], v[2]);
                normArr.push(0, 0, 1);
                colArr.push(0.85, 0.88, 0.92);
            }
        }
    }
    const count = posArr.length / 3;
    return {
        positions: new Float32Array(posArr),
        normals: new Float32Array(normArr),
        colors: new Float32Array(colArr),
        count
    };
}
export const DEFAULT_CENTER = [
    -74.009,
    40.712
];
export function createDefaultBuildings() {
    const buildings = [];
    const baseLon = DEFAULT_CENTER[0];
    const baseLat = DEFAULT_CENTER[1];
    const rows = 12;
    const cols = 12;
    const blockW = 0.0012;
    const blockH = 0.0008;
    const streetGap = 0.00025;
    let idCounter = 1;
    for(let r = -rows / 2; r < rows / 2; r++){
        for(let c = -cols / 2; c < cols / 2; c++){
            const minX = baseLon + c * (blockW + streetGap);
            const maxX = minX + blockW;
            const minY = baseLat + r * (blockH + streetGap);
            const maxY = minY + blockH;
            const distFromCenter = Math.hypot(c, r);
            const height = Math.max(30, Math.round(380 * Math.exp(-distFromCenter * 0.28) + Math.sin(c * 3 + r * 5) * 50));
            buildings.push({
                id: `bldg_${idCounter++}`,
                height,
                base: 0,
                coordinates: [
                    [
                        minX,
                        minY
                    ],
                    [
                        maxX,
                        minY
                    ],
                    [
                        maxX,
                        maxY
                    ],
                    [
                        minX,
                        maxY
                    ]
                ]
            });
        }
    }
    buildings.push({
        id: 'bldg_wtc',
        height: 541,
        base: 0,
        coordinates: [
            [
                baseLon - 0.0004,
                baseLat - 0.0004
            ],
            [
                baseLon + 0.0004,
                baseLat - 0.0004
            ],
            [
                baseLon + 0.0004,
                baseLat + 0.0004
            ],
            [
                baseLon - 0.0004,
                baseLat + 0.0004
            ]
        ]
    });
    return buildings;
}
