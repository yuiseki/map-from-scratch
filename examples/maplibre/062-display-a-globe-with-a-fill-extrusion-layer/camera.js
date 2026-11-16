export const FOV_Y = 30 * Math.PI / 180;
export const FLAT_PITCH = 40 * Math.PI / 180;
export const NEAR = 0.01;
export const MIN_DIST = 1.25, MAX_DIST = 9;
const RAD = Math.PI / 180;
export const MODEL_POS_GLSL = `
vec3 modelPos(float lon, float lat, float h) {
  float dl = radians(lon - uCenter.x + uOffset), la = radians(lat), la0 = radians(uCenter.y);
  float r = 1.0 + h;
  vec3 g = r * vec3(cos(la) * sin(dl), sin(la), cos(la) * cos(dl));
  g = vec3(g.x, g.y * cos(la0) - g.z * sin(la0), g.y * sin(la0) + g.z * cos(la0));
  vec3 f = vec3(dl, la - la0, 1.0 + h);
  return mix(g, f, uT);
}`;
export function modelPos(cam, lon, lat, h, offset = 0) {
    const dl = (lon - cam.lon + offset) * RAD, la = lat * RAD, la0 = cam.lat * RAD;
    const r = 1 + h;
    const gx = r * Math.cos(la) * Math.sin(dl), gy0 = r * Math.sin(la), gz0 = r * Math.cos(la) * Math.cos(dl);
    const gy = gy0 * Math.cos(la0) - gz0 * Math.sin(la0), gz = gy0 * Math.sin(la0) + gz0 * Math.cos(la0);
    const t = cam.t;
    return [
        gx + (dl - gx) * t,
        gy + (la - la0 - gy) * t,
        gz + (1 + h - gz) * t
    ];
}
function mul(a, b) {
    const o = new Float64Array(16);
    for(let c = 0; c < 4; c++)for(let r = 0; r < 4; r++){
        let s = 0;
        for(let k = 0; k < 4; k++)s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
    }
    return o;
}
export function viewMatrix(cam) {
    const p = -cam.t * FLAT_PITCH, c = Math.cos(p), s = Math.sin(p);
    const rx = Float64Array.of(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1);
    const t1 = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 1);
    const t2 = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1 - cam.dist, 1);
    return mul(t2, mul(rx, t1));
}
export function projMatrix(cam, aspect) {
    const f = 1 / Math.tan(FOV_Y / 2), n = NEAR, far = cam.dist + 4;
    return Float64Array.of(f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + n) / (n - far), -1, 0, 0, 2 * far * n / (n - far), 0);
}
export function viewProj(cam, w, h) {
    return Float32Array.from(mul(projMatrix(cam, w / h), viewMatrix(cam)));
}
function apply(m, [x, y, z]) {
    return [
        0,
        1,
        2,
        3
    ].map((r)=>m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
}
export function project(cam, w, h, lon, lat, hgt, offset = 0) {
    const m = mul(projMatrix(cam, w / h), viewMatrix(cam));
    const [x, y, z, q] = apply(m, modelPos(cam, lon, lat, hgt, offset));
    return [
        (x / q + 1) * w / 2,
        (1 - y / q) * h / 2,
        z / q
    ];
}
export function limbRadiusPx(cam, h) {
    return h / 2 * Math.tan(Math.asin(1 / cam.dist)) / Math.tan(FOV_Y / 2);
}
export function unproject(cam, w, h, px, py) {
    const f = Math.tan(FOV_Y / 2);
    let d = [
        (2 * px / w - 1) * f * (w / h),
        (1 - 2 * py / h) * f,
        -1
    ];
    let o = [
        0,
        0,
        0
    ];
    const p = -cam.t * FLAT_PITCH;
    if (cam.t >= 0.5) {
        const c = Math.cos(-p), s = Math.sin(-p);
        const rot = (v)=>[
                v[0],
                v[1] * c - v[2] * s,
                v[1] * s + v[2] * c
            ];
        o = rot([
            0,
            0,
            cam.dist - 1
        ]);
        o[2] += 1;
        d = rot(d);
        if (d[2] >= 0) return null;
        const k = (1 - o[2]) / d[2];
        if (k <= 0) return null;
        const dl = (o[0] + k * d[0]) / RAD, la = (o[1] + k * d[1]) / RAD + cam.lat;
        if (Math.abs(la) > 90) return null;
        let lon = cam.lon + dl;
        lon = ((lon + 180) % 360 + 360) % 360 - 180;
        return [
            lon,
            la
        ];
    }
    o = [
        0,
        0,
        cam.dist
    ];
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const b = o[2] * d[2];
    const disc = b * b - dd * (o[2] * o[2] - 1);
    if (disc < 0) return null;
    const k = (-b - Math.sqrt(disc)) / dd;
    const x = d[0] * k, y = d[1] * k, z = o[2] + d[2] * k;
    const la0 = cam.lat * RAD;
    const y0 = y * Math.cos(la0) + z * Math.sin(la0), z0 = -y * Math.sin(la0) + z * Math.cos(la0);
    const lat = Math.asin(Math.max(-1, Math.min(1, y0))) / RAD;
    let lon = cam.lon + Math.atan2(x, z0) / RAD;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return [
        lon,
        lat
    ];
}
