const RAD = Math.PI / 180;
export const FOCAL = 2.2;
export const MIN_DISTANCE = 1.35;
export const MAX_DISTANCE = 8;
export function lonLatToUnit(lon, lat) {
    const c = Math.cos(lat * RAD);
    return [
        Math.sin(lon * RAD) * c,
        Math.sin(lat * RAD),
        Math.cos(lon * RAD) * c
    ];
}
export function eyePosition(cam) {
    const [x, y, z] = lonLatToUnit(cam.lon, cam.lat);
    return [
        x * cam.distance,
        y * cam.distance,
        z * cam.distance
    ];
}
export function viewProjection(cam, aspect) {
    const eye = eyePosition(cam);
    const f = lonLatToUnit(cam.lon, cam.lat).map((v)=>-v);
    let r = [
        f[1] * 0 - f[2] * 1,
        f[2] * 0 - f[0] * 0,
        f[0] * 1 - f[1] * 0
    ];
    const rl = Math.hypot(r[0], r[1], r[2]);
    r = r.map((v)=>v / rl);
    const u = [
        r[1] * f[2] - r[2] * f[1],
        r[2] * f[0] - r[0] * f[2],
        r[0] * f[1] - r[1] * f[0]
    ];
    const near = Math.max(0.05, cam.distance - 1.1), far = cam.distance + 1.1;
    const sx = FOCAL / aspect, sy = FOCAL;
    const a = (far + near) / (near - far), b = 2 * far * near / (near - far);
    const dot = (v)=>v[0] * eye[0] + v[1] * eye[1] + v[2] * eye[2];
    const view = [
        [
            r[0],
            r[1],
            r[2],
            -dot(r)
        ],
        [
            u[0],
            u[1],
            u[2],
            -dot(u)
        ],
        [
            -f[0],
            -f[1],
            -f[2],
            dot(f)
        ]
    ];
    const m = new Float32Array(16);
    for(let c = 0; c < 4; c++){
        m[c * 4] = sx * view[0][c];
        m[c * 4 + 1] = sy * view[1][c];
        m[c * 4 + 2] = a * view[2][c] + (c === 3 ? b : 0);
        m[c * 4 + 3] = -view[2][c];
    }
    return m;
}
export function project(m, p, width, height) {
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w <= 1e-6) return null;
    return [
        (x / w + 1) * width / 2,
        (1 - y / w) * height / 2,
        w
    ];
}
export function frontFacing(p, eye) {
    return p[0] * (eye[0] - p[0]) + p[1] * (eye[1] - p[1]) + p[2] * (eye[2] - p[2]) > 0;
}
export function dragCamera(cam, dx, dy, heightPx) {
    const k = (cam.distance - 1) / (FOCAL * heightPx / 2) / RAD;
    const lat = Math.max(-85, Math.min(85, cam.lat + dy * k));
    const lon = ((cam.lon - dx * k / Math.max(0.2, Math.cos(cam.lat * RAD)) + 180) % 360 + 360) % 360 - 180;
    return {
        lon,
        lat,
        distance: cam.distance
    };
}
export function zoomCamera(cam, deltaY) {
    const h = (cam.distance - 1) * Math.exp(deltaY * 0.0015);
    return {
        ...cam,
        distance: Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, 1 + h))
    };
}
export function createSphereGrid(rows, columns) {
    const stride = columns + 1;
    const positions = new Float32Array((rows + 1) * stride * 3);
    const uvs = new Float32Array((rows + 1) * stride * 2);
    for(let row = 0; row <= rows; row++){
        const lat = 90 - row * 180 / rows;
        for(let col = 0; col <= columns; col++){
            const i = row * stride + col;
            positions.set(lonLatToUnit(-180 + col * 360 / columns, lat), i * 3);
            uvs[i * 2] = col / columns;
            uvs[i * 2 + 1] = row / rows;
        }
    }
    const indices = new Uint32Array(rows * columns * 6);
    let o = 0;
    for(let row = 0; row < rows; row++){
        for(let col = 0; col < columns; col++){
            const a = row * stride + col, b = a + 1, c = a + stride, d = c + 1;
            indices.set([
                a,
                c,
                b,
                b,
                c,
                d
            ], o);
            o += 6;
        }
    }
    return {
        positions,
        uvs,
        indices
    };
}
