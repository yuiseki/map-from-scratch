import assert from 'node:assert/strict';
import test from 'node:test';
import { centreline, pathKm } from './centreline.ts';

// 1 degree of longitude at 35° N is about 91.1 km; of latitude about 111.2 km.
const LAT = 35;
const KM_LON = 111.195 * Math.cos((LAT * Math.PI) / 180);
const KM_LAT = 111.195;
// A straight east-west track from lon 138 for `km` km, offset `northM` metres.
const track = (km: number, northM = 0, step = 0.2): number[][] => {
  const out: number[][] = [];
  for (let d = 0; d <= km + 1e-9; d += step) out.push([138 + d / KM_LON, LAT + northM / 1000 / KM_LAT]);
  return out;
};

test('two parallel tracks a few metres apart collapse into one centreline', () => {
  const path = centreline([track(50, 0), track(50, 8)], { cellKm: 0.5 });
  const km = pathKm(path);
  assert.ok(km > 48 && km < 51, `one line of ~50 km, not two (got ${km.toFixed(1)} km)`);
  for (const [, lat] of path) assert.ok(Math.abs(lat - LAT) * KM_LAT < 0.5, 'stays on the tracks');
});

test('the path runs end to end in order', () => {
  const path = centreline([track(30)], { cellKm: 0.5 });
  const xs = path.map((p) => p[0]);
  const increasing = xs.every((x, i) => i === 0 || x > xs[i - 1]);
  const decreasing = xs.every((x, i) => i === 0 || x < xs[i - 1]);
  assert.ok(increasing || decreasing, 'monotonic along a straight line');
  const span = Math.abs(xs[xs.length - 1] - xs[0]) * KM_LON;
  assert.ok(span > 29, `covers the whole line (${span.toFixed(1)} km)`);
});

test('a short spur (a depot track) is left out and the main line kept', () => {
  const spur: number[][] = [];
  for (let d = 0; d <= 4; d += 0.2) spur.push([138 + 25 / KM_LON, LAT + d / KM_LAT]);
  const path = centreline([track(50), spur], { cellKm: 0.5 });
  const maxNorth = Math.max(...path.map((p) => (p[1] - LAT) * KM_LAT));
  assert.ok(maxNorth < 0.5, `the spur is not on the path (reaches ${maxNorth.toFixed(2)} km north)`);
  assert.ok(pathKm(path) > 48);
});

test('platform rings and other small closed loops do not break the line', () => {
  const ring = [[138.1, LAT], [138.1, LAT + 0.001], [138.101, LAT + 0.001], [138.101, LAT], [138.1, LAT]];
  const path = centreline([track(20), ring], { cellKm: 0.5 });
  assert.ok(pathKm(path) > 19);
});

test('excluded cells (a section shared with an earlier line) are cut off', () => {
  const path = centreline([track(40)], { cellKm: 0.5, exclude: (lon) => (lon - 138) * KM_LON < 10 });
  const west = Math.min(...path.map((p) => (p[0] - 138) * KM_LON));
  assert.ok(west >= 9.5, `starts after the shared 10 km (starts at ${west.toFixed(2)} km)`);
  assert.ok(pathKm(path) > 28 && pathKm(path) < 31);
});

test('the largest piece wins when an exclusion splits the line', () => {
  // excluded 5..7 km: a 5 km piece and a 33 km piece remain
  const path = centreline([track(40)], { cellKm: 0.5, exclude: (lon) => { const d = (lon - 138) * KM_LON; return d > 5 && d < 7; } });
  assert.ok(pathKm(path) > 31, `kept the long piece (${pathKm(path).toFixed(1)} km)`);
});
