import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contourLevels,
  extractContours,
  projectToPage,
  renderPrintableSvg,
  stitchSegments,
  type PrintSheet,
  type RegularGrid,
} from './print.ts';

const grid = (values: number[], valid = [1, 1, 1, 1]): RegularGrid => ({
  width: 2, height: 2, originX: 0, originY: 0, stepX: 1, stepY: 1,
  values, valid,
});

test('contour levels are interval aligned, bounded, and reject invalid intervals', () => {
  assert.deepEqual(contourLevels(435, 1035, 100), [500, 600, 700, 800, 900, 1000]);
  assert.deepEqual(contourLevels(500, 500, 100), []);
  assert.throws(() => contourLevels(0, 1, 0), /interval/);
});

test('marching squares interpolates the crossing on a simple ramp', () => {
  const lines = extractContours(grid([0, 10, 0, 10]), [5]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.level, 5);
  assert.deepEqual(lines[0]!.segments, [{ a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 1 } }]);
});

test('marching squares resolves both saddle topologies with the bilinear center', () => {
  const rising = extractContours(grid([10, 0, 0, 10]), [5])[0]!;
  const falling = extractContours(grid([0, 10, 10, 0]), [5])[0]!;
  assert.equal(rising.segments.length, 2);
  assert.equal(falling.segments.length, 2);
  for (const segment of [...rising.segments, ...falling.segments]) {
    assert.ok(Number.isFinite(segment.a.x + segment.a.y + segment.b.x + segment.b.y));
  }
  assert.deepEqual(rising.segments, [
    { a: { x: 0.5, y: 0 }, b: { x: 1, y: 0.5 } },
    { a: { x: 0.5, y: 1 }, b: { x: 0, y: 0.5 } },
  ]);
});

test('a nodata corner suppresses its cell instead of becoming a zero elevation', () => {
  assert.deepEqual(extractContours(grid([0, 10, 0, 10], [0, 1, 1, 1]), [5]), []);
});

test('segments stitch through shared intersections into continuous and closed paths', () => {
  const paths = stitchSegments([
    { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    { a: { x: 2, y: 0 }, b: { x: 1, y: 0 } },
    { a: { x: 2, y: 1 }, b: { x: 2, y: 0 } },
  ]);
  assert.equal(paths.length, 1);
  assert.equal(paths[0]!.closed, false);
  assert.equal(paths[0]!.points.length, 4);
  const loop = stitchSegments([
    { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    { a: { x: 1, y: 0 }, b: { x: 1, y: 1 } },
    { a: { x: 1, y: 1 }, b: { x: 0, y: 1 } },
    { a: { x: 0, y: 1 }, b: { x: 0, y: 0 } },
  ]);
  assert.equal(loop[0]!.closed, true);
});

test('EPSG:3857 page transform preserves physical scale and flips northing to page y', () => {
  const frame = { xMm: 12, yMm: 37, widthMm: 185, heightMm: 150, scale: 100_000, centerLatitude: 35.36 };
  const width = frame.widthMm * frame.scale / 1000 / Math.cos(frame.centerLatitude * Math.PI / 180);
  const height = frame.heightMm * frame.scale / 1000 / Math.cos(frame.centerLatitude * Math.PI / 180);
  const bounds = { minX: 0, minY: 0, maxX: width, maxY: height };
  const topLeft = projectToPage({ x: 0, y: height }, bounds, frame);
  const bottomRight = projectToPage({ x: width, y: 0 }, bounds, frame);
  assert.ok(Math.abs(topLeft.xMm - 12) < 1e-9 && Math.abs(topLeft.yMm - 37) < 1e-9);
  assert.ok(Math.abs(bottomRight.xMm - 197) < 1e-9 && Math.abs(bottomRight.yMm - 187) < 1e-9);
  // Web Mercator scale is corrected by cos(latitude): 1 mm on paper is 100 m ground.
  const groundMm = projectToPage({ x: 100 / Math.cos(35.36 * Math.PI / 180), y: 0 },
    { minX: 0, minY: 0, maxX: 22_700, maxY: 18_400 },
    { ...frame, widthMm: 22_700 / 100_000 * 1000 });
  assert.ok(Math.abs((groundMm.xMm - frame.xMm) - 1) < 1e-9);
});

test('SVG is deterministic, physically sized A4 landscape and carries source disclosures', () => {
  const sheet: PrintSheet = {
    title: '富士山 標高ガイド',
    grid: { width: 2, height: 2, originX: 0, originY: 0, stepX: 1, stepY: 1,
      values: [0, 10, 0, 10], valid: [1, 1, 1, 1] },
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    frame: { xMm: 12, yMm: 37, widthMm: 185, heightMm: 150, scale: 100_000, centerLatitude: 35.36 },
    levels: [5], intervalM: 100, minElevationM: 0, maxElevationM: 10,
    attribution: 'Source: Geospatial Information Authority of Japan (GSI), elevation tiles (Fundamental Geospatial Data elevation model), https://maps.gsi.go.jp/development/ichiran.html. Edited and aggregated into 10×10-pixel cells by yuiseki. This is not an official GSI product.',
  };
  const svg = renderPrintableSvg(sheet);
  assert.equal(renderPrintableSvg(sheet), svg);
  assert.match(svg, /width="297mm" height="210mm" viewBox="0 0 297 210"/);
  assert.match(svg, /1:100,000/);
  assert.match(svg, /100 m/);
  assert.match(svg, /This is not an official GSI product/);
  assert.match(svg, /Generated contour guides/);
  assert.match(svg, /route|annotation/i);
  assert.doesNotMatch(svg, /summit/i);
});

test('rendered contours are clipped to the map frame', () => {
  const sheet: PrintSheet = {
    title: 'clip',
    grid: { width: 2, height: 2, originX: 0, originY: 0, stepX: 1, stepY: 1,
      values: [0, 10, 0, 10], valid: [1, 1, 1, 1] },
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    frame: { xMm: 12, yMm: 37, widthMm: 185, heightMm: 150, scale: 100_000, centerLatitude: 35.36 },
    levels: [5], intervalM: 100, minElevationM: 0, maxElevationM: 10, attribution: 'GSI source',
  };
  const svg = renderPrintableSvg(sheet);
  assert.match(svg, /<clipPath/);
  const d = svg.match(/<path[^>]* d="([^"]+)"/i)?.[1];
  assert.ok(d);
  const numbers = d!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  assert.ok(numbers.every((n, i) => i % 2 === 0 ? n >= 12 && n <= 197 : n >= 37 && n <= 187));
});
