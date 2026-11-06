export const DEFAULT_TIP = 120;
export const DIAMETER_PER_TIP = 0.69;
export function parseMetres(s) {
    if (!s) return null;
    const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(m|ft|')?\s*$/.exec(s);
    if (!m) return null;
    const v = parseFloat(m[1]);
    return m[2] === 'ft' || m[2] === "'" ? v * 0.3048 : v;
}
export function turbineSize(tags) {
    const tip = parseMetres(tags.height), hub = parseMetres(tags['height:hub']), d = parseMetres(tags['rotor:diameter']);
    const r = (x)=>Math.round(x * 1000) / 1000;
    const make = (t, dd, source)=>{
        dd = Math.min(dd, t * 0.9);
        return {
            tip: r(t),
            hub: r(t - dd / 2),
            diameter: r(dd),
            source
        };
    };
    if (tip && d) return make(tip, d, 'tags');
    if (hub && d) return make(hub + d / 2, d, 'tags');
    if (tip) return make(tip, tip * DIAMETER_PER_TIP, 'height');
    if (hub) {
        const t = hub / (1 - DIAMETER_PER_TIP / 2);
        return make(t, t * DIAMETER_PER_TIP, 'hub');
    }
    if (d) return make(d / DIAMETER_PER_TIP, d, 'diameter');
    return make(DEFAULT_TIP, DEFAULT_TIP * DIAMETER_PER_TIP, 'default');
}
export const REF_HUB = 90;
export const REF_RADIUS = 50;
export const ROTOR_OFFSET = 4.6;
export function buildTurbineMesh(sides = 12) {
    const pos = [], nor = [], part = [];
    const tri = (a, b, c, n, pt, centre)=>{
        let nn = n;
        if (!nn) {
            const u = [
                b[0] - a[0],
                b[1] - a[1],
                b[2] - a[2]
            ], v = [
                c[0] - a[0],
                c[1] - a[1],
                c[2] - a[2]
            ];
            nn = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0]
            ];
            const m = [
                (a[0] + b[0] + c[0]) / 3 - centre[0],
                (a[1] + b[1] + c[1]) / 3 - centre[1],
                (a[2] + b[2] + c[2]) / 3 - centre[2]
            ];
            if (nn[0] * m[0] + nn[1] * m[1] + nn[2] * m[2] < 0) {
                nn = [
                    -nn[0],
                    -nn[1],
                    -nn[2]
                ];
                [b, c] = [
                    c,
                    b
                ];
            }
        }
        const l = Math.hypot(nn[0], nn[1], nn[2]);
        for (const p of [
            a,
            b,
            c
        ]){
            pos.push(...p);
            nor.push(nn[0] / l, nn[1] / l, nn[2] / l);
            part.push(pt);
        }
    };
    const quad = (a, b, c, d, pt, centre)=>{
        tri(a, b, c, null, pt, centre);
        tri(a, c, d, null, pt, centre);
    };
    const solid = (faces, pt)=>{
        const all = faces.flat(), centre = [
            0,
            0,
            0
        ];
        for (const p of all)for(let k = 0; k < 3; k++)centre[k] += p[k] / all.length;
        for (const f of faces)f.length === 3 ? tri(f[0], f[1], f[2], null, pt, centre) : quad(f[0], f[1], f[2], f[3], pt, centre);
    };
    const r0 = 2.4, r1 = 1.5, top = REF_HUB - 1.6, slope = (r0 - r1) / top;
    for(let s = 0; s < sides; s++){
        const a = s / sides * 2 * Math.PI, b = (s + 1) / sides * 2 * Math.PI;
        const n = (t)=>[
                Math.cos(t),
                Math.sin(t),
                slope
            ];
        const p = (t, r, z)=>[
                Math.cos(t) * r,
                Math.sin(t) * r,
                z
            ];
        const tri2 = (x, nx, y, ny, z, nz)=>{
            for (const [q, m] of [
                [
                    x,
                    nx
                ],
                [
                    y,
                    ny
                ],
                [
                    z,
                    nz
                ]
            ]){
                const l = Math.hypot(m[0], m[1], m[2]);
                pos.push(...q);
                nor.push(m[0] / l, m[1] / l, m[2] / l);
                part.push(0);
            }
        };
        tri2(p(a, r0, 0), n(a), p(b, r0, 0), n(b), p(b, r1, top), n(b));
        tri2(p(a, r0, 0), n(a), p(b, r1, top), n(b), p(a, r1, top), n(a));
    }
    const box = (x0, x1, y0, y1, z0, z1, pt)=>{
        const c = (i)=>[
                i & 1 ? x1 : x0,
                i & 2 ? y1 : y0,
                i & 4 ? z1 : z0
            ];
        solid([
            [
                c(0),
                c(1),
                c(3),
                c(2)
            ],
            [
                c(4),
                c(5),
                c(7),
                c(6)
            ],
            [
                c(0),
                c(1),
                c(5),
                c(4)
            ],
            [
                c(2),
                c(3),
                c(7),
                c(6)
            ],
            [
                c(0),
                c(2),
                c(6),
                c(4)
            ],
            [
                c(1),
                c(3),
                c(7),
                c(5)
            ]
        ], pt);
    };
    box(-1.7, 1.7, -3.2, ROTOR_OFFSET - 1.4, REF_HUB - 1.8, REF_HUB + 1.8, 0);
    box(-1.4, 1.4, -1.4, 2.2, -1.4, 1.4, 1);
    const th = 0.25;
    for(let k = 0; k < 3; k++){
        const a = Math.PI / 2 + k * 2 * Math.PI / 3;
        const d = [
            Math.cos(a),
            Math.sin(a)
        ], e = [
            -Math.sin(a),
            Math.cos(a)
        ];
        const at = (r, c, y)=>[
                d[0] * r + e[0] * c,
                y,
                d[1] * r + e[1] * c
            ];
        const rr = 1.2, lead = 0.9, trail = -2.6;
        const tip = (y)=>at(REF_RADIUS, 0, y);
        solid([
            [
                at(rr, lead, th),
                at(rr, trail, th),
                tip(th)
            ],
            [
                at(rr, lead, -th),
                at(rr, trail, -th),
                tip(-th)
            ],
            [
                at(rr, lead, th),
                tip(th),
                tip(-th),
                at(rr, lead, -th)
            ],
            [
                at(rr, trail, th),
                tip(th),
                tip(-th),
                at(rr, trail, -th)
            ],
            [
                at(rr, lead, th),
                at(rr, trail, th),
                at(rr, trail, -th),
                at(rr, lead, -th)
            ]
        ], 1);
    }
    return {
        position: new Float32Array(pos),
        normal: new Float32Array(nor),
        part: new Uint8Array(part),
        count: part.length
    };
}
export const CUT_IN = 3;
export const RATED = 12;
export const CUT_OUT = 25;
export const TIP_SPEED_RATIO = 7;
export function rotorOmega(wind, radius) {
    if (wind < CUT_IN || wind > CUT_OUT) return 0;
    return TIP_SPEED_RATIO * Math.min(wind, RATED) / radius;
}
export class RotorState {
    angles;
    gpu;
    radii;
    factors;
    constructor(radii, phases, factors){
        this.radii = radii;
        this.factors = factors ?? radii.map(()=>1);
        this.angles = Float64Array.from(phases, (p)=>(p % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
        this.gpu = Float32Array.from(this.angles);
    }
    advance(dt, wind) {
        const T = 2 * Math.PI;
        for(let i = 0; i < this.angles.length; i++){
            let a = this.angles[i] + dt * rotorOmega(wind, this.radii[i]) * this.factors[i];
            a %= T;
            if (a < 0) a += T;
            this.angles[i] = a;
            this.gpu[i] = a;
        }
    }
}
export function windForward(deg) {
    const a = deg * Math.PI / 180;
    return [
        Math.sin(a),
        Math.cos(a)
    ];
}
export function hash01(id) {
    let h = id % 2147483647 | 0;
    h = Math.imul(h ^ h >>> 16, 0x45d9f3b);
    h = Math.imul(h ^ h >>> 16, 0x45d9f3b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
