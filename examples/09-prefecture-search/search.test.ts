import assert from 'node:assert/strict';
import test from 'node:test';
import { findPrefecture } from './search.ts';

const prefs = [{ name: '東京都', code: '13' }, { name: '京都府', code: '26' }];

test('prefecture search trims input and returns the first substring match', () => {
  assert.equal(findPrefecture(' 東京 ', prefs), 0);
  assert.equal(findPrefecture('京都府', prefs), 1);
});

test('empty and unmatched queries do not select a prefecture', () => {
  assert.equal(findPrefecture('  ', prefs), -1);
  assert.equal(findPrefecture('大阪', prefs), -1);
});
