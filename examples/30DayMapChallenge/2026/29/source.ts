import { parseIfd, parseTiffHeader, planTiles, readTiffRasterMetadata } from './cog.ts';
import { decodeFloat32DeflateTile } from './deflate.ts';
import { fetchExactRange, type ExactRangeResult } from './range.ts';
import { assembleWindow, coalesceTileRanges, pixelWindowForBounds, splitRangeTiles, type GeographicBounds, type RangeSpan } from './raster.ts';

export const SOURCE_URL = 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/30s/30s_bed_elev_gtif/ETOPO_2022_v1_30s_N90W180_bed.tif';
export const INITIAL_AOI: GeographicBounds = [138.5, 34.5, 144.5, 40.5];
export const METADATA_RANGE_END = 131_071;
export const SOURCE_LENGTH_BYTES = 1_624_895_430;

export interface SourceRangeMetric {
  start: number;
  end: number;
  bytes: number;
  attempts: number;
  elapsedMs: number;
  status: number;
  contentRange: string | null;
  responseType: Response['type'];
}

export interface LoadedEtopoWindow {
  bounds: GeographicBounds;
  window: { x: number; y: number; width: number; height: number };
  values: Float32Array;
  metadata: ReturnType<typeof readTiffRasterMetadata>;
  selectedTiles: ReturnType<typeof planTiles>;
  metadataRange: SourceRangeMetric;
  tileRanges: SourceRangeMetric[];
  totalBytes: number;
}

export async function loadEtopoWindow(
  bounds: GeographicBounds = INITIAL_AOI,
  fetcher: typeof fetch = fetch,
  onRange?: (metric: SourceRangeMetric, completed: number, total: number) => void,
): Promise<LoadedEtopoWindow> {
  const metadataStarted = performance.now();
  const metadataResponse = await fetchExactRange(SOURCE_URL, 0, METADATA_RANGE_END, fetcher, SOURCE_LENGTH_BYTES);
  const header = parseTiffHeader(metadataResponse.bytes);
  const ifd = parseIfd(metadataResponse.bytes, header.firstIfdOffset, header.littleEndian);
  if (ifd.nextIfdOffset !== 0) throw new Error('The NOAA 30 arc-second source unexpectedly contains another image directory');
  const metadata = readTiffRasterMetadata(ifd, metadataResponse.totalLength);
  const metadataRange: SourceRangeMetric = {
    start: 0, end: METADATA_RANGE_END, bytes: metadataResponse.bytes.byteLength,
    attempts: metadataResponse.attempts, elapsedMs: performance.now() - metadataStarted,
    status: metadataResponse.status, contentRange: metadataResponse.contentRange, responseType: metadataResponse.responseType,
  };
  onRange?.(metadataRange, 1, 1);

  const window = pixelWindowForBounds(metadata.transform, metadata.width, metadata.height, bounds);
  const selectedTiles = planTiles(metadata, window);
  const spans = coalesceTileRanges(selectedTiles);
  const completedBytes = new Map<number, Uint8Array>();
  let completed = 0;
  const fetched = await Promise.all(spans.map(async (span: RangeSpan) => {
    const started = performance.now();
    const response = await fetchExactRange(SOURCE_URL, span.start, span.end, fetcher, SOURCE_LENGTH_BYTES);
    const metric: SourceRangeMetric = {
      start: span.start, end: span.end, bytes: response.bytes.byteLength,
      attempts: response.attempts, elapsedMs: performance.now() - started,
      status: response.status, contentRange: response.contentRange, responseType: response.responseType,
    };
    completed++;
    onRange?.(metric, completed, spans.length);
    return { span, response, metric };
  }));

  const tileRanges = fetched.map(item => item.metric).sort((a, b) => a.start - b.start);
  for (const { span, response } of fetched) {
    for (const [tileIndex, bytes] of splitRangeTiles(span, response.bytes)) completedBytes.set(tileIndex, bytes);
  }
  const decoded = new Map<number, Float32Array>();
  for (const tile of selectedTiles) {
    const compressed = completedBytes.get(tile.index);
    if (!compressed) throw new Error(`No compressed bytes received for selected TIFF tile ${tile.index}`);
    decoded.set(tile.index, await decodeFloat32DeflateTile(compressed, metadata.tileWidth, metadata.tileHeight, header.littleEndian));
  }
  const values = assembleWindow({
    width: metadata.width, height: metadata.height,
    tileWidth: metadata.tileWidth, tileHeight: metadata.tileHeight,
    columns: Math.ceil(metadata.width / metadata.tileWidth),
  }, window, decoded);
  return {
    bounds, window, values, metadata, selectedTiles, metadataRange, tileRanges,
    totalBytes: metadataRange.bytes + tileRanges.reduce((sum, item) => sum + item.bytes, 0),
  };
}

