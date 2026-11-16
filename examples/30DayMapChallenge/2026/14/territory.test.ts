import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calibrationPxPerMm, groundScale, screenPoint, zoomAt, boundsIntersect,
  encodeTerritory, decodeTerritory, type BuildingFeature, type TerritoryView,
} from './territory.ts';

test('payment-card calibration converts its measured width to CSS pixels per millimetre', () => {
  assert.equal(calibrationPxPerMm(342.4), 4);
  assert.throws(() => calibrationPxPerMm(0), /positive/);
  assert.throws(() => calibrationPxPerMm(Number.NaN), /finite/);
});

test('Web Mercator ground-scale correction gives one local ground metre its physical pixel length', () => {
  assert.equal(groundScale(4, 0), 4000);
  assert.ok(Math.abs(groundScale(4, 35.7) - 3248.9) < 1);
  assert.throws(() => groundScale(4, 90), /Latitude/);
});

test('projected coordinates map to screen with north up and the calibrated local scale', () => {
  const view: TerritoryView = { centerX: 100, centerY: 200, pixelsPerProjectedMeter: 10, zoom: 1 };
  assert.deepEqual(screenPoint(100, 200, view, 800, 600), [400, 300]);
  assert.deepEqual(screenPoint(110, 180, view, 800, 600), [500, 500]);
});

test('zoom around a pointer keeps the same projected coordinate under it', () => {
  const view: TerritoryView = { centerX: 100, centerY: 200, pixelsPerProjectedMeter: 2, zoom: 1 };
  const anchor: [number, number] = [500, 250];
  const before = [view.centerX + (anchor[0] - 400) / 2, view.centerY - (anchor[1] - 300) / 2];
  const after = zoomAt(view, 3, anchor[0], anchor[1], 800, 600);
  const projectedAfter = [after.centerX + (anchor[0] - 400) / (after.pixelsPerProjectedMeter * after.zoom), after.centerY - (anchor[1] - 300) / (after.pixelsPerProjectedMeter * after.zoom)];
  assert.ok(Math.abs(projectedAfter[0]! - before[0]!) < 1e-9);
  assert.ok(Math.abs(projectedAfter[1]! - before[1]!) < 1e-9);
});

test('bbox intersection clips the bake query to the requested territory window', () => {
  const window = { xmin: 0, ymin: 0, xmax: 100, ymax: 100 };
  assert.equal(boundsIntersect(window, { xmin: 90, ymin: 90, xmax: 110, ymax: 110 }), true);
  assert.equal(boundsIntersect(window, { xmin: 101, ymin: 20, xmax: 120, ymax: 40 }), false);
});

test('BRG1 round-trips building identity, class and projected rings at sub-centimetre precision', () => {
  const features: BuildingFeature[] = [{
    id: 9_876_543_210n, kind: 'residential', rings: [new Float64Array([100, 200, 105.25, 200, 105.25, 208.75, 100, 208.75, 100, 200])],
  }];
  const bytes = encodeTerritory(features, { xmin: 0, ymin: 0, xmax: 200, ymax: 220 });
  const decoded = decodeTerritory(bytes);
  assert.deepEqual(decoded.bounds, { xmin: 0, ymin: 0, xmax: 200, ymax: 220 });
  assert.equal(decoded.features.length, 1);
  assert.equal(decoded.features[0]!.id, 9_876_543_210n);
  assert.equal(decoded.features[0]!.kind, 'residential');
  assert.deepEqual([...decoded.features[0]!.rings[0]!], [...features[0]!.rings[0]!]);
});

test('BRG1 retains centimetre detail at large EPSG:3857 absolute coordinates', () => {
  const bounds = { xmin: 15_551_260, ymin: 4_253_600, xmax: 15_551_760, ymax: 4_254_100 };
  const x = 15_551_300.25, y = 4_253_700.75;
  const ring = new Float64Array([x, y, x + 0.25, y, x + 0.25, y + 0.25, x, y + 0.25, x, y]);
  const decoded = decodeTerritory(encodeTerritory([{ id: -19_370_681n, kind: 'commercial', rings: [ring] }], bounds));
  assert.ok(Math.abs(decoded.features[0]!.rings[0]![2]! - (x + 0.25)) < 0.0001);
  assert.ok(Math.abs(decoded.features[0]!.rings[0]![5]! - (y + 0.25)) < 0.0001);
});

test('BRG1 rejects malformed bounds, truncated rings and unknown class ids', () => {
  assert.throws(() => encodeTerritory([], { xmin: 0, ymin: 0, xmax: 0, ymax: 1 }), /bounds/);
  assert.throws(() => decodeTerritory(new ArrayBuffer(7)), /truncated/i);
  const bad = encodeTerritory([{ id: 1n, kind: 'residential', rings: [new Float64Array([0, 0, 1, 0, 0, 1])] }], { xmin: 0, ymin: 0, xmax: 1, ymax: 1 });
  new DataView(bad).setUint8(48, 255);
  assert.throws(() => decodeTerritory(bad), /class/i);
});
