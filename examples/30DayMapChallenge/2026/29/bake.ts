import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pixelAtCoordinate } from './raster.ts';
import { INITIAL_AOI, loadEtopoWindow, SOURCE_URL } from './source.ts';

const OUTPUT = resolve('data/baked/30DayMapChallenge-2026-29/source-stats.json');

export async function bakeSourceStats(): Promise<Record<string, unknown>> {
  const started = performance.now();
  const loaded = await loadEtopoWindow(INITIAL_AOI, fetch, (range, done, total) => {
    console.error(`Range ${done}/${total}: bytes=${range.start}-${range.end}, ${range.bytes} B in ${range.elapsedMs.toFixed(1)} ms`);
  });
  const { metadata, window, values } = loaded;
  let min = Infinity, max = -Infinity, valid = 0, nodata = 0, belowSea = 0, aboveSea = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value === metadata.nodata) { nodata++; continue; }
    valid++;
    min = Math.min(min, value);
    max = Math.max(max, value);
    if (value < 0) belowSea++;
    if (value > 0) aboveSea++;
  }
  if (valid === 0) throw new Error('Selected ETOPO AOI contains no valid pixels');
  const samples = [
    { label: 'Tokyo', lon: 139.7, lat: 35.7 },
    { label: 'Fuji', lon: 138.73, lat: 35.36 },
    { label: 'Japan Trench', lon: 144, lat: 38 },
  ].map(sample => {
    const pixel = pixelAtCoordinate(metadata.transform, metadata.width, metadata.height, sample.lon, sample.lat);
    if (!pixel) throw new Error(`Sample ${sample.label} falls outside the source raster`);
    const localX = pixel.x - window.x, localY = pixel.y - window.y;
    return { ...sample, x: pixel.x, y: pixel.y, elevationM: values[localY * window.width + localX] };
  });
  const result = {
    source: {
      url: SOURCE_URL, bytes: metadata.totalLength, format: 'classic TIFF',
      dimensions: [metadata.width, metadata.height], pixelSizeDegrees: 1 / 120,
      crs: 'WGS 84 + EGM2008 height (EPSG:9518)', transform: metadata.transform,
      sampleType: 'Float32', unit: 'metres', nodata: metadata.nodata,
      tile: [metadata.tileWidth, metadata.tileHeight], compression: 'DEFLATE (TIFF tag 8)',
      predictor: 'floating point Predictor=3', overviews: 0,
    },
    aoi: { bounds: INITIAL_AOI, pixelWindow: window },
    selection: {
      tileCount: loaded.selectedTiles.length,
      tileBytes: loaded.selectedTiles.reduce((sum, tile) => sum + tile.byteCount, 0),
      tileIndices: loaded.selectedTiles.map(tile => tile.index),
      tileRanges: loaded.tileRanges,
      metadataRange: loaded.metadataRange,
      totalBytes: loaded.totalBytes,
    },
    values: { valid, nodata, belowSea, aboveSea, minM: min, maxM: max, samples },
    citation: 'NOAA National Centers for Environmental Information. 2022: ETOPO 2022 15 Arc-Second Global Relief Model (30 arc-second global bedrock GeoTIFF used here). NOAA National Centers for Environmental Information. https://doi.org/10.25921/fd45-gt74. Accessed 2026-11-06.',
    elapsedMs: Number((performance.now() - started).toFixed(1)),
  };
  mkdirSync(resolve(OUTPUT, '..'), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (import.meta.url === new URL(process.argv[1]!, 'file:').href) await bakeSourceStats();
