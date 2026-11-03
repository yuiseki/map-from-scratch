import assert from 'node:assert/strict';
import test from 'node:test';
import { blockSize, planLabels, type Label } from './labels.ts';
import { parseRelief, viewFrom } from '../007-camera-flyover/terrain.ts';

const label = (name: string): Label => ({ name, en: 'Peak', ele: 100, u: 0.5, v: 0.5, rank: 1 });

function relief(): ReturnType<typeof parseRelief> {
  const buffer = new ArrayBuffer(62);
  const view = new DataView(buffer);
  for (const [i, c] of [...'RAIN'].entries()) view.setUint8(i, c.charCodeAt(0));
  view.setUint16(6, 2, true); view.setUint16(8, 2, true);
  view.setFloat32(10, -1, true); view.setFloat32(14, -1, true);
  view.setFloat32(18, 1, true); view.setFloat32(22, 1, true);
  view.setUint16(26, 100, true); view.setUint16(28, 100, true);
  view.setFloat32(30, 0.5, true); view.setFloat32(34, 0.5, true); view.setFloat32(38, 100, true);
  new Uint16Array(buffer, 42, 4).fill(100);
  return parseRelief(buffer);
}

test('label block sizing uses the wider line and omits the English line when empty', () => {
  assert.deepEqual(blockSize(label('Mt Fuji'), (text, px) => text.length * px / 2), [49, 28]);
  assert.deepEqual(blockSize({ ...label('富士山'), en: '' }, () => 30), [30, 14]);
});

test('label planner places non-overlapping labels and rejects extras as collisions', () => {
  const r = relief();
  const view = viewFrom([1000, 0, 1000], [0, 0, 100], 800, 600);
  const labels = Array.from({ length: 5 }, (_, i) => label(`peak-${i}`));
  const plan = planLabels(r, view, 1, labels, labels.map(() => [50, 25]));
  assert.equal(plan.placed.length, 2);
  assert.equal(plan.rejected.length, 3);
  assert.ok(plan.rejected.every((x) => x.reason === 'collision'));
  assert.equal(new Set(plan.placed.map((x) => x.side)).size, 2);
});
