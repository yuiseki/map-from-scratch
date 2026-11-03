import assert from 'node:assert/strict';
import test from 'node:test';
import { Forge3dPointCloud } from './cloud.ts';

test('point cloud projection centres the origin and scales horizontal movement with zoom', () => {
  const cloud = Object.create(Forge3dPointCloud.prototype) as Forge3dPointCloud;
  Object.assign(cloud, {
    canvas: { width: 800, height: 600 }, dpr: 1, yaw: 0, pitch: 0, zoom: 1,
  });
  assert.deepEqual(cloud.project(0, 0, 0), { sx: 400, sy: 330, depth: 0 });
  const point = cloud.project(1100, 0, 0);
  assert.ok(Math.abs(point.sx - 700) < 1e-9);
  cloud.zoom = 2;
  assert.ok(Math.abs(cloud.project(1100, 0, 0).sx - 1000) < 1e-9);
});

test('point cloud pitch changes projected elevation while keeping depth finite', () => {
  const cloud = Object.create(Forge3dPointCloud.prototype) as Forge3dPointCloud;
  Object.assign(cloud, {
    canvas: { width: 800, height: 600 }, dpr: 1, yaw: 0, pitch: Math.PI / 2, zoom: 1,
  });
  const point = cloud.project(0, 1100, 0);
  assert.ok(Math.abs(point.sy - 30) < 1e-9);
  assert.ok(Number.isFinite(point.depth));
});
