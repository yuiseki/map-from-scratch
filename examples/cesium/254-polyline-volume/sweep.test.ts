import assert from 'node:assert/strict';
import test from 'node:test';
import { shapeOutline, sweep, type SweepOptions, type Mesh } from './sweep.ts';

const R = 6371;
const opts = (o: Partial<SweepOptions> = {}): SweepOptions => ({ radius: 2, shape: 'circle', corner: 'round', mitreLimit: 2, roundStepDeg: 15, origin: [0, 0, 0], ...o });
const sub = (a: ArrayLike<number>, i: number) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: number[]) => { const l = len(v); return v.map((x) => x / l); };
// The ring a vertex belongs to and its position on it.
const ringsOf = (m: Mesh) => m.ringStart.length;
const ringVerts = (m: Mesh, r: number) => { const a = m.ringStart[r], b = r + 1 < m.ringStart.length ? m.ringStart[r + 1] : m.capStart; return [a, b]; };
// Up of a ring: the mean normal of the ring's vertices whose cross-section y is the largest.
const ringUp = (m: Mesh, r: number) => sub(m.frameUp, r);

test('shapes: a circle, a box and a seven-armed star as in the original', () => {
  const c = shapeOutline('circle'), b = shapeOutline('box'), s = shapeOutline('star');
  assert.ok(c.smooth && !b.smooth && !s.smooth);
  assert.ok(c.points.length >= 16);
  for (const [x, y] of c.points) assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-9);
  assert.equal(b.points.length, 4);
  assert.equal(s.points.length, 14);
  const radii = s.points.map(([x, y]) => Math.hypot(x, y));
  assert.ok(radii.every((r, i) => (i % 2 === 0 ? r > 1 : r < 1)), 'outer and inner points alternate');
});

test('a planar S-curve keeps the same up vector through the inflection (no flip)', () => {
  // in the x-y plane, up seeded along +z (the plane normal)
  const pts: number[][] = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([R + t * 100, 30 * Math.sin(t * 2 * Math.PI), 0]); }
  // seed is the radial direction of the first point: +x here, so rotate the
  // problem: move the curve so the radial is +z
  const zPts = pts.map(([x, y]) => [y, x - R, R]);
  const m = sweep([zPts.flat()], opts());
  for (let r = 0; r < ringsOf(m); r++) assert.ok(dot(ringUp(m, r), [0, 0, 1]) > 0.999, `ring ${r} up ${ringUp(m, r).map((v) => v.toFixed(3))}`);
});

test('on the sphere the rotation-minimising frame stays radial (the box stays upright) and never flips', () => {
  const pts: number[] = [];
  for (let i = 0; i <= 200; i++) {
    const lon = (135 + i * 0.03) * Math.PI / 180, lat = (35 + 0.4 * Math.sin(i / 12)) * Math.PI / 180;
    pts.push(R * Math.cos(lat) * Math.cos(lon), R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat));
  }
  const m = sweep([pts], opts({ shape: 'box' }));
  let worst = 0;
  for (let r = 0; r < ringsOf(m); r++) {
    const c = norm(sub(m.frameCentre, r));
    const ang = Math.acos(Math.min(1, dot(ringUp(m, r), c))) * 180 / Math.PI;
    worst = Math.max(worst, ang);
    if (r > 0) assert.ok(dot(ringUp(m, r), ringUp(m, r - 1)) > 0.99, `flip between rings ${r - 1} and ${r}`);
  }
  assert.ok(worst < 1, `up within 1° of the radial (worst ${worst.toFixed(3)}°)`);
});

test('a bend in the vertical plane turns up with the tangent (minimal rotation, not projection)', () => {
  // along +x on the sphere top (up = +z), then straight up the radial: up must become -x
  const m = sweep([[[-50, 0, R], [0, 0, R], [0, 0, R + 50]].flat()], opts({ corner: 'mitre', mitreLimit: 2 }));
  const last = ringUp(m, m.ringStart.length - 1);
  assert.ok(dot(last, [-1, 0, 0]) > 0.999, `up after the climb ${last.map((v) => v.toFixed(3))}`);
});

const bend = (deg: number) => {
  // along +x to the origin of a local frame on the sphere top, then turn by deg in the tangent plane
  const a = deg * Math.PI / 180;
  return [[-50, 0, R], [0, 0, R], [50 * Math.cos(a), 50 * Math.sin(a), R]].flat();
};
const maxOffsetAt = (m: Mesh, centre: number[]) => {
  let worst = 0, rings = 0;
  for (let r = 0; r < ringsOf(m); r++) {
    const c = sub(m.frameCentre, r);
    if (len([c[0] - centre[0], c[1] - centre[1], c[2] - centre[2]]) > 1e-6) continue;
    rings++;
    const [a, b] = ringVerts(m, r);
    for (let v = a; v < b; v++) worst = Math.max(worst, len(sub(m.offset, v)));
  }
  return { worst, rings };
};

