import { horizonY } from './camera.js';
export const DEFAULT_SKY = {
    enabled: true,
    skyColor: '#1f5fbf',
    horizonColor: '#dce8f2',
    fogColor: '#aebfd0',
    skyHorizonBlend: 0.5,
    horizonFogBlend: 0.5,
    fogGroundBlend: 0.1
};
export const NO_SKY = '#ffffff';
export const FOG_FAR = 120000;
export function hexToRgb(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
    return [
        parseInt(m[1], 16) / 255,
        parseInt(m[2], 16) / 255,
        parseInt(m[3], 16) / 255
    ];
}
export function fogOpacity(pitch) {
    if (pitch < 60) return 0;
    if (pitch < 70) return (pitch - 60) / 10;
    return 1;
}
export function skyUniforms(s, pitch, heightCss, dpr, centreDistance) {
    return {
        sky: hexToRgb(s.skyColor),
        horizon: hexToRgb(s.horizonColor),
        fog: hexToRgb(s.fogColor),
        horizonFrag: (heightCss - horizonY(pitch, heightCss)) * dpr,
        skyBlendPx: s.skyHorizonBlend * (heightCss / 2) * dpr,
        fogNear: centreDistance,
        fogFar: Math.max(FOG_FAR, centreDistance * 1.5),
        fogOpacity: s.enabled ? fogOpacity(pitch) : 0,
        horizonFogBlend: s.horizonFogBlend,
        fogGroundBlend: s.fogGroundBlend
    };
}
export const RELIEF = [
    [
        0,
        '#7f9fb8'
    ],
    [
        2,
        '#a3b98a'
    ],
    [
        500,
        '#7fa463'
    ],
    [
        1200,
        '#557f45'
    ],
    [
        1900,
        '#6f7d4f'
    ],
    [
        2400,
        '#8f8573'
    ],
    [
        2800,
        '#b0a99f'
    ],
    [
        3200,
        '#f4f4f2'
    ]
];
export const SHADOW = '#473b24';
export const SUN = (()=>{
    const a = 335 * Math.PI / 180, e = Math.PI / 4;
    return [
        Math.sin(a) * Math.cos(e),
        Math.cos(a) * Math.cos(e),
        Math.sin(e)
    ];
})();
const vec3 = (hex)=>`vec3(${hexToRgb(hex).map((v)=>v.toFixed(4)).join(', ')})`;
export function reliefGlsl() {
    let s = `vec3 relief(float h) {\n  vec3 c = ${vec3(RELIEF[0][1])};\n`;
    for(let i = 1; i < RELIEF.length; i++){
        s += `  c = mix(c, ${vec3(RELIEF[i][1])}, smoothstep(${RELIEF[i - 1][0].toFixed(1)}, ${RELIEF[i][0].toFixed(1)}, h));\n`;
    }
    return s + '  return c;\n}\n' + `const vec3 SHADOW = ${vec3(SHADOW)};\nconst vec3 SUN = vec3(${SUN.map((v)=>v.toFixed(5)).join(', ')});\n`;
}
export const fogDepthGlsl = 'float fogDepth(float d) { return clamp(u_fog_far * (d - u_fog_near) / ((u_fog_far - u_fog_near) * d), 0.0, 1.0); }\n';
