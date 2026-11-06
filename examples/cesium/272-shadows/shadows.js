export function computeSunDirection(azimuth, elevation) {
    const elev = Math.max(0.05, Math.min(Math.PI * 0.5, elevation));
    const cosElev = Math.cos(elev);
    const sinElev = Math.sin(elev);
    const x = Math.sin(azimuth) * cosElev;
    const y = sinElev;
    const z = Math.cos(azimuth) * cosElev;
    return [
        x,
        y,
        z
    ];
}
export function calculateShadowBias(normal, lightDir) {
    const dot = Math.max(0, normal[0] * lightDir[0] + normal[1] * lightDir[1] + normal[2] * lightDir[2]);
    const minBias = 0.001;
    const maxBias = 0.008;
    return minBias + (maxBias - minBias) * (1.0 - dot);
}
export function mat4Ortho(out, left, right, bottom, top, near, far) {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = -2 * lr;
    out[5] = -2 * bt;
    out[10] = 2 * nf;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = (far + near) * nf;
    out[15] = 1;
}
export function generateShadowSceneGeometry(towerCount) {
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];
    const gSize = 100.0;
    const gBase = positions.length / 3;
    positions.push(-gSize, 0, -gSize, gSize, 0, -gSize, gSize, 0, gSize, -gSize, 0, gSize);
    for(let i = 0; i < 4; i++){
        normals.push(0, 1, 0);
        colors.push(0.65, 0.68, 0.72, 1.0);
    }
    indices.push(gBase, gBase + 1, gBase + 2, gBase, gBase + 2, gBase + 3);
    let currentVertex = positions.length / 3;
    function addBox(cx, cz, w, h, d, color) {
        const minX = cx - w, maxX = cx + w;
        const minZ = cz - d, maxZ = cz + d;
        const faces = [
            {
                n: [
                    0,
                    1,
                    0
                ],
                p: [
                    minX,
                    h,
                    minZ,
                    maxX,
                    h,
                    minZ,
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
        for (const f of faces){
            const base = currentVertex;
            positions.push(...f.p);
            for(let j = 0; j < 4; j++){
                normals.push(f.n[0], f.n[1], f.n[2]);
                colors.push(...color);
            }
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            currentVertex += 4;
        }
    }
    addBox(0, 0, 3.5, 36.0, 3.5, [
        0.85,
        0.45,
        0.25,
        1.0
    ]);
    for(let i = 0; i < towerCount; i++){
        const angle = i / towerCount * Math.PI * 2;
        const r = 24.0 + i % 2 * 16.0;
        const cx = Math.cos(angle) * r;
        const cz = Math.sin(angle) * r;
        const w = 3.5 + i % 3 * 1.5;
        const h = 14.0 + i % 4 * 6.0;
        const d = 3.5 + (i + 1) % 3 * 1.5;
        const col = i % 2 === 0 ? [
            0.25,
            0.55,
            0.85,
            1.0
        ] : [
            0.35,
            0.75,
            0.45,
            1.0
        ];
        addBox(cx, cz, w, h, d, col);
    }
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        colors: new Float32Array(colors),
        indices: new Uint16Array(indices)
    };
}
