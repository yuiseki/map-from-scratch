import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCumulusClouds,
  updateClouds,
  packCloudPuffs,
  type CloudPuff,
} from './clouds.ts';

test('createCumulusClouds creates expected number of cloud puffs within bounds', () => {
  const clusterCount = 5;
  const puffsPerCluster = 8;
  const bounds: [number, number, number] = [2000, 400, 2000];

  const puffs = createCumulusClouds(clusterCount, puffsPerCluster, bounds, 300);
  assert.strictEqual(puffs.length, clusterCount * puffsPerCluster);

  for (const p of puffs) {
    assert.ok(Math.abs(p.x) <= bounds[0] * 0.7, 'Cloud x within bounds');
    assert.ok(Math.abs(p.z) <= bounds[2] * 0.7, 'Cloud z within bounds');
    assert.ok(p.y >= 250 && p.y <= 450, 'Cloud altitude near base altitude');
    assert.ok(p.radius >= 20 && p.radius <= 160, 'Puff radius is valid');
  }
});

test('updateClouds moves clouds with wind drift and wraps around bounds', () => {
  const bounds: [number, number, number] = [1000, 400, 1000];
  const puffs: CloudPuff[] = [
    { x: 490, y: 300, z: 0, radius: 40, density: 1.0, clusterId: 0 },
  ];

  // Wind speed +50 m/s along X for 1.0 second moves x past boundary (+500)
  updateClouds(puffs, 1.0, [50, 0, 0], bounds);
  // 490 + 50 = 540 > 500 => wraps around to -460
  assert.ok(puffs[0].x < 0, 'Cloud wrapped to negative X boundary');
  assert.ok(Math.abs(puffs[0].x - (-460)) < 1.0);
});

test('packCloudPuffs produces packed Float32Array with correct stride', () => {
  const puffs: CloudPuff[] = [
    { x: 10, y: 20, z: 30, radius: 45, density: 0.9, clusterId: 1 },
    { x: 50, y: 60, z: 70, radius: 55, density: 0.8, clusterId: 1 },
  ];

  const stride = 5; // x, y, z, radius, density
  const buf = packCloudPuffs(puffs);
  assert.strictEqual(buf.length, puffs.length * stride);
  assert.strictEqual(buf[0], 10);
  assert.strictEqual(buf[1], 20);
  assert.strictEqual(buf[2], 30);
  assert.strictEqual(buf[3], 45);
  assert.ok(Math.abs(buf[4] - 0.9) < 1e-5);
});
