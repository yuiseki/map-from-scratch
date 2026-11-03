import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMesh, type Building } from './scene-data.ts';
import { makeView, project } from './camera.ts';

function meshBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(64 + 2 * 8 + 3 * 2);
  const dv = new DataView(buffer);
  for (const [i, c] of [...'BAG3'].entries()) dv.setUint8(i, c.charCodeAt(0));
  dv.setUint32(8, 2, true); dv.setUint32(12, 3, true);
  dv.setFloat64(20, 100, true); dv.setFloat64(28, 200, true); dv.setFloat64(36, 30, true);
  dv.setFloat32(44, 0.5, true); dv.setFloat32(48, 0.25, true); dv.setFloat32(52, 0.1, true);
  new Uint16Array(buffer, 64, 8).set([0, 0, 0, 1, 65535, 65535, 100, 2]);
  new Uint16Array(buffer, 80, 3).set([0, 1, 0]);
  return buffer;
}

const buildings: Building[] = [
  { id: 'a', year: null, ground: 10, roof: null, roofType: null, volume: 0 },
  { id: 'b', year: null, ground: 20, roof: null, roofType: null, volume: 0 },
  { id: 'c', year: null, ground: 40, roof: null, roofType: null, volume: 0 },
];

test('building mesh parser reads quantized geometry and centres the tile at median ground', () => {
  const mesh = parseMesh(meshBuffer(), buildings);
  assert.deepEqual([...mesh.vertices], [0, 0, 0, 1, 65535, 65535, 100, 2]);
  assert.deepEqual([...mesh.indices], [0, 1, 0]);
  assert.deepEqual(mesh.lo, [100, 200, 30]);
  assert.deepEqual(mesh.origin, [-16383.75, -8191.875, 30]);
  assert.equal(mesh.groundZ, 19.95);
});

test('building camera projects its target to the viewport centre', () => {
  const view = makeView({ az: 150, el: 42, radius: 900 }, [0, 0, 20], 800, 600);
  const center = project(view, [0, 0, 20]);
  assert.ok(center && Math.abs(center[0] - 400) < 1e-9 && Math.abs(center[1] - 300) < 1e-9);
  assert.equal(project(view, view.eye), null);
});

test('building mesh parser rejects a wrong binary signature', () => {
  const buffer = meshBuffer();
  new Uint8Array(buffer, 0, 4).set([0, 0, 0, 0]);
  assert.throws(() => parseMesh(buffer, buildings), /bad magic/);
});
