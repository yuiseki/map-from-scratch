export const FOV_Y = 36.87;
const sub = (a, b)=>[
        a[0] - b[0],
        a[1] - b[1],
        a[2] - b[2]
    ];
const dot = (a, b)=>a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b)=>[
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
const norm = (a)=>{
    const l = Math.hypot(a[0], a[1], a[2]);
    return [
        a[0] / l,
        a[1] / l,
        a[2] / l
    ];
};
export function makeView(c, w, h) {
    const b = c.bearing * Math.PI / 180, p = c.pitch * Math.PI / 180;
    const target = [
        c.cx,
        c.cy,
        0
    ];
    const eye = [
        c.cx - Math.sin(b) * Math.sin(p) * c.distance,
        c.cy - Math.cos(b) * Math.sin(p) * c.distance,
        Math.cos(p) * c.distance
    ];
    const fwd = norm(sub(target, eye));
    const right = [
        Math.cos(b),
        -Math.sin(b),
        0
    ], up = cross(right, fwd);
    const near = Math.max(1, 0.02 * c.distance), far = c.distance * 4 + 6000;
    const fy = 1 / Math.tan(FOV_Y / 2 * Math.PI / 180), fx = fy * h / w;
    const rows = [
        right.map((v)=>v * fx),
        up.map((v)=>v * fy)
    ];
    const za = (far + near) / (near - far), zb = 2 * far * near / (near - far);
    const m = new Float32Array(16);
    for(let col = 0; col < 3; col++){
        m[col * 4] = rows[0][col];
        m[col * 4 + 1] = rows[1][col];
        m[col * 4 + 2] = -fwd[col] * za;
        m[col * 4 + 3] = fwd[col];
    }
    m[12] = -dot(rows[0], eye);
    m[13] = -dot(rows[1], eye);
    m[14] = dot(fwd, eye) * za + zb;
    m[15] = -dot(fwd, eye);
    return {
        eye,
        fwd,
        right,
        up,
        f: h / 2 * fy,
        w,
        h,
        near,
        far,
        m
    };
}
export function project(v, p) {
    const d = sub(p, v.eye), z = dot(d, v.fwd);
    if (z <= v.near) return null;
    return [
        v.w / 2 + dot(d, v.right) * v.f / z,
        v.h / 2 - dot(d, v.up) * v.f / z
    ];
}
export function groundAt(v, sx, sy) {
    const a = (sx - v.w / 2) / v.f, bb = -(sy - v.h / 2) / v.f;
    const ray = [
        0,
        1,
        2
    ].map((k)=>v.fwd[k] + a * v.right[k] + bb * v.up[k]);
    if (ray[2] >= -1e-9) return null;
    const t = -v.eye[2] / ray[2];
    return [
        v.eye[0] + ray[0] * t,
        v.eye[1] + ray[1] * t
    ];
}
export function panBy(c, v, x0, y0, x1, y1) {
    const a = groundAt(v, x0, y0), b = groundAt(v, x1, y1);
    if (!a || !b) return c;
    return {
        ...c,
        cx: c.cx + a[0] - b[0],
        cy: c.cy + a[1] - b[1]
    };
}
export function zoomAt(c, v, sx, sy, k) {
    const z = {
        ...c,
        distance: Math.min(6000, Math.max(150, c.distance * k))
    };
    const a = groundAt(v, sx, sy), b = groundAt(makeView(z, v.w, v.h), sx, sy);
    if (!a || !b) return z;
    return {
        ...z,
        cx: z.cx + a[0] - b[0],
        cy: z.cy + a[1] - b[1]
    };
}
