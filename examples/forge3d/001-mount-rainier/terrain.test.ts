import assert from 'node:assert/strict';
import test from 'node:test';
import { groundAt, heightAt, parseRelief, project, summitWorld, worldOf, makeView } from './terrain.ts';

function rainierBuffer(): ArrayBuffer {
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

test('Rainier relief parser restores its elevation grid and geographic metadata', () => {
  const relief = parseRelief(rainierBuffer());
  assert.equal(relief.width, 2);
  assert.deepEqual(relief.bounds, [-1, -1, 1, 1]);
  assert.equal(heightAt(relief, 0.5, 0.5), 250);
  assert.deepEqual(worldOf(relief, 0.5, 0.5), [0, 0, 250]);
  assert.deepEqual(summitWorld(relief), [0, 0, 250]);
});

test('Rainier ground lookup and view projection handle outside and centered points', () => {
  const relief = parseRelief(rainierBuffer());
  assert.equal(groundAt(relief, 1000, 0), 0);
  const view = makeView({ az: 0, el: 30, radius: 1000 }, [0, 0, 250], 800, 600, () => 0);
  const center = project(view, [0, 0, 250]);
  assert.ok(center && Math.abs(center[0] - 400) < 1e-8 && Math.abs(center[1] - 300) < 1e-8);
});

test('Rainier relief parser rejects an unrelated binary format', () => {
  const buffer = rainierBuffer();
  new Uint8Array(buffer, 0, 4).set([0, 0, 0, 0]);
  assert.throws(() => parseRelief(buffer), /bad magic/);
});
