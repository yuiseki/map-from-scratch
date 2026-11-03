import assert from 'node:assert/strict';
import test from 'node:test';
import { groundAt, heightAt, parseRelief, project, viewFrom, worldOf } from './terrain.ts';

function reliefBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(42 + 4 * 2 + 4 * 3);
  const view = new DataView(buffer);
  for (const [i, c] of [...'RAIN'].entries()) view.setUint8(i, c.charCodeAt(0));
  view.setUint16(6, 2, true); view.setUint16(8, 2, true);
  view.setFloat32(10, -1, true); view.setFloat32(14, -1, true);
  view.setFloat32(18, 1, true); view.setFloat32(22, 1, true);
  view.setUint16(26, 100, true); view.setUint16(28, 400, true);
  view.setFloat32(30, 0.5, true); view.setFloat32(34, 0.5, true); view.setFloat32(38, 100, true);
  new Uint16Array(buffer, 42, 4).set([100, 200, 300, 400]);
  return buffer;
}

test('Rainier relief decoder reads the height grid and bilinear center height', () => {
  const relief = parseRelief(reliefBuffer());
  assert.equal(relief.width, 2);
  assert.equal(heightAt(relief, 0, 0), 100);
  assert.equal(heightAt(relief, 1, 1), 400);
  assert.equal(heightAt(relief, 0.5, 0.5), 250);
  assert.deepEqual(worldOf(relief, 0.5, 0.5), [0, 0, 250]);
});

test('terrain projection centers the target and ground lookup returns zero outside the grid', () => {
  const relief = parseRelief(reliefBuffer());
  assert.equal(groundAt(relief, 1000, 0), 0);
  const view = viewFrom([1000, 0, 1000], [0, 0, 250], 800, 600);
  const center = project(view, [0, 0, 250]);
  assert.ok(center && Math.abs(center[0] - 400) < 1e-8 && Math.abs(center[1] - 300) < 1e-8);
  assert.equal(project(view, [2000, 0, 1750]), null);
});
