import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { discoverSpecDirs } from '../example-discovery.ts';
import { loadSpec } from '../../harness/lib/spec.ts';

const root = join(import.meta.dirname, '../..');

test('example discovery finds nested year/day specs and direct examples', () => {
  const dirs = discoverSpecDirs(join(root, 'examples'));
  const challenge = join(root, 'examples/30DayMapChallenge/2026/01');
  assert.ok(dirs.includes(challenge));
  assert.ok(dirs.includes(join(root, 'examples/03-quake-timeline')));
  assert.equal(loadSpec(challenge).id, '30DayMapChallenge-2026-01');
});
