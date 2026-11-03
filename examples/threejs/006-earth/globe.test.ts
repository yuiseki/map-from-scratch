import assert from 'node:assert/strict';
import test from 'node:test';
import { lonLatToUnitSphere } from './globe.ts';

test('longitude and latitude map to a unit sphere with the equator in XZ', () => {
  assert.deepEqual(lonLatToUnitSphere(0, 0), [0, 0, 1]);
  const east = lonLatToUnitSphere(90, 0);
  assert.ok(Math.abs(east[0] - 1) < 1e-12);
  assert.ok(Math.abs(east[1]) < 1e-12);
  assert.ok(Math.abs(east[2]) < 1e-12);
});

test('latitude reaches the poles independently of longitude', () => {
  const north = lonLatToUnitSphere(42, 90);
  const south = lonLatToUnitSphere(-125, -90);
  assert.ok(Math.abs(north[0]) < 1e-12 && Math.abs(north[2]) < 1e-12);
  assert.equal(north[1], 1);
  assert.ok(Math.abs(south[0]) < 1e-12 && Math.abs(south[2]) < 1e-12);
  assert.equal(south[1], -1);
});

test('normalizes longitude and rejects latitude outside the geographic domain', () => {
  assert.deepEqual(lonLatToUnitSphere(360, 0), lonLatToUnitSphere(0, 0));
  assert.throws(() => lonLatToUnitSphere(0, 90.01), RangeError);
});

test('sphere grid wraps longitude and emits outward-facing indexed triangles', async () => {
  const { createSphereGrid } = await import('./globe.ts');
  const mesh = createSphereGrid(8, 16);
  assert.equal(mesh.positions.length, 9 * 17 * 3);
  assert.equal(mesh.uvs.length, 9 * 17 * 2);
  assert.equal(mesh.indices.length, 8 * 16 * 6);
  const p = (index: number): [number, number, number] => [
    mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2],
  ];
  const seamNorth = p(4 * 17);
  const seamSouth = p(4 * 17 + 16);
  assert.deepEqual(seamNorth, seamSouth);
  assert.equal(mesh.uvs[(4 * 17) * 2], 0);
  assert.equal(mesh.uvs[(4 * 17 + 16) * 2], 1);
  const [ia, ib, ic] = mesh.indices.slice((4 * 16 + 8) * 6, (4 * 16 + 8) * 6 + 3);
  const a = p(ia), b = p(ib), c = p(ic);
  const ab = b.map((v, i) => v - a[i]) as [number, number, number];
  const ac = c.map((v, i) => v - a[i]) as [number, number, number];
  const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  assert.ok(cross[0] * (a[0] + b[0] + c[0]) + cross[1] * (a[1] + b[1] + c[1]) + cross[2] * (a[2] + b[2] + c[2]) > 0);
});

test('sphere grid rejects degenerate segment counts', async () => {
  const { createSphereGrid } = await import('./globe.ts');
  assert.throws(() => createSphereGrid(1, 16), RangeError);
  assert.throws(() => createSphereGrid(8, 2), RangeError);
});

test('drag changes yaw and clamps pitch; wheel distance stays within camera limits', async () => {
  const { rotateCamera, zoomDistance } = await import('./globe.ts');
  assert.deepEqual(rotateCamera(0.2, 0.1, 10, 20), [0.26, 0.18]);
  assert.deepEqual(rotateCamera(0, 1.14, 0, 100), [0, 1.15]);
  assert.equal(zoomDistance(3.4, -1000), 2.55);
  assert.equal(zoomDistance(3.4, 2000), 5.5);
});

test('texture rows: 90N samples the top image row, 90S the bottom, the equator the middle', async () => {
  const { createSphereGrid, texelForLonLat, imageRowForTextureV, TEXTURE_UNPACK_FLIP_Y } = await import('./globe.ts');
  assert.deepEqual(texelForLonLat(0, 90, 2048, 1024)[1], 0);
  assert.deepEqual(texelForLonLat(0, -90, 2048, 1024)[1], 1023);
  assert.deepEqual(texelForLonLat(0, 0, 2048, 1024)[1], 512);
  // Tokyo (139.69E, 35.69N) lies in the upper half of an equirectangular image.
  const [tokyoColumn, tokyoRow] = texelForLonLat(139.69, 35.69, 2048, 1024);
  assert.equal(tokyoColumn, Math.floor((139.69 + 180) / 360 * 2048));
  assert.equal(tokyoRow, Math.floor((90 - 35.69) / 180 * 1024));
  // The mesh's own v values, read through the renderer's upload convention.
  const mesh = createSphereGrid(8, 16);
  const vOfRow = (row: number) => mesh.uvs[row * 17 * 2 + 1];
  assert.equal(imageRowForTextureV(vOfRow(0), 1024, TEXTURE_UNPACK_FLIP_Y), 0);
  assert.equal(imageRowForTextureV(vOfRow(8), 1024, TEXTURE_UNPACK_FLIP_Y), 1023);
  assert.equal(imageRowForTextureV(vOfRow(4), 1024, TEXTURE_UNPACK_FLIP_Y), 512);
});

test('texture columns run west to east: the Americas west of Africa, China west of Japan', async () => {
  const { createSphereGrid, texelForLonLat } = await import('./globe.ts');
  const column = (lon: number) => texelForLonLat(lon, 0, 2048, 1024)[0];
  assert.equal(column(-180), 0);
  assert.equal(column(0), 1024);
  assert.equal(column(179.999), 2047);
  assert.ok(column(-60) < column(20));
  assert.ok(column(104) < column(139.7));
  // Mesh column c is at longitude -180 + 360c/16 and must carry u for that longitude.
  const mesh = createSphereGrid(8, 16);
  for (let c = 0; c <= 16; c++) assert.equal(mesh.uvs[(4 * 17 + c) * 2], c / 16);
});

test('the projected screen point follows the globe: east right, north up, drag direction follows the pointer', async () => {
  const { projectLonLat, rotateCamera } = await import('./globe.ts');
  const at = (lon: number, lat: number, yaw = 0, pitch = 0) => projectLonLat(lon, lat, yaw, pitch, 3.45, 1280, 800)!;
  const center = at(0, 0);
  assert.ok(Math.abs(center[0] - 640) < 1e-9 && Math.abs(center[1] - 400) < 1e-9);
  assert.ok(at(20, 0)[0] > center[0], 'east is to the right');
  assert.ok(at(0, 20)[1] < center[1], 'north is up (smaller CSS y)');
  assert.equal(projectLonLat(180, 0, 0, 0, 3.45, 1280, 800), null, 'the far side is hidden');
  // Dragging right/down moves the point under the pointer right/down.
  const [yaw, pitch] = rotateCamera(0, 0, 40, 30);
  const moved = at(0, 0, yaw, pitch);
  assert.ok(moved[0] > center[0] && moved[1] > center[1]);
  // The opening view (yaw 0.15) is centred on longitude -yaw.
  const opening = at(-0.15 * 180 / Math.PI, 0, 0.15, 0);
  assert.ok(Math.abs(opening[0] - 640) < 1e-9);
});
