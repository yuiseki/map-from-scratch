// Lighting parameters, their sliders and the shaders that use them. The
// constants that shape the picture are exported and spliced into the GLSL,
// so the tests read the same numbers the GPU does.
//
// The lighting model follows openglobus src/shaders/common/lighting.glsl
// (getPhongLighting: ambient + diffuse * N.L, specular * pow(R.V, shininess)
// masked to water) and its Lighting control (src/control/Lighting.ts):
// diffuse / ambient / specular RGB, shininess, nightlight, exposure, gamma.

/** Diffuse wrap past the terminator, in cos units: a soft edge of about asin(0.06) = 3.4 deg. */
export const TERMINATOR_WRAP = 0.06;
/** N.L range over which city lights fade out: fully on below -4.6 deg sun elevation, gone above 1.1 deg. */
export const NIGHT_FADE: readonly [number, number] = [-0.08, 0.02];
/** Warm sodium-like light colour for the populated-place glow (linear RGB). */
export const CITY_LIGHT_COLOR: readonly [number, number, number] = [1.0, 0.72, 0.38];
/** Atmosphere shell thickness in Earth radii (the real limb is 1-1.5 %; 2.5 % stays visible at globe scale). */
export const ATMOSPHERE_THICKNESS = 0.025;
export const ATMOSPHERE_RADIUS = 1 + ATMOSPHERE_THICKNESS;
export const ATMOSPHERE_COLOR: readonly [number, number, number] = [0.32, 0.6, 1.0];

export interface Slider { id: string; label: string; min: number; max: number; step: number; value: number }

// Ranges after openglobus' Lighting control: colours up to 5, shininess 100,
// nightlight 5. Defaults are this renderer's (linear units, not openglobus'
// HDR specular of 0.0006).
export const SLIDERS: readonly Slider[] = [
  { id: 'ambient_r', label: 'Ambient R', min: 0, max: 5, step: 0.01, value: 0.03 },
  { id: 'ambient_g', label: 'Ambient G', min: 0, max: 5, step: 0.01, value: 0.03 },
  { id: 'ambient_b', label: 'Ambient B', min: 0, max: 5, step: 0.01, value: 0.05 },
  { id: 'diffuse_r', label: 'Diffuse R', min: 0, max: 5, step: 0.01, value: 1.0 },
  { id: 'diffuse_g', label: 'Diffuse G', min: 0, max: 5, step: 0.01, value: 1.0 },
  { id: 'diffuse_b', label: 'Diffuse B', min: 0, max: 5, step: 0.01, value: 1.0 },
  { id: 'specular_r', label: 'Specular R', min: 0, max: 2, step: 0.01, value: 0.4 },
  { id: 'specular_g', label: 'Specular G', min: 0, max: 2, step: 0.01, value: 0.36 },
  { id: 'specular_b', label: 'Specular B', min: 0, max: 2, step: 0.01, value: 0.28 },
  { id: 'shininess', label: 'Shininess', min: 1, max: 100, step: 1, value: 40 },
  { id: 'night', label: 'Nightlight', min: 0, max: 5, step: 0.05, value: 0.7 },
  { id: 'exposure', label: 'Exposure', min: 0, max: 5, step: 0.05, value: 1.3 },
  { id: 'gamma', label: 'Gamma', min: 0.5, max: 5, step: 0.05, value: 2.2 },
];

export interface LightParams {
  ambient: [number, number, number];
  diffuse: [number, number, number];
  specular: [number, number, number];
  shininess: number;
  night: number;
  exposure: number;
  gamma: number;
  atmosphere: boolean;
}

export function paramsFrom(values: Readonly<Record<string, number>>, atmosphere = true): LightParams {
  const v = (id: string) => values[id];
  return {
    ambient: [v('ambient_r'), v('ambient_g'), v('ambient_b')],
    diffuse: [v('diffuse_r'), v('diffuse_g'), v('diffuse_b')],
    specular: [v('specular_r'), v('specular_g'), v('specular_b')],
    shininess: v('shininess'), night: v('night'), exposure: v('exposure'), gamma: v('gamma'), atmosphere,
  };
}

export function defaultParams(): LightParams {
  return paramsFrom(Object.fromEntries(SLIDERS.map((s) => [s.id, s.value])));
}

