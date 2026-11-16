export const FOCAL = 1.75;
export const NEAR = 0.05;
export const FAR = 20;
export const MIN_DISTANCE = 2.2;
export const MAX_DISTANCE = 6;
export const LIFT = 1.004;
const RAD = Math.PI / 180;
export function unitVector(lon, lat) {
    const l = lon * RAD, p = lat * RAD;
    return [
        Math.sin(l) * Math.cos(p),
        Math.sin(p),
        Math.cos(l) * Math.cos(p)
    ];
}
export function multiply(a, b) {
    const out = new Float64Array(16);
    for(let c = 0; c < 4; c++)for(let r = 0; r < 4; r++){
        let s = 0;
        for(let k = 0; k < 4; k++)s += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = s;
    }
    return out;
}
export function clipMatrix(c, aspect) {
    const a = -c.lon * RAD, b = c.lat * RAD;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const rot = new Float64Array([
        ca,
        sb * sa,
        -cb * sa,
        0,
        0,
        cb,
        sb,
        0,
        sa,
        -sb * ca,
        cb * ca,
        0,
        0,
        0,
        0,
        1
    ]);
    const view = new Float64Array([
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        -c.distance,
        1
    ]);
    const nf = 1 / (NEAR - FAR);
    const proj = new Float64Array([
        FOCAL / aspect,
        0,
        0,
        0,
        0,
        FOCAL,
        0,
        0,
        0,
        0,
        (FAR + NEAR) * nf,
        -1,
        0,
        0,
        2 * FAR * NEAR * nf,
        0
    ]);
    return multiply(proj, multiply(view, rot));
}
export function cameraEye(c) {
    const u = unitVector(c.lon, c.lat);
    return [
        u[0] * c.distance,
        u[1] * c.distance,
        u[2] * c.distance
    ];
}
export function toClip(m, p) {
    const out = [
        0,
        0,
        0,
        0
    ];
    for(let r = 0; r < 4; r++)out[r] = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
    return out;
}
export function projectWorld(m, p, width, height) {
    const [x, y, , w] = toClip(m, p);
    if (w <= 1e-9) return null;
    return [
        (x / w + 1) / 2 * width,
        (1 - y / w) / 2 * height
    ];
}
export function facing(c, lon, lat) {
    const n = unitVector(lon, lat), e = cameraEye(c);
    const d = [
        e[0] - n[0] * LIFT,
        e[1] - n[1] * LIFT,
        e[2] - n[2] * LIFT
    ];
    return (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / Math.hypot(...d);
}
export function panelModel(lon, lat, w, h, s) {
    const n = unitVector(lon, lat);
    const l = lon * RAD, p = lat * RAD;
    const east = [
        Math.cos(l),
        0,
        -Math.sin(l)
    ];
    const north = [
        -Math.sin(l) * Math.sin(p),
        Math.cos(p),
        -Math.cos(l) * Math.sin(p)
    ];
    const o = [
        0,
        1,
        2
    ].map((i)=>n[i] * LIFT - east[i] * (w / 2) * s + north[i] * h * s);
    const matrix = new Float64Array([
        east[0] * s,
        east[1] * s,
        east[2] * s,
        0,
        -north[0] * s,
        -north[1] * s,
        -north[2] * s,
        0,
        n[0],
        n[1],
        n[2],
        0,
        o[0],
        o[1],
        o[2],
        1
    ]);
    return {
        matrix,
        lift: LIFT,
        at: (x, y)=>[
                0,
                1,
                2
            ].map((i)=>o[i] + matrix[i] * x + matrix[4 + i] * y)
    };
}
export function cssTransform(m, model, width, height) {
    const c = multiply(m, model.matrix);
    const out = new Float64Array(16);
    for(let col = 0; col < 4; col++){
        const x = c[col * 4], y = c[col * 4 + 1], w = c[col * 4 + 3];
        out[col * 4] = (x + w) * width / 2;
        out[col * 4 + 1] = (w - y) * height / 2;
        out[col * 4 + 2] = col === 2 ? 1 : 0;
        out[col * 4 + 3] = w;
    }
    out[8] = 0;
    out[9] = 0;
    out[11] = 0;
    return out;
}
export function applyCss(t, x, y) {
    const X = t[0] * x + t[4] * y + t[12];
    const Y = t[1] * x + t[5] * y + t[13];
    const W = t[3] * x + t[7] * y + t[15];
    return [
        X / W,
        Y / W
    ];
}
export function drag(c, dx, dy, viewHeight) {
    const pxPerUnit = FOCAL * viewHeight / 2 / (c.distance - 1);
    const lon = c.lon - dx / pxPerUnit / RAD;
    const lat = Math.max(-80, Math.min(80, c.lat + dy / pxPerUnit / RAD));
    return {
        lon: (lon + 540) % 360 - 180,
        lat,
        distance: c.distance
    };
}
export function zoom(distance, deltaY) {
    return Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance * Math.exp(deltaY * 0.001)));
}
