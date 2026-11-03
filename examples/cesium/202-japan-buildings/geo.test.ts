import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ecef, geodetic, frameAt, toLocal, fromLocal, gaussRadius, dropAt, cameraBasis, eyeLocal, altitude } from './geo.ts';

const near = (a: number, b: number, eps: number, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} vs ${b} (eps ${eps})`);

test('ECEF of the equator, the pole and a known point (Tokyo Station, GRS80)', () => {
  const [x0, y0, z0] = ecef(0, 0, 0);
  near(x0, 6378137, 1e-6); near(y0, 0, 1e-6); near(z0, 0, 1e-6);
  const [, , zp] = ecef(90, 0, 0);
  near(zp, 6356752.3142, 1e-3, 'polar radius');
  // Tokyo Station 35.68124N 139.76712E, h 0, as pyproj gives it
  // (EPSG:4979 -> EPSG:4978).
  const [x, y, z] = ecef(35.68124, 139.76712, 0);
  near(x, -3959665.191, 1e-3, 'x'); near(y, 3350073.460, 1e-3, 'y'); near(z, 3699520.399, 1e-3, 'z');
});

test('geodetic() inverts ecef() to a millimetre, at the ground and in orbit', () => {
  for (const [lat, lon, h] of [[35.68124, 139.76712, 0], [35.6895, 139.6917, 243], [-33.9, 151.2, 120000], [89.9, -20, 1e6]]) {
    const back = geodetic(...ecef(lat, lon, h));
    near(back[0], lat, 1e-9, 'lat'); near(back[1], lon, 1e-9, 'lon'); near(back[2], h, 1e-3, 'h');
  }
});

test('the local frame at Tokyo Station: east, north and up are its axes', () => {
  const f = frameAt(35.68124, 139.76712);
  const at = (lat: number, lon: number, h = 0) => toLocal(f, ecef(lat, lon, h));
  assert.ok(at(35.68124, 139.76712).every((v) => Math.abs(v) < 1e-6));
  const e = at(35.68124, 139.77712), n = at(35.69124, 139.76712), u = at(35.68124, 139.76712, 100);
  // 0.01 deg of longitude at 35.68N is 905 m, of latitude 1,110 m.
  near(e[0], 905.2, 1, 'east'); near(e[1], 0, 0.1); assert.ok(e[2] < 0 && e[2] > -0.1, 'east point drops below the tangent plane');
  near(n[1], 1109.5, 1, 'north'); near(n[0], 0, 1e-6);
  near(u[2], 100, 1e-6, 'up');
  const back = fromLocal(f, e);
  const ref = ecef(35.68124, 139.77712, 0);
  for (let i = 0; i < 3; i++) near(back[i], ref[i], 1e-6);
});

test('the osculating sphere matches the ellipsoid within 5 cm across the 15 km data area', () => {
  // dropAt is what the vertex shader adds to a building's height so that a
  // tangent-plane footprint sits on the sphere the ground is drawn on.
  const f = frameAt(35.68124, 139.76712), R = gaussRadius(35.68124);
  near(R, 6371262.8, 0.1, 'Gaussian radius sqrt(MN)');
  for (const [lat, lon] of [[35.62, 139.69], [35.73, 139.81], [35.68, 139.69]]) {
    const p = toLocal(f, ecef(lat, lon, 0));
    near(p[2], dropAt(p[0], p[1], R), 0.05, `ellipsoid vs sphere at ${lat},${lon}`);
  }
  // And it is a real drop: about 3.8 m at 7 km.
  near(dropAt(7000, 0, R), -3.85, 0.01);
});

test('a camera looking north and 30 deg down has its forward vector in the north-up plane, right pointing east', () => {
  const f = frameAt(35.68124, 139.76712);
  const b = cameraBasis(f, { lat: 35.68124, lon: 139.76712, h: 1000, heading: 0, pitch: -30 });
  near(b.fwd[0], 0, 1e-9); near(b.fwd[1], Math.cos(Math.PI / 6), 1e-9); near(b.fwd[2], -0.5, 1e-9);
  near(b.right[0], 1, 1e-9); near(b.up[2], Math.cos(Math.PI / 6), 1e-9);
  // Heading 90 looks east.
  const e = cameraBasis(f, { lat: 35.68124, lon: 139.76712, h: 1000, heading: 90, pitch: 0 });
  near(e.fwd[0], 1, 1e-9); near(e.right[1], -1, 1e-9);
  // Altitude above the sphere of a camera straight above the origin.
  near(altitude(eyeLocal(f, { lat: 35.68124, lon: 139.76712, h: 1000, heading: 0, pitch: 0 }), gaussRadius(35.68124)), 1000, 1e-6);
});
