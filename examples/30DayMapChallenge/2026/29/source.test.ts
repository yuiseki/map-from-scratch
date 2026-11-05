import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_AOI, METADATA_RANGE_END } from './source.ts';
import { pixelAtCoordinate, pixelWindowForBounds } from './raster.ts';

test('metadata range covers the TIFF directory and its tile index with a small prefix', () => {
  // Offsets verified from the official TIFF: IFD at 8, tile indexes around 278/57,738,
  // GeoTIFF transforms at 115,492/115,516, and nodata at 115,484.
  assert.equal(METADATA_RANGE_END, 131_071);
});

test('tighter Japan-trench AOI keeps Tokyo, Fuji and trench samples inside a 720px window', () => {
  assert.deepEqual(INITIAL_AOI, [138.5, 34.5, 144.5, 40.5]);
  const transform = [-180, 1 / 120, 0, 90, 0, -1 / 120] as const;
  const window = pixelWindowForBounds(transform, 43200, 21600, INITIAL_AOI);
  assert.deepEqual(window, { x: 38220, y: 5940, width: 720, height: 720 });
  for (const [lon, lat] of [[139.7, 35.7], [138.73, 35.36], [144, 38]]) {
    const pixel = pixelAtCoordinate(transform, 43200, 21600, lon, lat);
    assert.ok(pixel && pixel.x >= window.x && pixel.x < window.x + window.width && pixel.y >= window.y && pixel.y < window.y + window.height);
  }
});