test('mitre: a right-angle bend gets one ring stretched by sqrt 2 in the bisector plane', () => {
  const m = sweep([bend(90)], opts({ corner: 'mitre' }));
  const { worst, rings } = maxOffsetAt(m, [0, 0, R]);
  assert.equal(rings, 1);
  assert.ok(Math.abs(worst - 2 * Math.SQRT2) < 0.02, `mitre length ${worst}`);
});

test('mitre limit: a hairpin past the limit is rounded instead of spiking', () => {
  const m = sweep([bend(160)], opts({ corner: 'mitre', mitreLimit: 2 }));
  const { worst, rings } = maxOffsetAt(m, [0, 0, R]);
  assert.ok(worst <= 2 * 2 + 1e-6, `no spike beyond radius x limit (${worst.toFixed(2)})`);
  assert.ok(rings >= 160 / 15, `rounded with ${rings} rings`);
});

test('round: a right-angle bend fans rings about the corner at no more than the step, all at radius', () => {
  const m = sweep([bend(90)], opts({ corner: 'round', roundStepDeg: 15 }));
  const { worst, rings } = maxOffsetAt(m, [0, 0, R]);
  assert.ok(rings >= 7, `${rings} rings`);
  assert.ok(worst < 2 * 1.0001, `no ring stretched (${worst})`);
  let prevT: number[] | null = null;
  for (let r = 0; r < ringsOf(m); r++) {
    const t = sub(m.frameTangent, r);
    if (prevT) assert.ok(Math.acos(Math.min(1, dot(t, prevT))) * 180 / Math.PI <= 15 + 1e-6);
    prevT = t;
  }
});

test('no gap: every pair of consecutive rings is joined by a full band of triangles, and lines are not joined to each other', () => {
  const lineA = bend(120), lineB = bend(30).map((v, i) => (i % 3 === 1 ? v + 500 : v));
  for (const shape of ['circle', 'box', 'star'] as const) for (const corner of ['round', 'mitre'] as const) {
    const m = sweep([lineA, lineB], opts({ shape, corner }));
    const ringOfVertex = new Int32Array(m.capStart).fill(-1);
    for (let r = 0; r < ringsOf(m); r++) { const [a, b] = ringVerts(m, r); for (let v = a; v < b; v++) ringOfVertex[v] = r; }
    const bands = new Map<number, number>();
    for (let t = 0; t < m.index.length; t += 3) {
      const rs = [m.index[t], m.index[t + 1], m.index[t + 2]].filter((v) => v < m.capStart).map((v) => ringOfVertex[v]);
      if (rs.length < 3) continue; // a cap triangle
      const lo = Math.min(...rs), hi = Math.max(...rs);
      assert.ok(hi - lo <= 1, 'a triangle spans two neighbouring rings');
      if (hi === lo + 1) bands.set(lo, (bands.get(lo) ?? 0) + 1);
    }
    const sides = m.sidesPerRing;
    for (let r = 0; r + 1 < ringsOf(m); r++) {
      const sameLine = m.ringLine[r] === m.ringLine[r + 1];
      assert.equal(bands.get(r) ?? 0, sameLine ? 2 * sides : 0, `${shape}/${corner} band ${r}`);
    }
  }
});

test('both ends are capped, the distance along the line grows to the line length, the line id rides along', () => {
  const pts = bend(45);
  const m = sweep([pts, pts.map((v, i) => (i % 3 === 0 ? v + 300 : v))], opts({ shape: 'star' }));
  assert.equal(m.index.length / 3, m.bandTriangles + 4 * m.sidesPerRing, 'bands + 2 caps of one triangle per side, per line');
  let prev = -1;
  for (let r = 0; r < ringsOf(m); r++) {
    if (m.ringLine[r] !== 0) break;
    assert.ok(m.ringAlong[r] >= prev);
    prev = m.ringAlong[r];
  }
  assert.ok(Math.abs(prev - 100) < 1e-6, `along ends at 100 km (got ${prev})`);
  assert.deepEqual([...new Set(m.ringLine)], [0, 1]);
});

test('band triangles wind outwards (front faces survive back-face culling)', () => {
  for (const shape of ['circle', 'box', 'star'] as const) {
    const m = sweep([[[0, 0, R], [0, 40, R], [0, 80, R]].flat()], opts({ shape }));
    for (let t = 0; t < m.index.length; t += 3) {
      const [a, b, c] = [m.index[t], m.index[t + 1], m.index[t + 2]].map((v) => sub(m.centre, v).map((x, k) => x + sub(m.offset, v)[k]));
      const e1 = b.map((x, k) => x - a[k]), e2 = c.map((x, k) => x - a[k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (len(n) < 1e-9) continue;
      const vn = [m.normal[m.index[t] * 4], m.normal[m.index[t] * 4 + 1], m.normal[m.index[t] * 4 + 2]];
      assert.ok(dot(n, vn) > 0, `${shape} triangle ${t / 3} winds inwards`);
    }
  }
});

test('positions are relative to the origin, so float32 keeps metres near Japan', () => {
  const origin = [0, 0, R];
  const m = sweep([bend(10)], opts({ origin }));
  const c = sub(m.centre, 0);
  assert.ok(Math.abs(c[0] + 50) < 1e-3 && Math.abs(c[2]) < 1e-3);
});
