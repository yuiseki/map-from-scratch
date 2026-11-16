export const EARTH_R = 6371008.8;
export const FOV = 0.6435011087932844;
export const MAX_ZOOM = 12, MIN_ZOOM = 0.5, MAX_PITCH = 80;
const D = Math.PI / 180;
const add = (a, b, s = 1)=>[
        a[0] + b[0] * s,
        a[1] + b[1] * s,
        a[2] + b[2] * s
    ];
const dot = (a, b)=>a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b)=>[
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
export function ecef(lon, lat, h) {
    const r = EARTH_R + h, cl = Math.cos(lat * D);
    return [
        r * cl * Math.cos(lon * D),
        r * cl * Math.sin(lon * D),
        r * Math.sin(lat * D)
    ];
}
export const metresPerPixel = (zoom, lat)=>2 * Math.PI * EARTH_R * Math.cos(lat * D) / (512 * 2 ** zoom);
const focalPx = (height)=>0.5 * height / Math.tan(FOV / 2);
export function frame(v) {
    const lo = v.lon * D, la = v.lat * D, b = v.bearing * D, p = v.pitch * D;
    const U = [
        Math.cos(la) * Math.cos(lo),
        Math.cos(la) * Math.sin(lo),
        Math.sin(la)
    ];
    const E = [
        -Math.sin(lo),
        Math.cos(lo),
        0
    ];
    const N = [
        -Math.sin(la) * Math.cos(lo),
        -Math.sin(la) * Math.sin(lo),
        Math.cos(la)
    ];
    const H = add([
        N[0] * Math.cos(b),
        N[1] * Math.cos(b),
        N[2] * Math.cos(b)
    ], E, Math.sin(b));
    const F = add([
        -U[0] * Math.cos(p),
        -U[1] * Math.cos(p),
        -U[2] * Math.cos(p)
    ], H, Math.sin(p));
    const up = add([
        U[0] * Math.sin(p),
        U[1] * Math.sin(p),
        U[2] * Math.sin(p)
    ], H, Math.cos(p));
    const right = cross(F, up);
    const dist = focalPx(v.height) * metresPerPixel(v.zoom, v.lat);
    const centre = ecef(v.lon, v.lat, v.centerH);
    const eye = add(centre, F, -dist);
    const r = Math.hypot(...eye), alt = r - EARTH_R;
    const far = Math.sqrt(Math.max(0, r * r - EARTH_R * EARTH_R)) + 400e3 + dist;
    const near = Math.max(30, Math.min(dist * 0.5, (alt - 3000) * 0.5));
    const f = 1 / Math.tan(FOV / 2), aspect = v.width / v.height, nf = 1 / (near - far);
    const V = [
        right,
        up,
        [
            -F[0],
            -F[1],
            -F[2]
        ]
    ];
    const P = [
        f / aspect,
        f,
        (far + near) * nf,
        2 * far * near * nf
    ];
    const m = new Float64Array(16);
    for(let c = 0; c < 3; c++){
        m[c * 4 + 0] = P[0] * V[0][c];
        m[c * 4 + 1] = P[1] * V[1][c];
        m[c * 4 + 2] = P[2] * V[2][c];
        m[c * 4 + 3] = -V[2][c];
    }
    m[12] = 0;
    m[13] = 0;
    m[14] = P[3];
    m[15] = 0;
    return {
        eye,
        up,
        right,
        fwd: F,
        m,
        near,
        far,
        width: v.width,
        height: v.height
    };
}
export function project(f, lon, lat, h) {
    const p = ecef(lon, lat, h), d = [
        p[0] - f.eye[0],
        p[1] - f.eye[1],
        p[2] - f.eye[2]
    ];
    const ground = ecef(lon, lat, 0);
    if (dot(d, ground) > 0) return null;
    const m = f.m;
    const x = m[0] * d[0] + m[4] * d[1] + m[8] * d[2] + m[12];
    const y = m[1] * d[0] + m[5] * d[1] + m[9] * d[2] + m[13];
    const z = m[2] * d[0] + m[6] * d[1] + m[10] * d[2] + m[14];
    const w = m[3] * d[0] + m[7] * d[1] + m[11] * d[2] + m[15];
    if (w <= 0) return null;
    return [
        (x / w + 1) / 2 * f.width,
        (1 - y / w) / 2 * f.height,
        z / w
    ];
}
export function limbPx(v) {
    const r = Math.hypot(...frame({
        ...v,
        pitch: 0
    }).eye);
    return focalPx(v.height) * Math.tan(Math.asin(EARTH_R / r));
}
export const atmosphereBlend = (zoom)=>Math.max(0, Math.min(1, 1 - zoom / 2));
export function ray(f, sx, sy) {
    const t = Math.tan(FOV / 2), ax = (2 * sx / f.width - 1) * t * (f.width / f.height), ay = (1 - 2 * sy / f.height) * t;
    const d = add(add(f.fwd, f.right, ax), f.up, ay), n = Math.hypot(...d);
    return [
        d[0] / n,
        d[1] / n,
        d[2] / n
    ];
}
export function unproject(f, sx, sy, h) {
    const d = ray(f, sx, sy), r = EARTH_R + h;
    const b = dot(f.eye, d), c = dot(f.eye, f.eye) - r * r, disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const p = add(f.eye, d, t);
    return [
        Math.atan2(p[1], p[0]) / D,
        Math.asin(Math.max(-1, Math.min(1, p[2] / r))) / D
    ];
}
