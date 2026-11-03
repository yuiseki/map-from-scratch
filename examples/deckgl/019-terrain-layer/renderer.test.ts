import assert from 'node:assert/strict';
import test from 'node:test';
import { TerrainRenderer, type TerrainTile } from './renderer.ts';

test('terrain renderer releases both GPU textures when removing a cached tile', () => {
  const dem = {} as WebGLTexture, imagery = {} as WebGLTexture;
  const deleted: WebGLTexture[] = [];
  const renderer = Object.create(TerrainRenderer.prototype) as TerrainRenderer;
  Object.assign(renderer, {
    gl: { deleteTexture: (texture: WebGLTexture) => deleted.push(texture) },
    tiles: new Map<string, TerrainTile>([['12/1/2', { z: 12, x: 1, y: 2, dem, imagery, lastUsed: 0 }]]),
  });
  renderer.remove('12/1/2');
  assert.deepEqual(deleted, [dem, imagery]);
  assert.equal(renderer.tiles.size, 0);
});

test('terrain renderer ignores removal of an uncached tile', () => {
  const renderer = Object.create(TerrainRenderer.prototype) as TerrainRenderer;
  Object.assign(renderer, { gl: { deleteTexture: () => assert.fail('unexpected texture deletion') }, tiles: new Map() });
  assert.doesNotThrow(() => renderer.remove('missing'));
});
