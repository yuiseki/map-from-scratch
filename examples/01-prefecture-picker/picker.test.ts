import assert from 'node:assert/strict';
import test from 'node:test';
import { pickPath } from './picker.ts';

test('picker selects the first path under a point and returns -1 outside all paths', () => {
  const paths = [{ id: 'first' }, { id: 'second' }].map(({ id }) => ({ path: { id } as unknown as Path2D }));
  const contains = new Set(['first', 'second']);
  const ctx = { isPointInPath: (path: Path2D) => contains.has((path as unknown as { id: string }).id) } as unknown as CanvasRenderingContext2D;
  assert.equal(pickPath(paths, ctx, 12, 34), 0);
  contains.delete('first');
  assert.equal(pickPath(paths, ctx, 12, 34), 1);
  contains.clear();
  assert.equal(pickPath(paths, ctx, 12, 34), -1);
});
