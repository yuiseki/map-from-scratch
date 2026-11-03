import assert from 'node:assert/strict';
import test from 'node:test';
import { iconWorldPosition } from './icon.ts';

test('generated cat icon is anchored at longitude and latitude zero', () => {
  assert.deepEqual(iconWorldPosition(), [0.5, 0.5]);
});
