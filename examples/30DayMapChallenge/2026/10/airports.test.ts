import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAirports, encodeAirports, projectAirport, type Airport } from './airports.ts';

test('Equal Earth places east to the right, north above, and keeps the origin centered', () => {
  const origin = projectAirport(0, 0);
  const east = projectAirport(90, 0);
  const north = projectAirport(0, 60);
  assert.equal(origin[0], 0.5);
  assert.equal(origin[1], 0.5);
  assert.ok(east[0] > origin[0]);
  assert.ok(north[1] < origin[1]);
  assert.ok(projectAirport(180, 90).every((value) => value >= 0 && value <= 1));
});

test('airport encoding keeps type, scheduled service and coordinates in fixed-width records', () => {
  const airports: Airport[] = [
    { lon: 139.78, lat: 35.55, type: 'large_airport', scheduled: true },
    { lon: 139.45, lat: 36.4, type: 'heliport', scheduled: false },
    { lon: 140, lat: 35, type: 'small_airport', scheduled: false },
  ];
  const bytes = encodeAirports(airports);
  const data = new DataView(bytes);
  assert.equal(data.getUint32(0, true), 3);
  assert.equal(bytes.byteLength, 4 + 3 * 6);
  assert.equal(data.getUint8(4 + 4), 0); // large airport
  assert.equal(data.getUint8(4 + 5), 1); // scheduled service
  assert.equal(data.getUint8(4 + 6 + 4), 4); // heliport
  assert.equal(data.getUint8(4 + 6 + 5), 0);
  assert.equal(data.getUint8(4 + 12 + 4), 2); // small airport
  const decoded = decodeAirports(bytes);
  assert.equal(decoded.length, 3);
  assert.ok(Math.abs(decoded[0]!.x - 0.8412) < 0.002);
  assert.ok(Math.abs(decoded[0]!.y - 0.2361) < 0.002);
});

test('decoder refuses truncated data and invalid category bytes', () => {
  assert.throws(() => decodeAirports(new ArrayBuffer(3)), /truncated/i);
  assert.throws(() => decodeAirports(new ArrayBuffer(10)), /length/i);
  const bad = new DataView(new ArrayBuffer(10));
  bad.setUint32(0, 1, true);
  bad.setUint8(8, 6);
  assert.throws(() => decodeAirports(bad.buffer), /class/i);
});

test('invalid coordinates and unknown airport types cannot enter the render buffer', () => {
  assert.throws(() => encodeAirports([{ lon: 181, lat: 0, type: 'large_airport', scheduled: true }]), /coordinate/i);
  assert.throws(() => encodeAirports([{ lon: 0, lat: 91, type: 'large_airport', scheduled: true }]), /coordinate/i);
  assert.throws(() => encodeAirports([{ lon: 0, lat: 0, type: 'unknown', scheduled: false }]), /type/i);
});
