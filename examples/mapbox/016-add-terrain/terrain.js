export function computeCanyonElevation(x, y) {
    const absX = Math.abs(x);
    const VALLEY_FLOOR = 1200;
    let z;
    if (absX < 800) {
        const riverTrough = Math.exp(-Math.pow(x / 90, 2)) * 15;
        const floorSwell = absX / 800 * 40;
        z = VALLEY_FLOOR + floorSwell - riverTrough;
    } else if (absX < 1800) {
        const t = (absX - 800) / 1000;
        const s = t * t * (3 - 2 * t);
        z = VALLEY_FLOOR + 40 + s * 1050;
    } else {
        const plateau = VALLEY_FLOOR + 1090;
        const dDome = Math.hypot(x - 2200, y - 1500);
        const dome1 = Math.max(0, 380 * (1 - dDome / 900));
        const dCap = Math.hypot(x + 2000, y + 1200);
        const dome2 = Math.max(0, 340 * (1 - dCap / 850));
        const undulation = Math.sin(x * 0.001) * Math.cos(y * 0.001) * 60;
        z = plateau + dome1 + dome2 + undulation;
    }
    const crag = Math.sin(x * 0.015 + y * 0.008) * 18 * (absX > 700 ? 1 : 0);
    return z + crag;
}
export function getCanyonColor(x, _y, z, nz) {
    if (Math.abs(x) < 70 && z < 1225) {
        return [
            0.18,
            0.48,
            0.72
        ];
    }
    const isCliff = nz < 0.72;
    if (isCliff) {
        const t = Math.max(0, Math.min(1, (z - 1200) / 1100));
        return [
            0.72 - 0.08 * t,
            0.68 - 0.08 * t,
            0.63 - 0.06 * t
        ];
    } else if (z < 1280) {
        return [
            0.24,
            0.44,
            0.22
        ];
    } else {
        return [
            0.30,
            0.46,
            0.28
        ];
    }
}
export function generateCanyonTerrainMesh(cols, rows, extent) {
    const numVerts = (cols + 1) * (rows + 1);
    const positions = new Float32Array(numVerts * 3);
    const normals = new Float32Array(numVerts * 3);
    const colors = new Float32Array(numVerts * 3);
    const stepX = extent * 2 / cols;
    const stepY = extent * 2 / rows;
    let vPtr = 0;
    for(let r = 0; r <= rows; r++){
        const y = -extent + r * stepY;
        for(let c = 0; c <= cols; c++){
            const x = -extent + c * stepX;
            const z = computeCanyonElevation(x, y);
            positions[vPtr] = x;
            positions[vPtr + 1] = y;
            positions[vPtr + 2] = z;
            const delta = 10;
            const dzdx = (computeCanyonElevation(x + delta, y) - computeCanyonElevation(x - delta, y)) / (2 * delta);
            const dzdy = (computeCanyonElevation(x, y + delta) - computeCanyonElevation(x, y - delta)) / (2 * delta);
            let nx = -dzdx;
            let ny = -dzdy;
            let nz = 1.0;
            const len = Math.hypot(nx, ny, nz);
            nx /= len;
            ny /= len;
            nz /= len;
            normals[vPtr] = nx;
            normals[vPtr + 1] = ny;
            normals[vPtr + 2] = nz;
            const rgb = getCanyonColor(x, y, z, nz);
            colors[vPtr] = rgb[0];
            colors[vPtr + 1] = rgb[1];
            colors[vPtr + 2] = rgb[2];
            vPtr += 3;
        }
    }
    const indices = new Uint32Array(cols * rows * 6);
    let iPtr = 0;
    for(let r = 0; r < rows; r++){
        for(let c = 0; c < cols; c++){
            const i0 = r * (cols + 1) + c;
            const i1 = i0 + 1;
            const i2 = (r + 1) * (cols + 1) + c;
            const i3 = i2 + 1;
            indices[iPtr++] = i0;
            indices[iPtr++] = i2;
            indices[iPtr++] = i1;
            indices[iPtr++] = i1;
            indices[iPtr++] = i2;
            indices[iPtr++] = i3;
        }
    }
    return {
        positions,
        normals,
        colors,
        indices
    };
}
