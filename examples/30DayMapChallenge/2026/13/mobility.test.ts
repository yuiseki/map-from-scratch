import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryShare, flowOffset, encodeMobilityFrame, decodeMobilityFrame, type MobilityFrame } from './mobility.ts';

const frame: MobilityFrame = { year: 2021, month: 10, municipalityCount: 2, flows: new Uint32Array(2 * 3 * 3 * 4) };
frame.flows[flowOffset(0, 2, 0, 0)] = 50;
frame.flows[flowOffset(0, 2, 0, 1)] = 30;
frame.flows[flowOffset(0, 2, 0, 2)] = 15;
frame.flows[flowOffset(0, 2, 0, 3)] = 5;

test('frame offsets keep each municipality, day type, timezone and category independent', () => {
  const offsets = new Set<number>();
  for (let city = 0; city < 2; city++) for (let day = 0; day < 3; day++) for (let time = 0; time < 3; time++) for (let area = 0; area < 4; area++) {
    offsets.add(flowOffset(city, day, time, area));
  }
  assert.equal(offsets.size, frame.flows.length);
  assert.equal(flowOffset(1, 2, 2, 3), frame.flows.length - 1);
  assert.throws(() => flowOffset(0, 3, 0, 0), /index/i);
});

test('category shares are normalized and empty/suppressed bins stay unknown', () => {
  assert.deepEqual(categoryShare([50, 30, 15, 5]), [0.5, 0.3, 0.15, 0.05]);
  assert.equal(categoryShare([0, 0, 0, 0]), null);
  assert.throws(() => categoryShare([1, -1, 0, 0]), /category/i);
});

test('MFR1 binary frame round-trips all day and timezone variants', () => {
  const bytes = encodeMobilityFrame(frame), decoded = decodeMobilityFrame(bytes);
  assert.equal(bytes.byteLength, 16 + frame.flows.byteLength);
  assert.equal(decoded.year, frame.year); assert.equal(decoded.month, frame.month);
  assert.equal(decoded.municipalityCount, frame.municipalityCount);
  assert.deepEqual([...decoded.flows], [...frame.flows]);
  assert.throws(() => decodeMobilityFrame(bytes.slice(0, 8)), /truncated|invalid/i);
  assert.throws(() => decodeMobilityFrame(bytes.slice(0, -4)), /length/i);
});
