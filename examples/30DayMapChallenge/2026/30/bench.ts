declare global { interface Window { __mfsEmit?: (payload: string) => void } }
export {};

const emit = (event: Record<string, unknown>) => window.__mfsEmit?.(JSON.stringify(event));
const closeTo = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

export async function run(image: HTMLImageElement, sourceSvg: string, started: number): Promise<void> {
  const parsed = new DOMParser().parseFromString(sourceSvg, 'image/svg+xml');
  const parseErrors = parsed.querySelectorAll('parsererror').length;
  const root = parsed.documentElement;
  const paths = [...parsed.querySelectorAll('path[data-level]')];
  const levels = [...new Set(paths.map(path => Number(path.getAttribute('data-level'))))].sort((a, b) => a - b);
  const clip = parsed.querySelector('#map-frame-clip rect');
  const frame = clip && {
    x: Number(clip.getAttribute('x')), y: Number(clip.getAttribute('y')),
    width: Number(clip.getAttribute('width')), height: Number(clip.getAttribute('height')),
  };
  let clipped = Boolean(frame);
  if (frame) for (const path of paths) {
    const coords = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    for (let i = 0; i + 1 < coords.length; i += 2) {
      if (coords[i]! < frame.x - 0.01 || coords[i]! > frame.x + frame.width + 0.01
        || coords[i + 1]! < frame.y - 0.01 || coords[i + 1]! > frame.y + frame.height + 0.01) clipped = false;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1188; canvas.height = 840;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('SVG pixel check could not allocate a canvas');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let mapInkPixels = 0;
  if (frame) {
    const x0 = Math.ceil(frame.x * 4), x1 = Math.floor((frame.x + frame.width) * 4);
    const y0 = Math.ceil(frame.y * 4), y1 = Math.floor((frame.y + frame.height) * 4);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const offset = (y * canvas.width + x) * 4;
      if (pixels[offset]! < 245 || pixels[offset + 1]! < 245 || pixels[offset + 2]! < 245) mapInkPixels++;
    }
  }

  const standaloneResponse = await fetch(image.currentSrc);
  const standaloneSvg = await standaloneResponse.text();
  const statsResponse = await fetch('../../../../data/baked/30DayMapChallenge-2026-30/stats.json');
  const stats = await statsResponse.json() as {
    contours: { segmentCount: number; pathCount: number };
    elevations: { contourLevelsM: number[]; contourIntervalM: number };
  };
  const credits = root.textContent?.includes('Source: Geospatial Information Authority of Japan (GSI)')
    && root.textContent.includes('Edited and aggregated into 10×10-pixel cells by yuiseki.')
    && root.textContent.includes('This is not an official GSI product.')
    && root.textContent.includes('DEM10B values are interpolated and aggregated')
    && root.textContent.includes('100% / Actual size');
  const external = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => !url.startsWith(location.origin));
  const extReferences = [...sourceSvg.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]!).filter(value => /^https?:/i.test(value));
  const pathsVisible = mapInkPixels > 1500;
  const physical = root.getAttribute('width') === '297mm' && root.getAttribute('height') === '210mm'
    && root.getAttribute('viewBox') === '0 0 297 210' && closeTo(image.naturalWidth / image.naturalHeight, 297 / 210, 0.005);
  const exactStandalone = standaloneResponse.ok && standaloneSvg === sourceSvg;
  const expectedLevels = JSON.stringify(levels) === JSON.stringify(stats.elevations.contourLevelsM);
  const pathsMatch = paths.length === stats.contours.pathCount;
  const sourceHasNoDataClaim = stats.elevations.contourIntervalM === 100;

  emit({ metric: 'first_render_ms', value: performance.now() - started });
  emit({ metric: 'svg_bytes', value: new TextEncoder().encode(sourceSvg).byteLength });
  emit({ metric: 'contour_levels', value: levels.length });
  emit({ metric: 'contour_paths', value: paths.length });
  emit({ metric: 'map_ink_pixels', value: mapInkPixels });
  emit({ check: 'svg-parse-and-physical-page', pass: parseErrors === 0 && physical, detail: `parse errors=${parseErrors}; size=${root.getAttribute('width')}×${root.getAttribute('height')}; ratio=${(image.naturalWidth / image.naturalHeight).toFixed(5)}` });
  emit({ check: 'source-contours-visible', pass: expectedLevels && pathsMatch && pathsVisible && sourceHasNoDataClaim, detail: `${levels.length} levels; ${paths.length}/${stats.contours.pathCount} paths; ${mapInkPixels} non-white map-frame pixels` });
  emit({ check: 'extent-clipping', pass: clipped, detail: clipped ? 'all contour coordinates stay in the disclosed map frame; vector clipPath is present' : 'a contour coordinate leaves the source extent/frame' });
  emit({ check: 'standalone-svg-matches-preview', pass: exactStandalone, detail: `download URL response equals preview bytes: ${exactStandalone}` });
  emit({ check: 'attribution-and-print-guide', pass: Boolean(credits), detail: `GSI attribution, processing notice, interpolation caveat and 100% print note present: ${Boolean(credits)}` });
  emit({ check: 'no-external-runtime-assets', pass: external.length === 0 && extReferences.length === 0, detail: `external requests=${external.length}; external SVG references=${extReferences.length}` });
  emit({ info: { viewport: [innerWidth, innerHeight], imagePixels: [image.naturalWidth, image.naturalHeight], localRequests: performance.getEntriesByType('resource').length } });
  emit({ done: true });
}
