import { lonLatToTexel, texelToLocal } from './grid.js';
const RAD = Math.PI / 180;
export const VIEW = {
    lon: 138.735,
    lat: 35.38,
    targetH: 1000,
    bearing: 200 * RAD,
    tilt: 12 * RAD,
    dist: 25000,
    fovy: 38 * RAD
};
export const EXAG = 2;
export const LIGHT = {
    az: 295 * RAD,
    alt: 8 * RAD
};
const SUN_LOW = [
    1.0,
    0.5,
    0.25
], SUN_HIGH = [
    1.0,
    0.97,
    0.9
];
export function sunColor(alt) {
    const k = Math.min(1, Math.max(0, alt / (25 * RAD)));
    return SUN_LOW.map((v, i)=>v + (SUN_HIGH[i] - v) * k);
}
export const SUN_INTENSITY = 1.5;
export const ALBEDO = [
    [
        400,
        [
            0.07,
            0.17,
            0.05
        ]
    ],
    [
        1000,
        [
            0.11,
            0.21,
            0.07
        ]
    ],
    [
        1600,
        [
            0.20,
            0.22,
            0.10
        ]
    ],
    [
        2300,
        [
            0.27,
            0.17,
            0.10
        ]
    ],
    [
        2900,
        [
            0.32,
            0.22,
            0.15
        ]
    ],
    [
        3300,
        [
            0.70,
            0.70,
            0.72
        ]
    ],
    [
        3600,
        [
            0.90,
            0.91,
            0.94
        ]
    ]
];
export function albedoAt(h) {
    let a = ALBEDO[0][1];
    for(let k = 1; k < ALBEDO.length; k++){
        const t = Math.min(1, Math.max(0, (h - ALBEDO[k - 1][0]) / (ALBEDO[k][0] - ALBEDO[k - 1][0])));
        a = a.map((v, i)=>v + (ALBEDO[k][1][i] - v) * t);
    }
    return a;
}
export const WATER = [
    0.03,
    0.07,
    0.13
], SPECULAR = 1.4, SHININESS = 120;
export const ZENITH = [
    0.07,
    0.16,
    0.42
], HORIZON = [
    0.62,
    0.66,
    0.74
], SKY_TINT = 0.45;
export const SKY_EXPONENT = 0.45;
export const GLOW = 0.8, GLOW_POWER = 24;
export function horizonColor(light) {
    return HORIZON.map((v, i)=>v * (1 - SKY_TINT + SKY_TINT * light[i]));
}
export function skyAt(s, light) {
    const hz = horizonColor(light), k = Math.max(0, s) ** SKY_EXPONENT;
    return hz.map((v, i)=>v + (ZENITH[i] - v) * k);
}
export const AMBIENT = [
    0.16,
    0.19,
    0.25
];
export const HAZE_BEYOND = 5000, HAZE_SCALE = 25000, HAZE_MAX = 0.85;
export const hazeAt = (d, camDist)=>HAZE_MAX * (1 - Math.exp(-Math.max(0, d - camDist - HAZE_BEYOND) / HAZE_SCALE));
export const toScreen = (c)=>c.map((v)=>255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2));
export const luminance = (c)=>0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export function openingCam(g, hRef, exag = EXAG) {
    const t = lonLatToTexel(VIEW.lon, VIEW.lat, g), p = texelToLocal(t.i, t.j, g);
    return {
        tx: p.x,
        ty: p.y,
        tz: (VIEW.targetH - hRef) * exag,
        bearing: VIEW.bearing,
        tilt: VIEW.tilt,
        dist: VIEW.dist,
        fovy: VIEW.fovy
    };
}
