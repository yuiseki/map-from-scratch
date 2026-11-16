import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeSegments, makeSegments, splitAntimeridian } from './tracks.ts';

test('track positions are ordered per SID and invalid or repeated positions are skipped', () => {
  const segments = makeSegments([
    { sid: 'b', time: '2020-01-02', lon: 1, lat: 1, basin: 'WP' },
    { sid: 'a', time: '2020-01-02', lon: 3, lat: 3, basin: 'NA' },
    { sid: 'a', time: '2020-01-01', lon: 2, lat: 2, basin: 'NA' },
    { sid: 'a', time: '2020-01-03', lon: 3, lat: 3, basin: 'NA' },
    { sid: 'a', time: '2020-01-04', lon: Number.NaN, lat: 4, basin: 'NA' },
  ]);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0], { a: [2, 2], b: [3, 3], basin: 'NA' });
});

test('antimeridian crossings become two short edge segments instead of a world-spanning chord', () => {
  const segments = splitAntimeridian([170, 10], [-170, 20], 'WP');
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0], { a: [170, 10], b: [180, 15], basin: 'WP' });
  assert.deepEqual(segments[1], { a: [-180, 15], b: [-170, 20], basin: 'WP' });
});

test('IBTrACS longitudes from 180 to 360 are wrapped before connecting across the antimeridian', () => {
  const segments = makeSegments([
    { sid: 'crossing', time: '2020-01-01', lon: 179, lat: 10, basin: 'WP' },
    { sid: 'crossing', time: '2020-01-02', lon: 181, lat: 12, basin: 'WP' },
  ]);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0], { a: [179, 10], b: [180, 11], basin: 'WP' });
  assert.deepEqual(segments[1], { a: [-180, 11], b: [-179, 12], basin: 'WP' });
});

test('GPU segment encoding preserves count, endpoint quantization, and basin class', () => {
  const encoded = encodeSegments([{ a: [-180, -90], b: [180, 90], basin: 'WP' }]);
  const view = new DataView(encoded);
  assert.equal(view.getUint32(0, true), 1);
  assert.equal(encoded.byteLength, 16);
  assert.equal(view.getUint16(4, true), 0);
  assert.equal(view.getUint16(6, true), 65535);
  assert.equal(view.getUint8(12), 6);
});
