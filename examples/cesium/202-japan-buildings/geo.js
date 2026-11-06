export const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), B = A * (1 - F);
const D = Math.PI / 180;
export function ecef(latDeg, lonDeg, h) {
    const la = latDeg * D, lo = lonDeg * D, s = Math.sin(la), c = Math.cos(la);
    const n = A / Math.sqrt(1 - E2 * s * s);
    return [
        (n + h) * c * Math.cos(lo),
        (n + h) * c * Math.sin(lo),
        (n * (1 - E2) + h) * s
    ];
}
export function geodetic(x, y, z) {
    const p = Math.hypot(x, y), lon = Math.atan2(y, x);
    let lat = Math.atan2(z, p * (1 - E2)), h = 0;
    for(let i = 0; i < 10; i++){
        const s = Math.sin(lat), n = A / Math.sqrt(1 - E2 * s * s);
        h = Math.abs(Math.cos(lat)) > 1e-9 ? p / Math.cos(lat) - n : Math.abs(z) - B;
        lat = Math.atan2(z, p * (1 - E2 * n / (n + h)));
    }
    return [
        lat / D,
        lon / D,
        h
    ];
}
export function frameAt(latDeg, lonDeg) {
    const la = latDeg * D, lo = lonDeg * D;
    const sl = Math.sin(la), cl = Math.cos(la), so = Math.sin(lo), co = Math.cos(lo);
    return {
        lat: latDeg,
        lon: lonDeg,
        o: ecef(latDeg, lonDeg, 0),
        e: [
            -so,
            co,
            0
        ],
        n: [
            -sl * co,
            -sl * so,
            cl
        ],
        u: [
            cl * co,
            cl * so,
            sl
        ]
    };
}
const dot = (a, b)=>a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function toLocal(f, p) {
    const d = [
        p[0] - f.o[0],
        p[1] - f.o[1],
        p[2] - f.o[2]
    ];
    return [
        dot(d, f.e),
        dot(d, f.n),
        dot(d, f.u)
    ];
}
export function fromLocal(f, [x, y, z]) {
    return [
        0,
        1,
        2
    ].map((i)=>f.o[i] + x * f.e[i] + y * f.n[i] + z * f.u[i]);
}
export const dirToLocal = (f, v)=>[
        dot(v, f.e),
        dot(v, f.n),
        dot(v, f.u)
    ];
export function gaussRadius(latDeg) {
    const s = Math.sin(latDeg * D), w = 1 - E2 * s * s;
    return Math.sqrt(A * (1 - E2) / (w * Math.sqrt(w)) * (A / Math.sqrt(w)));
}
export const DROP_EXPR = '-(X * X + Y * Y) / (2.0 * R)';
export const dropAt = new Function('X', 'Y', 'R', `return ${DROP_EXPR};`);
export const dropGlsl = (x, y, r)=>DROP_EXPR.replace(/X/g, x).replace(/Y/g, y).replace(/R/g, r);
export const eyeLocal = (f, c)=>toLocal(f, ecef(c.lat, c.lon, c.h));
export function cameraBasis(f, c) {
    const g = frameAt(c.lat, c.lon);
    const e = dirToLocal(f, g.e), n = dirToLocal(f, g.n), u = dirToLocal(f, g.u);
    const hd = c.heading * D, pt = c.pitch * D;
    const ch = Math.cos(hd), sh = Math.sin(hd), cp = Math.cos(pt), sp = Math.sin(pt);
    const fwd = [
        0,
        1,
        2
    ].map((i)=>cp * (sh * e[i] + ch * n[i]) + sp * u[i]);
    const right = [
        0,
        1,
        2
    ].map((i)=>ch * e[i] - sh * n[i]);
    const up = [
        right[1] * fwd[2] - right[2] * fwd[1],
        right[2] * fwd[0] - right[0] * fwd[2],
        right[0] * fwd[1] - right[1] * fwd[0]
    ];
    return {
        right,
        up,
        fwd
    };
}
export const altitude = (p, R)=>Math.hypot(p[0], p[1], p[2] + R) - R;
