import { EARTH_R, toEcef } from './land.js';
export const FOV_Y = 40 * Math.PI / 180;
export const MIN_RANGE = 5, MAX_RANGE = 30000, MAX_TILT = 75 * Math.PI / 180;
export const JAPAN = {
    lon: 136.6,
    lat: 35.6,
    range: 2300,
    heading: 0,
    tilt: 0.25
};
export const FUJI = {
    lon: 138.66,
    lat: 35.21,
    range: 70,
    heading: 0,
    tilt: 65 * Math.PI / 180
};
const dot = (a, b)=>a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b)=>[
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
const axpy = (s, a, b)=>[
        s * a[0] + b[0],
        s * a[1] + b[1],
        s * a[2] + b[2]
    ];
export function enu(lon, lat) {
    const l = lon * Math.PI / 180, p = lat * Math.PI / 180;
    return {
        e: [
            -Math.sin(l),
            Math.cos(l),
            0
        ],
        n: [
            -Math.sin(p) * Math.cos(l),
            -Math.sin(p) * Math.sin(l),
            Math.cos(p)
        ],
        u: [
            Math.cos(p) * Math.cos(l),
            Math.cos(p) * Math.sin(l),
            Math.sin(p)
        ]
    };
}
export function frame(c) {
    const { e, n, u } = enu(c.lon, c.lat);
    const t = toEcef(c.lon, c.lat, 0);
    const fwd = axpy(Math.sin(c.heading), e, n.map((x)=>x * Math.cos(c.heading)));
    const back = axpy(-Math.sin(c.tilt), fwd, u.map((x)=>x * Math.cos(c.tilt)));
    const eye = axpy(c.range, back, t);
    const dir = back.map((x)=>-x);
    const up = axpy(Math.cos(c.tilt), fwd, u.map((x)=>x * Math.sin(c.tilt)));
    return {
        eye,
        dir,
        up,
        right: cross(dir, up)
    };
}
export function project(c, w, h, p) {
    const { eye, dir, up, right } = frame(c);
    const v = [
        p[0] - eye[0],
        p[1] - eye[1],
        p[2] - eye[2]
    ];
    const z = dot(v, dir);
    if (z <= 1e-9) return null;
    const f = 1 / Math.tan(FOV_Y / 2);
    return [
        (dot(v, right) / z * (f / (w / h)) * 0.5 + 0.5) * w,
        (0.5 - dot(v, up) / z * f * 0.5) * h
    ];
}
export function onNearSide(c, p) {
    const { eye } = frame(c);
    return dot(p, [
        eye[0] - p[0],
        eye[1] - p[1],
        eye[2] - p[2]
    ]) > 0;
}
export function pick(c, w, h, x, y) {
    const { eye, dir, up, right } = frame(c);
    const f = 1 / Math.tan(FOV_Y / 2);
    const sx = (x / w * 2 - 1) * (w / h) / f, sy = (1 - y / h * 2) / f;
    let d = [
        dir[0] + right[0] * sx + up[0] * sy,
        dir[1] + right[1] * sx + up[1] * sy,
        dir[2] + right[2] * sx + up[2] * sy
    ];
    const l = Math.hypot(d[0], d[1], d[2]);
    d = d.map((v)=>v / l);
    const b = dot(eye, d), cc = dot(eye, eye) - EARTH_R * EARTH_R, disc = b * b - cc;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const p = axpy(t, d, eye);
    return [
        Math.atan2(p[1], p[0]) * 180 / Math.PI,
        Math.asin(Math.max(-1, Math.min(1, p[2] / EARTH_R))) * 180 / Math.PI
    ];
}
export function clampCam(c) {
    return {
        lon: ((c.lon + 180) % 360 + 360) % 360 - 180,
        lat: Math.max(-85, Math.min(85, c.lat)),
        range: Math.max(MIN_RANGE, Math.min(MAX_RANGE, c.range)),
        heading: c.heading,
        tilt: Math.max(0, Math.min(MAX_TILT, c.tilt))
    };
}
export function drag(c, dx, dy, _w, h) {
    const s = c.range * 2 * Math.tan(FOV_Y / 2) / h;
    const east = (-dx * Math.cos(c.heading) + dy * Math.sin(c.heading)) * s;
    const north = (dx * Math.sin(c.heading) + dy * Math.cos(c.heading)) * s;
    return clampCam({
        ...c,
        lon: c.lon + east / (EARTH_R * Math.cos(c.lat * Math.PI / 180)) * (180 / Math.PI),
        lat: c.lat + north / EARTH_R * (180 / Math.PI)
    });
}
export function zoomAt(c, factor, x, y, w, h) {
    const g = pick(c, w, h, x, y);
    let n = clampCam({
        ...c,
        range: c.range * factor
    });
    if (!g) return n;
    for(let i = 0; i < 4; i++){
        const p = pick(n, w, h, x, y);
        if (!p) break;
        n = clampCam({
            ...n,
            lon: n.lon + (g[0] - p[0]),
            lat: n.lat + (g[1] - p[1])
        });
    }
    return n;
}
export function flyBetween(a, b, t) {
    if (t <= 0) return {
        ...a
    };
    if (t >= 1) return {
        ...b
    };
    const e = t * t * (3 - 2 * t);
    const lerp = (x, y)=>x + (y - x) * e;
    return {
        lon: lerp(a.lon, b.lon),
        lat: lerp(a.lat, b.lat),
        range: Math.exp(lerp(Math.log(a.range), Math.log(b.range))),
        heading: lerp(a.heading, b.heading),
        tilt: lerp(a.tilt, b.tilt)
    };
}
export function viewProj(c, aspect, origin) {
    const { eye, dir, up, right } = frame(c);
    const dEye = Math.hypot(eye[0], eye[1], eye[2]);
    const alt = dEye - EARTH_R;
    const near = Math.max(0.05, (alt - 12) * 0.5);
    const far = Math.sqrt(Math.max(0, dEye * dEye - EARTH_R * EARTH_R)) + 100;
    const er = [
        eye[0] - origin[0],
        eye[1] - origin[1],
        eye[2] - origin[2]
    ];
    const f = 1 / Math.tan(FOV_Y / 2);
    const V = [
        right,
        up,
        dir.map((x)=>-x)
    ];
    const tv = V.map((r)=>-dot(r, er));
    const P = [
        f / aspect,
        f,
        (far + near) / (near - far),
        2 * far * near / (near - far)
    ];
    const m = new Float32Array(16);
    for(let col = 0; col < 3; col++){
        m[col * 4 + 0] = P[0] * V[0][col];
        m[col * 4 + 1] = P[1] * V[1][col];
        m[col * 4 + 2] = P[2] * V[2][col];
        m[col * 4 + 3] = -V[2][col];
    }
    m[12] = P[0] * tv[0];
    m[13] = P[1] * tv[1];
    m[14] = P[2] * tv[2] + P[3];
    m[15] = -tv[2];
    return {
        m,
        eyeRel: er,
        near,
        far
    };
}
