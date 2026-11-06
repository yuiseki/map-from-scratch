export const VIEWS = {
    V1: {
        x: 0,
        y: 0,
        z: 20,
        yaw: 135,
        pitch: 30,
        dist: 1500
    },
    V2: {
        x: 0,
        y: 0,
        z: 0,
        yaw: 180,
        pitch: 89,
        dist: 2600
    },
    V3: {
        x: -110,
        y: 60,
        z: 15,
        yaw: 270,
        pitch: 15,
        dist: 220
    },
    V4: {
        x: -600,
        y: 0,
        z: 30,
        yaw: 90,
        pitch: 5,
        dist: 600
    }
};
export const FOVY = 45 * Math.PI / 180;
export const LIMITS = {
    pitch: [
        5,
        89
    ],
    dist: [
        60,
        3000
    ],
    half: 1000
};
const D = Math.PI / 180;
export function eyeOf(c) {
    const cp = Math.cos(c.pitch * D);
    return [
        c.x + c.dist * Math.sin(c.yaw * D) * cp,
        c.y + c.dist * Math.cos(c.yaw * D) * cp,
        c.z + c.dist * Math.sin(c.pitch * D)
    ];
}
export function mul(a, b) {
    const o = new Float64Array(16);
    for(let c = 0; c < 4; c++)for(let r = 0; r < 4; r++){
        let s = 0;
        for(let k = 0; k < 4; k++)s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
    }
    return o;
}
export function lookAt(e, t, up) {
    const norm = (v)=>{
        const l = Math.hypot(v[0], v[1], v[2]);
        return v.map((x)=>x / l);
    };
    const cross = (a, b)=>[
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    const dot = (a, b)=>a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const f = norm([
        t[0] - e[0],
        t[1] - e[1],
        t[2] - e[2]
    ]), s = norm(cross(f, up)), u = cross(s, f);
    return Float64Array.of(s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, e), -dot(u, e), dot(f, e), 1);
}
export function perspective(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2);
    return Float64Array.of(t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0);
}
export function ortho(l, r, b, t, n, f) {
    return Float64Array.of(2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1);
}
export function planes(m) {
    const p = new Float64Array(24), row = (r)=>[
            m[r],
            m[4 + r],
            m[8 + r],
            m[12 + r]
        ];
    const w = row(3);
    [
        row(0),
        row(1),
        row(2)
    ].forEach((r, i)=>{
        for(let k = 0; k < 4; k++){
            p[8 * i + k] = w[k] + r[k];
            p[8 * i + 4 + k] = w[k] - r[k];
        }
    });
    return p;
}
export function boxVisible(p, lo, hi) {
    for(let i = 0; i < 24; i += 4){
        const x = p[i] >= 0 ? hi[0] : lo[0], y = p[i + 1] >= 0 ? hi[1] : lo[1], z = p[i + 2] >= 0 ? hi[2] : lo[2];
        if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < 0) return false;
    }
    return true;
}
export const boxDistance = (e, lo, hi)=>Math.hypot(...[
        0,
        1,
        2
    ].map((k)=>Math.max(lo[k] - e[k], 0, e[k] - hi[k])));
export const farCorner = (e, lo, hi)=>Math.hypot(...[
        0,
        1,
        2
    ].map((k)=>Math.max(Math.abs(e[k] - lo[k]), Math.abs(e[k] - hi[k]))));
export function frame(c, aspect, boxes) {
    const eye = eyeOf(c), view = lookAt(eye, [
        c.x,
        c.y,
        c.z
    ], [
        0,
        0,
        1
    ]);
    const pl = planes(mul(perspective(FOVY, aspect, 0.5, 1e5), view));
    const visible = [];
    let nearest = Infinity, farthest = 0;
    boxes.forEach((b, i)=>{
        if (!boxVisible(pl, b.lo, b.hi)) return;
        if (i > 0) visible.push(i - 1);
        nearest = Math.min(nearest, boxDistance(eye, b.lo, b.hi));
        farthest = Math.max(farthest, farCorner(eye, b.lo, b.hi));
    });
    const near = Math.min(500, Math.max(1, nearest * 0.5));
    const far = Math.max(near * 2, farthest * 1.01);
    return {
        vp: mul(perspective(FOVY, aspect, near, far), view),
        eye,
        near,
        far,
        visible
    };
}
