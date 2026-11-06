export function calculateFresnelAlpha(cosTheta, baseAlpha, power) {
    const c = Math.max(0, Math.min(1, cosTheta));
    const limbFactor = Math.pow(1 - c, power);
    return baseAlpha * 0.2 + (1.0 - baseAlpha * 0.2) * limbFactor;
}
function createSphereGeometry(latSegments, lonSegments, radius) {
    const numVertices = (latSegments + 1) * (lonSegments + 1);
    const positions = new Float32Array(numVertices * 3);
    const normals = new Float32Array(numVertices * 3);
    let vIdx = 0;
    for(let lat = 0; lat <= latSegments; lat++){
        const theta = lat / latSegments * Math.PI;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        for(let lon = 0; lon <= lonSegments; lon++){
            const phi = lon / lonSegments * Math.PI * 2;
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
    for(let lat = 0; lat < latSegments; lat++){
        for(let lon = 0; lon < lonSegments; lon++){
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
    return {
        positions,
        normals,
        indices
    };
}
export function generateLayeredGlobeMesh(latSegments, lonSegments, radius) {
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
        coreIndices: core.indices
    };
}
export function generateSubterraneanFeatures(globeRadius, count) {
    const features = [];
    for(let i = 0; i < count; i++){
        const depthFrac = 0.15 + i / count * 0.55;
        const r = globeRadius * (1.0 - depthFrac);
        const theta = Math.acos(2 * ((i + 0.5) / count) - 1);
        const phi = i * 2.3999632 % (Math.PI * 2);
        const x = r * Math.sin(theta) * Math.cos(phi);
        const y = r * Math.cos(theta);
        const z = r * Math.sin(theta) * Math.sin(phi);
        features.push({
            pos: [
                x,
                y,
                z
            ],
            depth: depthFrac * globeRadius,
            type: i % 3 === 0 ? 'magma_chamber' : i % 3 === 1 ? 'seismic_fault' : 'core_plume'
        });
    }
    return features;
}
