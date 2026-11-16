import assert from 'node:assert/strict';
import test from 'node:test';
import { projectVintage, countryTint, splitAtDateline } from './vintage.ts';

test('vintage projection keeps equator/prime meridian at the center and poles bounded', () => {
  assert.deepEqual(projectVintage(0, 0), [0.5, 0.5]);
  assert.deepEqual(projectVintage(-180, 90), [0, 0]);
  assert.deepEqual(projectVintage(180, -90), [1, 1]);
});

test('vintage country tints cycle within the muted atlas palette', () => {
  assert.equal(countryTint(0), '#c4aa78');
  assert.equal(countryTint(6), countryTint(0));
  assert.notEqual(countryTint(1), countryTint(0));
});

test('dateline splitting avoids drawing a spurious line across the entire map', () => {
  assert.deepEqual(splitAtDateline([[170, 10], [179, 12], [-179, 13], [-170, 8]]), [
    [[170, 10], [179, 12]], [[-179, 13], [-170, 8]],
  ]);
});
