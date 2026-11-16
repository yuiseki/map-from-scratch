const normalize = (v)=>{
    const n = Math.hypot(...v) || 1;
    return [
        v[0] / n,
        v[1] / n,
        v[2] / n
    ];
};
export function multiply(a, b) {
    const [w, x, y, z] = a, [v, i, j, k] = b;
    return [
        w * v - x * i - y * j - z * k,
        w * i + x * v + y * k - z * j,
        w * j - x * k + y * v + z * i,
        w * k + x * j - y * i + z * v
    ];
}
export function versorBetween(from, to) {
    const a = normalize(from), b = normalize(to);
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    if (dot < -0.999999) {
        const axis = Math.abs(a[0]) < 0.8 ? normalize([
            0,
            -a[2],
            a[1]
        ]) : normalize([
            -a[1],
            a[0],
            0
        ]);
        return [
            0,
            axis[0],
            axis[1],
            axis[2]
        ];
    }
    const cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
    const q = [
        1 + dot,
        ...cross
    ];
    const n = Math.hypot(...q);
    return q.map((v)=>v / n);
}
export function rotateVector(q, v) {
    const p = [
        0,
        v[0],
        v[1],
        v[2]
    ], c = [
        q[0],
        -q[1],
        -q[2],
        -q[3]
    ];
    const r = multiply(multiply(q, p), c);
    return [
        r[1],
        r[2],
        r[3]
    ];
}
