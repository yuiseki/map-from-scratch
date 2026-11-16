import assert from "node:assert/strict";
import test from "node:test";
import { FRAGMENT_SHADER, rasterCoordinateAtUv, viewContainsBaseCoverage, visiblePixelWindow } from "./renderer.ts";

test("shader samples Float32 elevation and leaves nodata transparent", () => {
  assert.match(FRAGMENT_SHADER, /sampler2D u_elevation/);
  assert.match(FRAGMENT_SHADER, /-90000\.0/);
  assert.match(FRAGMENT_SHADER, /outColor = vec4\(0\.0\)/);
  assert.match(FRAGMENT_SHADER, /if \(x < 0\.0\)/);
  assert.match(FRAGMENT_SHADER, /abs\(elevation\) < 0\.5/);
});

test("UV coordinates resolve north-up raster pixel centers", () => {
  assert.deepEqual(rasterCoordinateAtUv([138, 33, 147, 43], 900, 1200, 0, 0), { lon: 138.005, lat: 42.99583333333333 });
  assert.deepEqual(rasterCoordinateAtUv([138, 33, 147, 43], 900, 1200, 1, 1), { lon: 146.995, lat: 33.00416666666666 });
});

test("visible bounds are clipped to the loaded coverage", () => {
  assert.deepEqual(visiblePixelWindow([138, 33, 147, 43], 900, 1200, [137, 35, 141, 44]), { x: 0, y: 0, width: 300, height: 960 });
});

test("zoomed raster view covers the base AOI while pans cannot move it outside", () => {
  assert.equal(viewContainsBaseCoverage([-50, -40, 200, 180], [0, 0, 100, 100]), true);
  assert.equal(viewContainsBaseCoverage([20, 0, 100, 100], [0, 0, 100, 100]), false);
});
