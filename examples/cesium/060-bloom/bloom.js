export function calculateGaussianWeights(radius, sigma) {
    const weights = new Array(radius);
    const twoSigmaSq = 2.0 * sigma * sigma;
    let sum = 0.0;
    for(let i = 0; i < radius; i++){
        const w = Math.exp(-(i * i) / twoSigmaSq);
        weights[i] = w;
        sum += i === 0 ? w : 2.0 * w;
    }
    for(let i = 0; i < radius; i++){
        weights[i] /= sum;
    }
    return weights;
}
export function relativeLuminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function extractBrightPass(color, threshold) {
    const lum = relativeLuminance(color[0], color[1], color[2]);
    if (lum <= threshold) {
        return [
            0,
            0,
            0
        ];
    }
    const factor = (lum - threshold) / Math.max(1e-4, lum);
    return [
        color[0] * factor,
        color[1] * factor,
        color[2] * factor
    ];
}
export function generateNeonCityGeometry(towerCount) {
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];
    const gSize = 120.0;
    const gBaseIdx = positions.length / 3;
    positions.push(-gSize, 0, -gSize, gSize, 0, -gSize, gSize, 0, gSize, -gSize, 0, gSize);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    for(let i = 0; i < 4; i++)colors.push(0.04, 0.05, 0.08, 1.0);
    indices.push(gBaseIdx, gBaseIdx + 1, gBaseIdx + 2, gBaseIdx, gBaseIdx + 2, gBaseIdx + 3);
    const palette = [
        [
            0.0,
            1.8,
            1.8
        ],
        [
            1.8,
            0.1,
            1.5
        ],
        [
            1.9,
            0.8,
            0.0
        ],
        [
            0.1,
            1.9,
            0.4
        ]
    ];
    let currentVertex = positions.length / 3;
    for(let i = 0; i < towerCount; i++){
        const angle = i / towerCount * Math.PI * 2;
        const dist = 25.0 + i % 3 * 20.0;
        const cx = Math.cos(angle) * dist;
        const cz = Math.sin(angle) * dist;
        const w = 4.0 + i % 2 * 3.0;
        const h = 18.0 + i % 4 * 14.0;
        const d = 4.0 + (i + 1) % 2 * 3.0;
        const baseColor = [
            0.08,
            0.10,
            0.14,
            1.0
        ];
        const neonColor = palette[i % palette.length];
        const emissiveRoof = [
            neonColor[0],
            neonColor[1],
            neonColor[2],
            1.0
        ];
        const minX = cx - w, maxX = cx + w;
        const minZ = cz - d, maxZ = cz + d;
        const roofBase = currentVertex;
        positions.push(minX, h, minZ, maxX, h, minZ, maxX, h, maxZ, minX, h, maxZ);
        for(let j = 0; j < 4; j++){
            normals.push(0, 1, 0);
            colors.push(...emissiveRoof);
        }
        indices.push(roofBase, roofBase + 1, roofBase + 2, roofBase, roofBase + 2, roofBase + 3);
        currentVertex += 4;
        const wallDefs = [
            {
                n: [
                    0,
                    0,
                    1
                ],
                p: [
                    minX,
                    0,
                    maxZ,
                    maxX,
                    0,
                    maxZ,
                    maxX,
                    h,
                    maxZ,
                    minX,
                    h,
                    maxZ
                ]
            },
            {
                n: [
                    0,
                    0,
                    -1
                ],
                p: [
                    maxX,
                    0,
                    minZ,
                    minX,
                    0,
                    minZ,
                    minX,
                    h,
                    minZ,
                    maxX,
                    h,
                    minZ
                ]
            },
            {
                n: [
                    1,
                    0,
                    0
                ],
                p: [
                    maxX,
                    0,
                    maxZ,
                    maxX,
                    0,
                    minZ,
                    maxX,
                    h,
                    minZ,
                    maxX,
                    h,
                    maxZ
                ]
            },
            {
                n: [
                    -1,
                    0,
                    0
                ],
                p: [
                    minX,
                    0,
                    minZ,
                    minX,
                    0,
                    maxZ,
                    minX,
                    h,
                    maxZ,
                    minX,
                    h,
                    minZ
                ]
            }
        ];
        for (const wd of wallDefs){
            const wBase = currentVertex;
            positions.push(...wd.p);
            for(let j = 0; j < 4; j++){
                normals.push(wd.n[0], wd.n[1], wd.n[2]);
                if (j >= 2) {
                    colors.push(neonColor[0] * 0.7, neonColor[1] * 0.7, neonColor[2] * 0.7, 1.0);
                } else {
                    colors.push(...baseColor);
                }
            }
            indices.push(wBase, wBase + 1, wBase + 2, wBase, wBase + 2, wBase + 3);
            currentVertex += 4;
        }
    }
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        colors: new Float32Array(colors),
        indices: new Uint16Array(indices)
    };
}
