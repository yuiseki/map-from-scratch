import assert from 'node:assert/strict';
import test from 'node:test';
import { orbitCamera, project, MIN_PITCH, MIN_DISTANCE } from './camera.ts';
import { toLocal } from './terrain.ts';
import { OPENING, openingView } from './opening.ts';

// The 26 turbines north of 40.88N (Wind Farm Tsugaru and its neighbours) as
// baked into turbines.json: OSM id, local x, y (m). All are 3.2 MW machines
// with a 98.1 m hub and a 103.4 m rotor (OSM height 149.8 m). CI has no
// data/, so the test carries them.
const NORTH: [number, number, number][] = [
  [7483531450, 4934, 3856.6], [7483531451, 4131.3, 3815.6], [7483531452, 3848.4, 4062.2],
  [7483531460, 4639.8, 5021.8], [7483531461, 4878, 5298.7], [7483531462, 6281.3, 8343],
  [7483531463, 6487, 9158.5], [7483531464, 5793, 9009.8], [7483531465, 5464.6, 7710.5],
  [7483531466, 5270.6, 7494.1], [7483531467, 5882.8, 7418.4], [7483531468, 6190.1, 7649.2],
  [7483531469, 6751.4, 7429.2], [7483531470, 6964.8, 8742.1], [7483531471, 7168.3, 9269.8],
  [7483531472, 7033.9, 8334.3], [7483531473, 6940, 7727.6], [7483531474, 7173.7, 7965.6],
  [7483531475, 6268.6, 7868.2], [7483531476, 5541.3, 8007], [7483531477, 5545.8, 8268.5],
  [7483531478, 5553, 8539.8], [7483531479, 6202.7, 8121.5], [7483531480, 6287.6, 8607.4],
  [7483531481, 5784, 8767.8], [7483531482, 5878.8, 9281.6],
];
const HUB = 98.119, DIAMETER = 103.362, GROUND = 20;   // the coastal terrace is 15-25 m high
const turbines = NORTH.map(([id, x, y]) => ({ id, x, y, z: GROUND, hub: HUB, diameter: DIAMETER }));
const W = 1280, H = 800;
const LON0 = 140.25, LAT0 = 40.85;

function shot() {
  const view = openingView(turbines, () => GROUND);
  const cam = orbitCamera(view, W / H);
  const seen = turbines.map((t) => {
    const hub = project(cam.viewProj, [t.x, t.y, t.z + t.hub], W, H);
    const top = project(cam.viewProj, [t.x, t.y, t.z + t.hub + t.diameter / 2], W, H);
    const base = project(cam.viewProj, [t.x, t.y, t.z], W, H);
    return { t, hub, top, base, dist: Math.hypot(t.x - cam.eye[0], t.y - cam.eye[1], t.z + t.hub - cam.eye[2]) };
  }).sort((a, b) => a.dist - b.dist);
  return { view, cam, seen };
}
const inside = (p: [number, number, number] | null, m = 0) => !!p && p[0] >= m && p[0] < W - m && p[1] >= m && p[1] < H - m;

test('the opening view is a valid orbit: target, distance, heading and pitch within the camera limits', () => {
  const { view } = shot();
  assert.ok(view.pitch >= MIN_PITCH && view.pitch <= 10, `low oblique pitch ${view.pitch}`);
  assert.ok(view.distance >= MIN_DISTANCE, `distance ${view.distance}`);
  assert.ok(turbines.some((t) => t.id === OPENING.anchor), 'the anchor is a real turbine');
});

test('the nearest rotor is large: at least 150 px across at 1280x800, and wholly inside the frame', () => {
  const { seen } = shot();
  const near = seen[0];
  assert.ok(near.hub && near.top && near.base, 'nearest turbine in front of the eye');
  const across = 2 * Math.abs(near.hub![1] - near.top![1]);
  assert.ok(across >= 150, `nearest rotor ${across.toFixed(0)} px across`);
  assert.ok(inside(near.top) && inside(near.base, -1), `nearest turbine in frame: top ${near.top}, base ${near.base}`);
  assert.ok(near.hub![0] - across / 2 >= 0 && near.hub![0] + across / 2 <= W, `rotor x ${near.hub![0]}`);
});

test('the eye is low: below the blade tips of the nearest turbine plus a rotor, and above the ground', () => {
  const { cam, seen } = shot();
  const h = cam.eye[2] - GROUND;
  assert.ok(h > 40 && h < HUB + DIAMETER, `eye ${h.toFixed(0)} m above ground`);
  assert.ok(seen[0].dist < 800, `nearest turbine ${seen[0].dist.toFixed(0)} m away`);
});

test('a row of turbines recedes in the frame: many hubs inside, at several sizes', () => {
  const { seen } = shot();
  const inFrame = seen.filter((s) => inside(s.hub));
  assert.ok(inFrame.length >= 12, `${inFrame.length} hubs in frame`);
  const sizes = inFrame.map((s) => 2 * Math.abs(s.hub![1] - s.top![1]));
  assert.ok(sizes.filter((s) => s >= 60).length >= 3, `rotors >= 60 px: ${sizes.map((s) => s.toFixed(0)).join(' ')}`);
  assert.ok(sizes.filter((s) => s < 30).length >= 3, 'and far ones under 30 px');
});

test('Mt Iwaki and the Sea of Japan are in the frame (geography the camera does not compute)', () => {
  const { cam } = shot();
  const [ix, iy] = toLocal(140.303, 40.653, LON0, LAT0);
  const peak = project(cam.viewProj, [ix, iy, 1625], W, H);
  assert.ok(inside(peak, 40), `Iwaki summit at ${peak}`);
  // the sea 3 km off the coast at 40.80N, beyond the southern turbines
  const [sx, sy] = toLocal(140.21, 40.80, LON0, LAT0);
  const sea = project(cam.viewProj, [sx, sy, 0], W, H);
  assert.ok(inside(sea), `sea point at ${sea}`);
});
