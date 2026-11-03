import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseMetres, turbineSize, DEFAULT_TIP, DIAMETER_PER_TIP, buildTurbineMesh, REF_HUB, REF_RADIUS,
  rotorOmega, CUT_IN, RATED, CUT_OUT, TIP_SPEED_RATIO, RotorState, windForward,
} from './turbine.ts';

test('parseMetres reads OSM lengths with and without units', () => {
  assert.equal(parseMetres('149.8 m'), 149.8);
  assert.equal(parseMetres('120'), 120);
  assert.equal(parseMetres('80m'), 80);
  assert.ok(Math.abs(parseMetres('328 ft')! - 99.97) < 0.01);
  assert.equal(parseMetres('tall'), null);
  assert.equal(parseMetres(undefined), null);
});

test('turbineSize: OSM height is the tip height, the hub sits half a rotor below it', () => {
  assert.deepEqual(turbineSize({ height: '149.8 m', 'rotor:diameter': '103' }), { tip: 149.8, hub: 98.3, diameter: 103, source: 'tags' });
  const h = turbineSize({ height: '149.8 m' });
  assert.equal(h.source, 'height');
  assert.ok(Math.abs(h.diameter - 149.8 * DIAMETER_PER_TIP) < 1e-9);
  assert.ok(Math.abs(h.hub + h.diameter / 2 - 149.8) < 1e-9);
  const d = turbineSize({});
  assert.equal(d.source, 'default');
  assert.equal(d.tip, DEFAULT_TIP);
  const hub = turbineSize({ 'height:hub': '80', 'rotor:diameter': '70' });
  assert.equal(hub.tip, 115);
});

test('every size keeps the blade tip above the ground', () => {
  for (const tags of [{}, { height: '30' }, { 'rotor:diameter': '120' }, { 'height:hub': '60' }]) {
    const s = turbineSize(tags);
    assert.ok(s.hub - s.diameter / 2 > 0, JSON.stringify(s));
  }
});

test('turbine mesh: the tower stands on z = 0 and reaches the reference hub height', () => {
  const m = buildTurbineMesh();
  let minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < m.count; v++) if (m.part[v] === 0) { minZ = Math.min(minZ, m.position[v * 3 + 2]); maxZ = Math.max(maxZ, m.position[v * 3 + 2]); }
  assert.equal(minZ, 0);
  assert.ok(maxZ >= REF_HUB && maxZ < REF_HUB * 1.08, `static top ${maxZ}`);
  assert.equal(m.position.length, m.count * 3);
  assert.equal(m.normal.length, m.count * 3);
  assert.equal(m.count % 3, 0);
});

test('turbine mesh: the rotor is three blades in the x-z plane, 120 degrees apart, of the reference radius', () => {
  const m = buildTurbineMesh();
  let maxR = 0, maxY = 0;
  const angles: number[] = [];
  for (let v = 0; v < m.count; v++) {
    if (m.part[v] !== 1) continue;
    const x = m.position[v * 3], y = m.position[v * 3 + 1], z = m.position[v * 3 + 2];
    const r = Math.hypot(x, z);
    maxR = Math.max(maxR, r);
    maxY = Math.max(maxY, Math.abs(y));
    if (r > REF_RADIUS * 0.9) angles.push(Math.atan2(z, x));
  }
  assert.ok(Math.abs(maxR - REF_RADIUS) < 1e-6, `max radius ${maxR}`);
  assert.ok(maxY < REF_RADIUS * 0.1, `rotor is ${maxY} thick along the axis`);
  const clusters = new Set(angles.map((a) => Math.round((((a * 180) / Math.PI + 360) % 360) / 10)));
  assert.equal(clusters.size, 3, [...clusters].join());
  const sorted = [...clusters].map((c) => c * 10).sort((a, b) => a - b);
  assert.ok(Math.abs(sorted[1] - sorted[0] - 120) <= 10 && Math.abs(sorted[2] - sorted[1] - 120) <= 10, sorted.join());
});

test('turbine mesh normals are unit length and face outwards from the tower axis', () => {
  const m = buildTurbineMesh();
  for (let v = 0; v < m.count; v++) {
    const n = Math.hypot(m.normal[v * 3], m.normal[v * 3 + 1], m.normal[v * 3 + 2]);
    assert.ok(Math.abs(n - 1) < 1e-5, `normal ${v} has length ${n}`);
  }
  // the first triangles are the tower wall: normal points away from the axis
  const x = m.position[0], y = m.position[1];
  assert.ok(m.normal[0] * x + m.normal[1] * y > 0);
});

test('rotor speed: still below cut-in and above cut-out, tip speed ratio up to rated wind', () => {
  assert.equal(rotorOmega(CUT_IN - 0.1, 50), 0);
  assert.equal(rotorOmega(CUT_OUT + 0.1, 50), 0);
  assert.ok(Math.abs(rotorOmega(8, 50) - (TIP_SPEED_RATIO * 8) / 50) < 1e-12);
  assert.equal(rotorOmega(20, 50), rotorOmega(RATED, 50));
  assert.ok(rotorOmega(8, 25) > rotorOmega(8, 50), 'a smaller rotor turns faster');
});

test('RotorState advances each rotor by its own speed, keeps angles in [0, 2pi) and never jumps when the wind changes', () => {
  const s = new RotorState([50, 25], [0, 1]);
  const a0 = [...s.angles];
  s.advance(0.1, 8);
  const d0 = s.angles[0] - a0[0], d1 = s.angles[1] - a0[1];
  assert.ok(d0 > 0 && d1 > 0);
  assert.ok(Math.abs(d1 / d0 - 2) < 0.25, `small rotor ratio ${d1 / d0}`);
  const start = s.angles[0];
  for (let i = 0; i < 1000; i++) s.advance(0.05, 12);
  for (const a of s.angles) assert.ok(a >= 0 && a < 2 * Math.PI, `angle ${a}`);
  // wrapping keeps the angle: it equals the integral modulo 2 pi
  const want = (start + 1000 * 0.05 * rotorOmega(12, 50)) % (2 * Math.PI);
  assert.ok(Math.abs(s.angles[0] - want) < 1e-6, `${s.angles[0]} vs ${want}`);
  const before = s.angles[0];
  s.advance(0.001, 3.5);
  assert.ok(Math.abs(s.angles[0] - before) < 0.01, 'a change of wind speed must not jump the rotor');
  const still = [...s.angles];
  s.advance(1, 0);
  assert.deepEqual([...s.angles], still);
});

test('windForward points the rotor into the wind (meteorological direction, from)', () => {
  const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
  assert.ok(close(windForward(0), [0, 1]));
  assert.ok(close(windForward(90), [1, 0]));
  assert.ok(close(windForward(270), [-1, 0]));
});
