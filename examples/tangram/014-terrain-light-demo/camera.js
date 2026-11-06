export const TILT_MIN = 0.12, TILT_MAX = 1.5, DIST_MIN = 2500, DIST_MAX = 120000;
const ORBIT_PER_PX = 0.005, TILT_PER_PX = 0.004;
export function basis(c) {
    const sb = Math.sin(c.bearing), cb = Math.cos(c.bearing), st = Math.sin(c.tilt), ct = Math.cos(c.tilt);
    const f = [
        sb * ct,
        cb * ct,
        -st
    ], r = [
        cb,
        -sb,
        0
    ];
    const u = [
        r[1] * f[2] - r[2] * f[1],
        r[2] * f[0] - r[0] * f[2],
        r[0] * f[1] - r[1] * f[0]
    ];
    return {
        f,
        r,
        u
    };
}
export function eye(c) {
    const { f } = basis(c);
    return [
        c.tx - f[0] * c.dist,
        c.ty - f[1] * c.dist,
        c.tz - f[2] * c.dist
    ];
}
export function viewProj(c, aspect) {
    const { f, r, u } = basis(c);
    const n = c.dist * 0.02, fa = c.dist * 4, t = 1 / Math.tan(c.fovy / 2);
    const a = (fa + n) / (n - fa), b = 2 * fa * n / (n - fa);
    const m = new Float32Array(16);
    for(let k = 0; k < 3; k++){
        m[k * 4 + 0] = t / aspect * r[k];
        m[k * 4 + 1] = t * u[k];
        m[k * 4 + 2] = -a * f[k];
        m[k * 4 + 3] = f[k];
    }
    m[14] = b;
    return m;
}
export function project(c, p, w, h) {
    const e = eye(c), { f, r, u } = basis(c), t = 1 / Math.tan(c.fovy / 2);
    const d = [
        p[0] - e[0],
        p[1] - e[1],
        p[2] - e[2]
    ];
    const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    if (z <= 0) return null;
    const x = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) * t / (w / h) / z;
    const y = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) * t / z;
    return {
        x: (x + 1) * w / 2,
        y: (1 - y) * h / 2
    };
}
export function orbit(c, dx, dy) {
    c.bearing += dx * ORBIT_PER_PX;
    c.tilt = Math.min(TILT_MAX, Math.max(TILT_MIN, c.tilt + dy * TILT_PER_PX));
    return c;
}
export function zoomAt(c, factor, sx, sy, w, h) {
    const dist = Math.min(DIST_MAX, Math.max(DIST_MIN, c.dist * factor));
    const k = dist / c.dist;
    const { f, r, u } = basis(c), e = eye(c), th = Math.tan(c.fovy / 2);
    const nx = 2 * sx / w - 1, ny = 1 - 2 * sy / h;
    const d = [
        0,
        1,
        2
    ].map((i)=>f[i] + r[i] * nx * th * (w / h) + u[i] * ny * th);
    c.dist = dist;
    if (d[2] >= -1e-6) return c;
    const t = (c.tz - e[2]) / d[2];
    const px = e[0] + d[0] * t, py = e[1] + d[1] * t;
    c.tx = px + (c.tx - px) * k;
    c.ty = py + (c.ty - py) * k;
    return c;
}
export const ALT_MIN = Math.PI / 180;
export function lightFromPointer(sx, sy, w, h, bearing) {
    const dx = sx - w / 2, dy = sy - h / 2;
    const r = Math.min(1, Math.hypot(dx, dy) / (0.5 * Math.min(w, h)));
    return {
        az: bearing + Math.atan2(dx, -dy),
        alt: Math.max(ALT_MIN, Math.PI / 2 * (1 - r))
    };
}
