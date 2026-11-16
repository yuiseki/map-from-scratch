export function isContourLine(elevation, spacing, width) {
    if (spacing <= 0) return false;
    const mod = (elevation % spacing + spacing) % spacing;
    return mod <= width || mod >= spacing - width;
}
export function evaluateElevationColor(t) {
    const h = Math.max(0, Math.min(1, t));
    if (h < 0.2) {
        const k = h / 0.2;
        return [
            0.05 + 0.05 * k,
            0.15 + 0.35 * k,
            0.5 + 0.3 * k
        ];
    } else if (h < 0.35) {
        const k = (h - 0.2) / 0.15;
        return [
            0.1 + 0.1 * k,
            0.5 + 0.3 * k,
            0.8 - 0.5 * k
        ];
    } else if (h < 0.6) {
        const k = (h - 0.35) / 0.25;
        return [
            0.2 + 0.5 * k,
            0.8 - 0.1 * k,
            0.3 - 0.1 * k
        ];
    } else if (h < 0.8) {
        const k = (h - 0.6) / 0.2;
        return [
            0.7 + 0.1 * k,
            0.7 - 0.3 * k,
            0.2 + 0.1 * k
        ];
    } else {
        const k = (h - 0.8) / 0.2;
        return [
            0.8 + 0.2 * k,
            0.4 + 0.6 * k,
            0.3 + 0.7 * k
        ];
    }
}
export function computeRadarIntensity(azimuth, sweepAngle, beamWidth) {
    const tau = Math.PI * 2;
    let diff = ((sweepAngle - azimuth) % tau + tau) % tau;
    if (diff <= beamWidth) {
        return Math.pow(1 - diff / beamWidth, 1.8);
    }
    return 0.0;
}
function sampleElevationNoise(nx, ny, nz) {
    const f1 = Math.sin(nx * 3.5) * Math.cos(ny * 3.5) * Math.sin(nz * 3.5);
    const f2 = Math.sin(nx * 7.0 + 1.2) * Math.sin(ny * 7.0 + 0.8) * Math.cos(nz * 7.0);
    const f3 = Math.sin(nx * 15.0) * Math.cos(ny * 15.0) * Math.sin(nz * 15.0);
    const raw = f1 * 0.6 + f2 * 0.3 + f3 * 0.1;
    return Math.max(0, Math.min(1, (raw + 0.8) / 1.6));
}
export function generateGlobeMesh(latSegments, lonSegments, radius) {
    const numVertices = (latSegments + 1) * (lonSegments + 1);
    const positions = new Float32Array(numVertices * 3);
    const normals = new Float32Array(numVertices * 3);
    const elevations = new Float32Array(numVertices);
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
            const elev = sampleElevationNoise(nx, ny, nz);
            elevations[vIdx] = elev;
            const r = radius * (1.0 + elev * 0.08);
            const px = nx * r;
            const py = ny * r;
            const pz = nz * r;
            const pOffset = vIdx * 3;
            positions[pOffset + 0] = px;
            positions[pOffset + 1] = py;
            positions[pOffset + 2] = pz;
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
        elevations,
        indices
    };
}
