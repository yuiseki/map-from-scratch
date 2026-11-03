import test from 'node:test';
import assert from 'node:assert/strict';
import { extrude, footprints, toLocal } from './mesh.ts';
import type { Poly } from './gml.ts';

// Rings 75 m wide, as edges of bands 0..15.
const EDGES = Array.from({ length: 16 }, (_, i) => 75 * (i + 1));

const LAT0 = 35.6812, LON0 = 139.7671;
// A 20 m x 10 m box with its base at 4 m and its roof at 39.6 m, written as
// PLATEAU writes a lod1Solid: bottom, top and four walls, rings closed.
function boxSolid(dx0: number, dy0: number, w: number, d: number, z0: number, z1: number): Poly[] {
  const mLat = 1 / 110940, mLon = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
  const c = [[dx0, dy0], [dx0 + w, dy0], [dx0 + w, dy0 + d], [dx0, dy0 + d]].map(([x, y]) => [LAT0 + y * mLat, LON0 + x * mLon]);
  const ring = (pts: number[][], zs: number[]) => {
    const r: number[] = [];
    pts.forEach((p, i) => r.push(p[0], p[1], zs[i]));
    r.push(pts[0][0], pts[0][1], zs[0]);
    return r;
  };
  const polys: Poly[] = [[ring(c, [z0, z0, z0, z0])], [ring([...c].reverse(), [z1, z1, z1, z1])]];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    polys.push([ring([a, b, b, a], [z0, z0, z1, z1])]);
  }
  return polys;
}

test('toLocal puts the centre at the origin, east at +x and north at +y, in metres', () => {
  assert.deepEqual(toLocal(LAT0, LON0, LAT0, LON0), [0, 0]);
  const [x, y] = toLocal(LAT0 + 0.001, LON0 + 0.001, LAT0, LON0);
  assert.ok(Math.abs(y - 110.9) < 0.5, `north ${y}`);
  assert.ok(Math.abs(x - 90.5) < 0.5, `east ${x}`);
});

test('footprints keeps the bottom faces only and reads the height from the solid', () => {
  const f = footprints(boxSolid(100, 50, 20, 10, 4, 39.6), LAT0, LON0);
  assert.equal(f.rings.length, 1, 'one bottom face; the top and the walls are not footprints');
  assert.equal(f.rings[0].length, 1);
  assert.equal(f.rings[0][0].length, 4 * 2, 'four corners, the closing point dropped');
  assert.ok(Math.abs(f.height - 35.6) < 1e-9);
  assert.ok(Math.abs(f.cx - 110) < 0.5 && Math.abs(f.cy - 55) < 0.5, `centroid ${f.cx},${f.cy}`);
});

test('extrude makes a bottom and a top vertex per corner, walls and a roof, with the band of the centroid', () => {
  const f = footprints(boxSolid(100, 50, 20, 10, 4, 39.6), LAT0, LON0);
  const verts: { x: number; y: number; h: number; band: number; top: number }[] = [];
  const idx: number[] = [];
  extrude(f, EDGES, verts, idx);
  assert.equal(verts.length, 8);
  assert.equal(verts.filter((v) => v.top).length, 4);
  assert.ok(verts.every((v) => Math.abs(v.h - 35.6) < 1e-9 && v.band === 1), 'every vertex carries the height and band (ring 75-150 m)');
  assert.equal(idx.length, 4 * 6 + 2 * 3, 'four wall quads and a two-triangle roof');
  const roof = idx.slice(24);
  assert.ok(roof.every((k) => verts[k].top === 1), 'the roof uses top vertices only');
  // Every wall quad spans the ground and the roof.
  for (let q = 0; q < 4; q++) {
    const tops = idx.slice(q * 6, q * 6 + 6).map((k) => verts[k].top);
    assert.ok(tops.includes(0) && tops.includes(1), `wall ${q}`);
  }
});

test('extrude appends after earlier buildings (indices are offset)', () => {
  const verts: { x: number; y: number; h: number; band: number; top: number }[] = [];
  const idx: number[] = [];
  extrude(footprints(boxSolid(0, 0, 5, 5, 0, 10), LAT0, LON0), EDGES, verts, idx);
  const n = idx.length;
  extrude(footprints(boxSolid(500, 0, 5, 5, 0, 20), LAT0, LON0), EDGES, verts, idx);
  assert.ok(idx.slice(n).every((k) => k >= 8));
  assert.equal(verts[8].band, 6);
});
