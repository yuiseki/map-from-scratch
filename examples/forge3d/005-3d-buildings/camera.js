export const FOV_Y = 40;
const sub = (a, b)=>a.map((v, i)=>v - b[i]);
const dot = (a, b)=>a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b)=>[
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
const norm = (a)=>{
    const l = Math.hypot(a[0], a[1], a[2]);
    return a.map((v)=>v / l);
};
export function makeView(c, target, w, h) {
    const az = c.az * Math.PI / 180, el = c.el * Math.PI / 180;
    const eye = [
        target[0] + Math.sin(az) * Math.cos(el) * c.radius,
        target[1] + Math.cos(az) * Math.cos(el) * c.radius,
        Math.max(target[2] + Math.sin(el) * c.radius, 5)
    ];
    const fwd = norm(sub(target, eye));
    const right = norm(cross(fwd, [
        0,
        0,
        1
    ])), up = cross(right, fwd);
    const near = Math.max(1, 0.01 * c.radius), far = c.radius * 4 + 2000;
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
