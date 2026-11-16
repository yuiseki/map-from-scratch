export function mul(a, b) {
    const o = new Float64Array(16);
    for(let c = 0; c < 4; c++)for(let r = 0; r < 4; r++){
        let s = 0;
        for(let k = 0; k < 4; k++)s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
    }
    return o;
}
export function perspective(fovYDeg, aspect, near, far) {
    const f = 1 / Math.tan(fovYDeg * Math.PI / 360), o = new Float64Array(16);
    o[0] = f / aspect;
    o[5] = f;
    o[10] = (far + near) / (near - far);
    o[11] = -1;
    o[14] = 2 * far * near / (near - far);
    return o;
}
export function viewOf({ right: r, up: u, fwd: f }) {
    return new Float64Array([
        r[0],
        u[0],
        -f[0],
        0,
        r[1],
        u[1],
        -f[1],
        0,
        r[2],
        u[2],
        -f[2],
        0,
        0,
        0,
        0,
        1
    ]);
}
const norm = (v)=>{
    const l = Math.hypot(v[0], v[1], v[2]);
    return [
        v[0] / l,
        v[1] / l,
        v[2] / l
    ];
};
const cross = (a, b)=>[
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
export function lookAt(eye, target, upHint) {
    const fwd = norm([
        target[0] - eye[0],
        target[1] - eye[1],
        target[2] - eye[2]
    ]);
    const right = norm(cross(fwd, upHint)), up = cross(right, fwd);
    const v = viewOf({
        right,
        up,
        fwd
    });
    v[12] = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]);
    v[13] = -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]);
    v[14] = fwd[0] * eye[0] + fwd[1] * eye[1] + fwd[2] * eye[2];
    return v;
}
export function project(m, p, w, h) {
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    const q = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (q <= 0) return null;
    return [
        (x / q * 0.5 + 0.5) * w,
        (0.5 - y / q * 0.5) * h,
        z / q
    ];
}
export function nearFar(alt, R) {
    const h = Math.max(1, alt);
    const near = Math.max(0.5, h * 0.05);
    const far = Math.sqrt(h * (2 * R + h)) * 1.2 + 30000;
    return [
        near,
        far
    ];
}