/** A GLSL float literal. */
export function glsl(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

const vec3 = (c: readonly number[]) => `vec3(${c.map(glsl).join(', ')})`;

export const VERTEX = `#version 300 es
in vec3 aPosition;
in vec2 aUv;
uniform mat4 uMatrix;
uniform float uRadius;
out vec3 vPos;
out vec2 vUv;
void main() {
  vPos = aPosition * uRadius;
  vUv = aUv;
  gl_Position = uMatrix * vec4(vPos, 1.0);
}`;

export const GLOBE_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vPos;
in vec2 vUv;
uniform sampler2D uDay;
uniform sampler2D uWater;
uniform sampler2D uLights;
uniform vec3 uSun;
uniform vec3 uEye;
uniform vec3 uAmbient;
uniform vec3 uDiffuse;
uniform vec3 uSpecular;
uniform float uShininess;
uniform float uNight;
uniform float uExposure;
uniform float uGamma;
out vec4 outColor;
void main() {
  vec3 n = normalize(vPos);
  vec3 v = normalize(uEye - vPos);
  float ndl = dot(n, uSun);
  vec3 albedo = pow(texture(uDay, vUv).rgb, vec3(2.2));
  float water = texture(uWater, vUv).r;
  float glow = texture(uLights, vUv).r;
  float lambert = clamp((ndl + ${glsl(TERMINATOR_WRAP)}) / ${glsl(1 + TERMINATOR_WRAP)}, 0.0, 1.0);
  vec3 color = albedo * (uAmbient + uDiffuse * lambert);
  vec3 r = reflect(-uSun, n);
  float spec = pow(max(dot(r, v), 0.0), max(uShininess, 1.0));
  color += uSpecular * spec * water * smoothstep(0.0, ${glsl(TERMINATOR_WRAP)}, ndl);
  float night = 1.0 - smoothstep(${glsl(NIGHT_FADE[0])}, ${glsl(NIGHT_FADE[1])}, ndl);
  color += ${vec3(CITY_LIGHT_COLOR)} * glow * glow * uNight * night;
  outColor = vec4(pow(clamp(color * uExposure, 0.0, 1.0), vec3(1.0 / uGamma)), 1.0);
}`;

// The shell is drawn over the globe; each fragment finds how close its view
// ray passes to the centre (b). Outside the Earth (b > 1) the glow falls off
// to the shell radius; inside it is a haze that thickens toward the limb.
export const ATMOSPHERE_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vPos;
in vec2 vUv;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uExposure;
uniform float uGamma;
out vec4 outColor;
void main() {
  vec3 d = normalize(vPos - uEye);
  float t = -dot(uEye, d);
  vec3 closest = uEye + d * t;
  float b = length(closest);
  float k = b < 1.0 ? 0.3 * pow(b, 24.0) : pow(1.0 - clamp((b - 1.0) / ${glsl(ATMOSPHERE_THICKNESS)}, 0.0, 1.0), 2.0);
  float lit = smoothstep(-0.25, 0.3, dot(normalize(closest), uSun));
  float a = k * (0.06 + 0.94 * lit);
  vec3 c = pow(clamp(${vec3(ATMOSPHERE_COLOR)} * uExposure, 0.0, 1.0), vec3(1.0 / uGamma));
  outColor = vec4(c, clamp(a, 0.0, 1.0));
}`;

/**
 * Where the sun's mirror image sits on a unit sphere seen from eye: the normal
 * halfway between the sun and the view direction from that point. Fixed-point
 * iteration; converges in a few steps for an eye outside the sphere.
 */
export function glintPoint(sun: readonly number[], eye: readonly number[]): [number, number, number] {
  const unit = (a: number[]): [number, number, number] => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
  const e = unit([...eye]);
  let n = unit([sun[0] + e[0], sun[1] + e[1], sun[2] + e[2]]);
  for (let i = 0; i < 100; i++) {
    const v = unit([eye[0] - n[0], eye[1] - n[1], eye[2] - n[2]]);
    const next = unit([sun[0] + v[0], sun[1] + v[1], sun[2] + v[2]]);
    const delta = Math.hypot(next[0] - n[0], next[1] - n[1], next[2] - n[2]);
    n = next;
    if (delta < 1e-13) break;
  }
  return n;
}
