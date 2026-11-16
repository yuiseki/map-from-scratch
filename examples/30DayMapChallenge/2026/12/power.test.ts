import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAccessSeries, encodeAccessSeries, powerColor, type AccessRecord } from './power.ts';

test('country electricity access uses a fixed 0–100 sequential scale with a distinct no-data fill', () => {
  const low = powerColor(0), middle = powerColor(50), high = powerColor(100), missing = powerColor(null);
  assert.notDeepEqual(low, middle);
  assert.notDeepEqual(middle, high);
  assert.notDeepEqual(high, missing);
  assert.deepEqual(powerColor(-5), low);
  assert.deepEqual(powerColor(105), high);
});

test('PWR1 series preserves ISO3 order, years, missing values and decimal percentages', () => {
  const records: AccessRecord[] = [
    { iso3: 'JPN', values: [null, 92.15, 100] },
    { iso3: 'COD', values: [1.25, 4.8, null] },
  ];
  const buffer = encodeAccessSeries(records, 1990);
  assert.equal(buffer.byteLength, 10 + 2 * (4 + 3 * 2));
  const decoded = decodeAccessSeries(buffer);
  assert.equal(decoded.startYear, 1990);
  assert.equal(decoded.yearCount, 3);
  assert.deepEqual(decoded.records, [
    { iso3: 'JPN', values: [null, 92.15, 100] },
    { iso3: 'COD', values: [1.25, 4.8, null] },
  ]);
});

test('PWR1 rejects invalid country codes, percentages and malformed data', () => {
  assert.throws(() => encodeAccessSeries([{ iso3: 'JP', values: [50] }], 2000), /ISO3/i);
  assert.throws(() => encodeAccessSeries([{ iso3: 'JPN', values: [101] }], 2000), /percentage/i);
  assert.throws(() => decodeAccessSeries(new ArrayBuffer(9)), /truncated/i);
});
