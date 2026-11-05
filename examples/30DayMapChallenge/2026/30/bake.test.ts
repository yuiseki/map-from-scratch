import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const output = 'data/baked/30DayMapChallenge-2026-30';
const stats = JSON.parse(readFileSync(`${output}/stats.json`, 'utf8')) as {
  contours: { segmentCount: number; pathCount: number };
  elevations: { contourLevelsM: number[]; contourIntervalM: number };
  counts: { rows: number; validCells: number; nodataCells: number };
  aoi: { print: { mapFrameMm: { widthMm: number; heightMm: number } } };
};
const svg = readFileSync(`${output}/sheet.svg`, 'utf8');
const data = JSON.parse(readFileSync(`${output}/dem.json`, 'utf8')) as {
  source: { crs: string; id: string; sourceTileCount: number };
  aoi: { sourceGrid: Record<string, number>; boundsEpsg3857: Record<string, number>; grid: { width: number; height: number; cellSizeM: number }; print: { scale: string; centerLatitude: number } };
  elevations: { minMeanM: number; maxMeanM: number; contourIntervalM: number; contourLevelsM: number[] };
  counts: { rows: number; validCells: number; nodataCells: number };
  grid: { values: (number | null)[]; valid: number[] };
};

test('the frozen source AOI has a complete regular grid and retains nodata as null', () => {
  assert.equal(data.source.id, 'hf:gsi-dem-fuji-z14-100m-2026-10-25');
  assert.equal(data.source.crs, 'EPSG:3857');
  assert.equal(data.source.sourceTileCount, 100);
  assert.deepEqual(data.aoi.sourceGrid, { minGridX: 371218, maxGridX: 371456, minGridY: 165525, maxGridY: 165718 });
  assert.equal(data.aoi.grid.width * data.aoi.grid.height, data.counts.rows);
  assert.equal(data.counts.rows, 45_934);
  assert.equal(data.counts.validCells + data.counts.nodataCells, data.counts.rows);
  assert.equal(data.grid.valid.length, data.counts.rows);
  assert.equal(data.grid.values.length, data.counts.rows);
  for (let i = 0; i < data.grid.values.length; i++) {
    assert.equal(data.grid.valid[i] === 1, data.grid.values[i] !== null);
  }
});

test('bake statistics reflect real elevations, contour interval and physical scale', () => {
  assert.ok(data.elevations.minMeanM > 400 && data.elevations.minMeanM < 500);
  assert.ok(data.elevations.maxMeanM > 3700 && data.elevations.maxMeanM < 3800);
  assert.equal(data.elevations.contourIntervalM, 100);
  assert.equal(data.elevations.contourLevelsM.length, 33);
  assert.match(data.aoi.print.scale, /1:100,000/);
  assert.ok(data.aoi.print.centerLatitude > 35 && data.aoi.print.centerLatitude < 36);
  assert.ok(statSync(`${output}/dem.json`).size > 0);
});

test('the real-data SVG contains the bake level set, path count, credits and hand-drawn space', () => {
  const pathLevels = [...svg.matchAll(/<path data-level="(\d+)"/g)].map(match => Number(match[1]));
  assert.equal(pathLevels.length, stats.contours.pathCount);
  assert.deepEqual([...new Set(pathLevels)].sort((a, b) => a - b), stats.elevations.contourLevelsM);
  assert.ok(stats.contours.segmentCount > stats.contours.pathCount);
  assert.match(svg, /width="297mm" height="210mm" viewBox="0 0 297 210"/);
  assert.ok(stats.aoi.print.mapFrameMm.widthMm > 185 && stats.aoi.print.mapFrameMm.widthMm < 186);
  assert.ok(stats.aoi.print.mapFrameMm.heightMm > 150 && stats.aoi.print.mapFrameMm.heightMm < 151);
  assert.match(svg, /Source: Geospatial Information Authority of Japan \(GSI\)/);
  assert.match(svg, /Edited and aggregated into 10×10-pixel cells by yuiseki\. This is not an official GSI product\./);
  assert.match(svg, /DEM10B values are interpolated and aggregated/);
  assert.match(svg, /手書きエリア/);
});

test('browser preview and download resolve to the same generated artifact', () => {
  const pageDir = 'examples/30DayMapChallenge/2026/30';
  const html = readFileSync(`${pageDir}/index.html`, 'utf8');
  const main = readFileSync(`${pageDir}/main.ts`, 'utf8');
  const served = '../../../../data/baked/30DayMapChallenge-2026-30/sheet.svg';
  assert.match(html, new RegExp(`src="${served.replaceAll('/', '\\/')}"`));
  assert.match(html, new RegExp(`href="${served.replaceAll('/', '\\/')}"`));
  assert.ok(main.includes(`fetch('${served}')`));
  assert.ok(statSync(resolve(pageDir, served)).size > 0);
});
