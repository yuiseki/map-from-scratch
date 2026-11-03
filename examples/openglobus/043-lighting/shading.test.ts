import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATMOSPHERE_RADIUS, ATMOSPHERE_THICKNESS, CITY_LIGHT_COLOR, GLOBE_FRAGMENT, NIGHT_FADE, SLIDERS, TERMINATOR_WRAP, ATMOSPHERE_FRAGMENT,
  defaultParams, glintPoint, glsl,
} from './shading.ts';

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: readonly number[]) => { const l = Math.hypot(a[0], a[1], a[2]); return a.map((v) => v / l); };

test('the sliders are the lighting parameters of the openglobus Lighting control', () => {
  const ids = SLIDERS.map((s) => s.id).sort();
  assert.deepEqual(ids, [
    'ambient_b', 'ambient_g', 'ambient_r', 'diffuse_b', 'diffuse_g', 'diffuse_r', 'exposure', 'gamma',
    'night', 'shininess', 'specular_b', 'specular_g', 'specular_r',
  ]);
  for (const s of SLIDERS) {
    assert.ok(s.min < s.max && s.value >= s.min && s.value <= s.max, `${s.id} default inside its range`);
    assert.ok(s.step > 0 && s.step <= (s.max - s.min) / 50, `${s.id} has at least 50 steps`);
  }
  // openglobus: colour sliders reach 5, shininess 100, nightlight 5.
  assert.equal(SLIDERS.find((s) => s.id === 'shininess')!.max, 100);
  assert.equal(SLIDERS.find((s) => s.id === 'night')!.max, 5);
  assert.equal(SLIDERS.find((s) => s.id === 'diffuse_r')!.max, 5);
});

test('default params gather the slider defaults into the uniforms the shader reads', () => {
  const p = defaultParams();
  const v = (id: string) => SLIDERS.find((s) => s.id === id)!.value;
  assert.deepEqual(p.ambient, [v('ambient_r'), v('ambient_g'), v('ambient_b')]);
  assert.deepEqual(p.specular, [v('specular_r'), v('specular_g'), v('specular_b')]);
  assert.equal(p.shininess, v('shininess'));
  assert.equal(p.night, v('night'));
  for (const name of ['uAmbient', 'uDiffuse', 'uSpecular', 'uShininess', 'uNight', 'uExposure', 'uGamma']) {
    assert.ok(GLOBE_FRAGMENT.includes(`uniform `) && GLOBE_FRAGMENT.includes(name), `shader reads ${name}`);
  }
});

test('shader constants come from the exported values', () => {
  assert.ok(GLOBE_FRAGMENT.includes(glsl(TERMINATOR_WRAP)), 'terminator wrap');
  assert.ok(GLOBE_FRAGMENT.includes(`smoothstep(${glsl(NIGHT_FADE[0])}, ${glsl(NIGHT_FADE[1])}`), 'night fade');
  assert.ok(GLOBE_FRAGMENT.includes(`vec3(${CITY_LIGHT_COLOR.map(glsl).join(', ')})`), 'city light colour');
  assert.ok(ATMOSPHERE_FRAGMENT.includes(`(b - 1.0) / ${glsl(ATMOSPHERE_THICKNESS)}`), 'atmosphere thickness');
  assert.equal(glsl(1), '1.0');
  assert.equal(glsl(-0.12), '-0.12');
});

test('city lights fade in only once the sun is below the horizon, and the terminator is soft but narrow', () => {
  // Fade ends below 2 deg of sun elevation, starts below -2 deg, and spans at least 3 deg.
  const elev = (c: number) => Math.asin(c) * 180 / Math.PI;
  assert.ok(elev(NIGHT_FADE[1]) <= 2, `lights gone above ${elev(NIGHT_FADE[1])} deg`);
  assert.ok(elev(NIGHT_FADE[0]) <= -2, `fully on below ${elev(NIGHT_FADE[0])} deg`);
  assert.ok(elev(NIGHT_FADE[1]) - elev(NIGHT_FADE[0]) >= 3, 'smooth fade');
  assert.ok(TERMINATOR_WRAP > 0 && elev(TERMINATOR_WRAP) < 10, 'wrap lights no more than 10 deg past the terminator');
});

test('atmosphere shell is thin: a few percent of the radius', () => {
  assert.ok(ATMOSPHERE_RADIUS > 1.005 && ATMOSPHERE_RADIUS <= 1.03, `${ATMOSPHERE_RADIUS}`);
});

test('glint point obeys the law of reflection for a camera at finite distance', () => {
  const sun = norm([1, 0.3, 0.5]);
  const eye = [0.4, 0.2, 3];
  const p = glintPoint(sun, eye);
  assert.ok(Math.abs(Math.hypot(p[0], p[1], p[2]) - 1) < 1e-9, 'on the unit sphere');
  const view = norm([eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]]);
  const angleIn = Math.acos(dot(p, sun)), angleOut = Math.acos(dot(p, view));
  assert.ok(Math.abs(angleIn - angleOut) < 1e-6, `incidence ${angleIn} = reflection ${angleOut}`);
  // coplanar: n lies in the plane of sun and view
  const c = [sun[1] * view[2] - sun[2] * view[1], sun[2] * view[0] - sun[0] * view[2], sun[0] * view[1] - sun[1] * view[0]];
  assert.ok(Math.abs(dot(c, p)) < 1e-6, 'coplanar');
});

test('glint is under the camera when the sun is behind the camera', () => {
  const p = glintPoint([0, 0, 1], [0, 0, 3]);
  assert.ok(Math.abs(p[2] - 1) < 1e-9);
});
