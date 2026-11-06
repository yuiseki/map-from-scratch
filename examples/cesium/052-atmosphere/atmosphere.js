export function raySphereIntersect(origin, dir, radius) {
    const b = 2.0 * (origin[0] * dir[0] + origin[1] * dir[1] + origin[2] * dir[2]);
    const c = origin[0] * origin[0] + origin[1] * origin[1] + origin[2] * origin[2] - radius * radius;
    const d = b * b - 4.0 * c;
    if (d < 0) return null;
    const sqrtD = Math.sqrt(d);
    const t0 = (-b - sqrtD) * 0.5;
    const t1 = (-b + sqrtD) * 0.5;
    return [
        t0,
        t1
    ];
}
export function rayleighPhase(cosTheta) {
    return 3.0 / (16.0 * Math.PI) * (1.0 + cosTheta * cosTheta);
}
export function miePhase(cosTheta, g = 0.76) {
    const g2 = g * g;
    const denom = Math.pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return 3.0 / (8.0 * Math.PI) * ((1.0 - g2) / (2.0 + g2)) * (1.0 + cosTheta * cosTheta) / Math.max(denom, 1e-4);
}
export function computeSunDirection(angleRad, elevationRad = 0.25) {
    const cosEl = Math.cos(elevationRad);
    const sinEl = Math.sin(elevationRad);
    const x = Math.cos(angleRad) * cosEl;
    const y = sinEl;
    const z = Math.sin(angleRad) * cosEl;
    return [
        x,
        y,
        z
    ];
}
export function generateSphereMesh(latBands, lonBands, radius = 1.0) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for(let lat = 0; lat <= latBands; lat++){
        const theta = lat * Math.PI / latBands;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        for(let lon = 0; lon <= lonBands; lon++){
            const phi = lon * 2 * Math.PI / lonBands;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);
            const x = cosPhi * sinTheta;
            const y = cosTheta;
            const z = sinPhi * sinTheta;
            const u = 1 - lon / lonBands;
            const v = lat / latBands;
            normals.push(x, y, z);
            positions.push(radius * x, radius * y, radius * z);
            uvs.push(u, v);
        }
    }
    for(let lat = 0; lat < latBands; lat++){
        for(let lon = 0; lon < lonBands; lon++){
            const first = lat * (lonBands + 1) + lon;
            const second = first + lonBands + 1;
            indices.push(first, second, first + 1);
            indices.push(second, second + 1, first + 1);
        }
    }
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint16Array(indices)
    };
}
