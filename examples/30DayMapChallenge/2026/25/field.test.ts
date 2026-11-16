import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEventRows, decodeEvents, encodeEvents, hitTestEvent, projectLongitudeLatitude, projectToScreen,
  seismicGlyph, sortEventsByTime, filterEventsThrough, validateEvent,
  type EarthquakeEvent, type ScreenEvent,
} from './field.ts';

const sample: EarthquakeEvent = {
  id: 'us6000test', longitude: 179.5, latitude: -12.25,
  magnitude: 6.2, depthKm: 125, time: 1750000000000,
};

test('validates exact source identity, coordinates, magnitude, depth, and epoch time', () => {
  assert.deepEqual(validateEvent(sample), sample);
  assert.throws(() => validateEvent({ ...sample, id: '' }), /event id/i);
  assert.throws(() => validateEvent({ ...sample, longitude: 181 }), /coordinate/i);
  assert.throws(() => validateEvent({ ...sample, latitude: -91 }), /coordinate/i);
  assert.throws(() => validateEvent({ ...sample, magnitude: Number.NaN }), /magnitude/i);
  assert.throws(() => validateEvent({ ...sample, depthKm: -1 }), /depth/i);
  assert.throws(() => validateEvent({ ...sample, time: 1.5 }), /time/i);
});

test('projects global coordinates and wraps the antimeridian around the view center', () => {
  const east = projectLongitudeLatitude(179.5, 10, 0);
  const wrappedWest = projectLongitudeLatitude(-179.5, 10, 0);
  const westCentered = projectLongitudeLatitude(-179.5, 10, 180);
  assert.ok(east.x > 0 && east.x < 1);
  assert.ok(wrappedWest.x < 0 && wrappedWest.x > -1);
  assert.ok(westCentered.x > 0 && westCentered.x < 1);
  assert.equal(projectLongitudeLatitude(180, 0).x, 0.5);
  assert.equal(projectLongitudeLatitude(-180, 0).x, -0.5);
  assert.equal(projectLongitudeLatitude(0, 0).y, 0.5);
  assert.ok(projectLongitudeLatitude(0, 80).y < projectLongitudeLatitude(0, -80).y);
  const camera = { centerX: 0, centerY: 0.5, scale: 100, width: 200, height: 100 };
  assert.ok(projectToScreen(projectLongitudeLatitude(0, 80), camera)[1]
    < projectToScreen(projectLongitudeLatitude(0, -80), camera)[1]);
});

test('magnitude monotonically enlarges and strengthens artistic traces; depth remains separate', () => {
  const weak = seismicGlyph(4.5, 12);
  const strong = seismicGlyph(8.8, 12);
  const shallow = seismicGlyph(6, 5);
  const deep = seismicGlyph(6, 500);
  assert.ok(strong.outerRadius > weak.outerRadius);
  assert.ok(strong.intensity > weak.intensity);
  assert.equal(weak.outerRadius, 2);
  assert.equal(weak.intensity, 0.18);
  assert.equal(strong.outerRadius, 11);
  assert.ok(Math.abs(strong.intensity - 0.86) < 1e-12);
  assert.ok(shallow.outerRadius === deep.outerRadius);
  assert.notEqual(shallow.depthBand, deep.depthBand);
  assert.equal(seismicGlyph(6, 69.999).depthBand, 'shallow');
  assert.equal(seismicGlyph(6, 70).depthBand, 'intermediate');
  assert.equal(seismicGlyph(6, 299.999).depthBand, 'intermediate');
  assert.equal(seismicGlyph(6, 300).depthBand, 'deep');
  assert.deepEqual(weak.ringScale, [0.38, 0.69, 1]);
});

test('orders by exact timestamp and filters a chronological sweep without changing records', () => {
  const later = { ...sample, id: 'later', time: sample.time + 1000 };
  const earlier = { ...sample, id: 'earlier', time: sample.time - 1000 };
  assert.deepEqual(sortEventsByTime([later, earlier, sample]).map((event) => event.id), ['earlier', sample.id, 'later']);
  assert.deepEqual(filterEventsThrough([later, earlier, sample], sample.time).map((event) => event.id), ['earlier', sample.id]);
});

test('deterministically encodes and decodes source fields including exact epoch milliseconds', () => {
  const source = [sample, { ...sample, id: 'other', longitude: -180, time: sample.time + 1 }];
  assert.deepEqual(decodeEvents(encodeEvents(source)), source);
  assert.equal(encodeEvents(source), encodeEvents(source));
  assert.throws(() => decodeEvents('{broken'), /invalid earthquake payload/i);
});

test('decodes the compact row format written by the data bake', () => {
  assert.deepEqual(decodeEventRows([[sample.id, sample.longitude, sample.latitude, sample.magnitude, sample.depthKm, sample.time]]), [sample]);
});

test('hit testing returns the nearest original event and honors the maximum radius', () => {
  const points: ScreenEvent[] = [
    { event: sample, x: 100, y: 100 },
    { event: { ...sample, id: 'near' }, x: 106, y: 100 },
  ];
  assert.equal(hitTestEvent(104, 101, points, 10)?.event.id, 'near');
  assert.equal(hitTestEvent(120, 100, points, 10), null);
});
