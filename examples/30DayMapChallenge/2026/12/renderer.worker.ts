import { equalEarth } from '../../../../tools/geo.ts';
import { decodeCountryGeometry, type PackedCountry } from './geometry.ts';
import { decodeAccessSeries, powerColor } from './power.ts';

interface WorkerCountry { path: Path2D; values: (number | null)[] }
interface InitMessage {
  type: 'init'; metadata: PackedCountry[]; geometryBuffer: ArrayBuffer; accessBuffer: ArrayBuffer;
  stats: { startYear: number; endYear: number }; width: number; height: number;
}
type WorkerMessage = InitMessage | { type: 'year'; year: number } | { type: 'resize'; width: number; height: number };
const scope = self as unknown as { onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
const css = (rgb: [number, number, number]) => `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let countries: WorkerCountry[] = [];
let startYear = 0, requestedYear = 0, rendering = false;
let gridPaths: Path2D[] = [];

function createGrid() {
  const normalize = (lon: number, lat: number): [number, number] => {
    const [x, y] = equalEarth([lon, lat]);
    return [Math.max(0, Math.min(1, (x + 2.7066) / 5.4132)), Math.max(0, Math.min(1, (1.3174 - y) / 2.6348))];
  };
  for (let lon = -150; lon <= 150; lon += 30) {
    const path = new Path2D();
    for (let lat = -80, first = true; lat <= 80; lat += 4) {
      const [x, y] = normalize(lon, lat); if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y);
    }
    gridPaths.push(path);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const path = new Path2D();
    for (let lon = -180, first = true; lon <= 180; lon += 4) {
      const [x, y] = normalize(lon, lat); if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y);
    }
    gridPaths.push(path);
  }
}

async function renderLatest() {
  if (!canvas || !context || rendering) return;
  rendering = true;
  try {
    while (true) {
      const targetYear = requestedYear, started = performance.now();
      context.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
      context.clearRect(0, 0, 1, 1);
      context.strokeStyle = '#9bb9c51c'; context.lineWidth = 1.05 / canvas.width;
      for (const path of gridPaths) context.stroke(path);
      let outdated = false;
      const index = targetYear - startYear;
      for (let i = 0; i < countries.length; i++) {
        const country = countries[i]!, value = country.values[index] ?? null;
        context.fillStyle = css(powerColor(value)); context.fill(country.path, 'evenodd');
        context.strokeStyle = '#101b23'; context.lineWidth = 0.95 / canvas.width; context.stroke(country.path);
        if (i % 12 === 11) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (targetYear !== requestedYear) { outdated = true; break; }
        }
      }
      if (outdated) continue;
      const bitmap = canvas.transferToImageBitmap();
      scope.postMessage({ type: 'rendered', year: targetYear, renderMs: performance.now() - started, bitmap }, [bitmap]);
      if (targetYear === requestedYear) break;
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    rendering = false;
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      const shapes = decodeCountryGeometry(message.geometryBuffer, message.metadata);
      const series = decodeAccessSeries(message.accessBuffer);
      if (shapes.length !== series.records.length) throw new Error('Worker geometry and series counts differ');
      countries = shapes.map((shape, index) => {
        const record = series.records[index]!;
        if (shape.iso3 !== record.iso3) throw new Error(`Worker country order mismatch: ${shape.iso3}/${record.iso3}`);
        const path = new Path2D();
        for (const ring of shape.rings) {
          if (ring.length < 3) continue;
          path.moveTo(ring[0]![0], ring[0]![1]);
          for (let i = 1; i < ring.length; i++) path.lineTo(ring[i]![0], ring[i]![1]);
          path.closePath();
        }
        return { path, values: record.values };
      });
      startYear = series.startYear; requestedYear = message.stats.endYear;
      canvas = new OffscreenCanvas(message.width, message.height);
      context = canvas.getContext('2d');
      if (!context) throw new Error('Worker OffscreenCanvas 2D context is unavailable');
      createGrid(); void renderLatest();
    } else if (message.type === 'year') {
      requestedYear = message.year; void renderLatest();
    } else if (message.type === 'resize' && canvas && (canvas.width !== message.width || canvas.height !== message.height)) {
      canvas.width = message.width; canvas.height = message.height; void renderLatest();
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
