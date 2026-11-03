import test from 'node:test';
import assert from 'node:assert/strict';
import { orbit, pan, zoomAt } from './controls.ts';
import { frame, project, unproject, metresPerPixel, MAX_PITCH, MAX_ZOOM, type View } from './camera.ts';

const base = (): View => ({ lon: 140.4, lat: 39.7, zoom: 9, pitch: 0, bearing: 0, centerH: 0, width: 1280, height: 800 });

test('dragging right turns the bearing like MapLibre, dragging up tilts towards the horizon, within limits', () => {
  const v = base();
  orbit(v, 100, 0);
  assert.ok(v.bearing < 0, `bearing ${v.bearing}`);
  orbit(v, 0, -100);
  assert.ok(v.pitch > 0, `pitch ${v.pitch}`);
  orbit(v, 0, -10000);
  assert.equal(v.pitch, MAX_PITCH);
  orbit(v, 0, 10000);
  assert.equal(v.pitch, 0);
  orbit(v, 1e5, 0);
  assert.ok(v.bearing > -180 && v.bearing <= 180);
});

test('panning moves the ground with the pointer, at bearing 0 and rotated', () => {
  for (const bearing of [0, 90, -57]) {
    const v = { ...base(), bearing };
    const f0 = frame(v);
    const target = unproject(f0, 640 + 10, 400 + 10, 0)!;     // a ground point near the centre
    const [x0, y0] = project(f0, target[0], target[1], 0)!;
    pan(v, 120, 80);
    const [x1, y1] = project(frame(v), target[0], target[1], 0)!;
    assert.ok(Math.abs(x1 - x0 - 120) < 3 && Math.abs(y1 - y0 - 80) < 3, `bearing ${bearing}: moved ${x1 - x0}, ${y1 - y0}`);
  }
  // 100 px east at zoom 9 is 100 metres-per-pixel.
  const v = base();
  pan(v, -100, 0);
  const m = (v.lon - 140.4) * (Math.PI / 180) * 6371008.8 * Math.cos((39.7 * Math.PI) / 180);
  assert.ok(Math.abs(m - 100 * metresPerPixel(9, 39.7)) < 100 * metresPerPixel(9, 39.7) * 0.02);
});

test('wheel zoom keeps the ground under the pointer, pitched too', () => {
  for (const pitch of [0, 60]) {
    const v = { ...base(), pitch, bearing: 30 };
    const [sx, sy] = [900, 560];
    const before = unproject(frame(v), sx, sy, 0)!;
    zoomAt(v, sx, sy, 0.7);
    assert.ok(Math.abs(v.zoom - 9.7) < 1e-9);
    const [x, y] = project(frame(v), before[0], before[1], 0)!;
    assert.ok(Math.hypot(x - sx, y - sy) < 2, `pitch ${pitch}: ${x}, ${y}`);
  }
  const v = base();
  zoomAt(v, 640, 400, 100);
  assert.equal(v.zoom, MAX_ZOOM);
});
