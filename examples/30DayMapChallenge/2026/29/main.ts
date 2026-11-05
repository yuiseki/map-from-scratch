import { mount, type EtopoRenderer } from "./renderer.ts";

declare global { interface Window { __mfsEmit?: (payload: string) => void } }
const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing page element: ${selector}`);
  return element;
};
const canvas = required<HTMLCanvasElement>("#map");
const status = required<HTMLElement>("#status");
const selection = required<HTMLElement>("#selection");
const coordinates = required<HTMLElement>("#coordinates");
const scale = required<HTMLElement>("#scale");
let renderer: EtopoRenderer | null = null;
function showSample(sample: { lon: number; lat: number; elevation: number } | null): void {
  selection.replaceChildren();
  const heading = document.createElement("h2");
  const description = document.createElement("p");
  if (!sample) {
    heading.textContent = "NoData または範囲外";
    description.textContent = "有効な元ラスターピクセルを選んでください。";
  } else {
    heading.textContent = `標高 ${sample.elevation.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} m`;
    description.textContent = `元ラスターピクセル · ${sample.lon.toFixed(4)}°E, ${sample.lat.toFixed(4)}°N`;
  }
  selection.append(heading, description);
}
function updateScale(): void { if (renderer) scale.textContent = `画面内の縮尺 · 約${renderer.scaleKilometers().toLocaleString("ja-JP")} km`; }
async function start(): Promise<void> {
  try {
    const started = performance.now();
    renderer = await mount(canvas, started, showSample);
    const data = renderer.data;
    const bytes = data.totalBytes.toLocaleString("ja-JP");
    status.textContent = `${data.selectedTiles.length} / 14,365 TIFFタイル · ${data.tileRanges.length + 1} Range · ${bytes} B取得 · ${(performance.now() - started).toFixed(0)} ms`;
    const resize = () => { renderer?.resize(); updateScale(); };
    new ResizeObserver(resize).observe(document.documentElement);
    window.addEventListener("resize", resize);
    required<HTMLButtonElement>("#zoom-in").addEventListener("click", () => { renderer?.zoomBy(1.5); updateScale(); });
    required<HTMLButtonElement>("#zoom-out").addEventListener("click", () => { renderer?.zoomBy(1 / 1.5); updateScale(); });
    required<HTMLButtonElement>("#reset").addEventListener("click", () => { renderer?.resetView(); updateScale(); });
    canvas.addEventListener("wheel", updateScale, { passive: true });
    canvas.addEventListener("pointerup", updateScale);
    updateScale();
    const bench = new URLSearchParams(location.search).has("bench") ? await import("./bench.ts") : null;
    if (bench) await bench.run(renderer);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.error = "true";
    const retry = document.createElement("button"); retry.textContent = "再試行"; retry.type = "button";
    retry.addEventListener("click", () => { status.dataset.error = "false"; status.textContent = "公式 ETOPO GeoTIFF の必要範囲を取得しています…"; void start(); });
    status.after(retry);
    console.error(error);
    if (new URLSearchParams(location.search).has("bench")) { window.__mfsEmit?.(JSON.stringify({ error: status.textContent })); window.__mfsEmit?.(JSON.stringify({ done: true })); }
  }
}
void start();
