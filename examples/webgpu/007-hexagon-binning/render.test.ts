import assert from 'node:assert/strict';
import test from 'node:test';
import { unitHexMesh } from './render.ts';

test('hexagon binning geometry contains 54 finite vertices with unit normals', () => {
  const mesh = unitHexMesh();
  assert.equal(mesh.length, 54 * 6);
  for (let i = 0; i < mesh.length; i += 6) {
    const [nx, ny, nz] = mesh.slice(i + 3, i + 6);
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-6);
    assert.ok([...mesh.slice(i, i + 6)].every(Number.isFinite));
  }
});
