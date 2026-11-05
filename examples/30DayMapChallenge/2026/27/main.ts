import { parseCensusCells } from './mesh.ts';
import { mount, sourceRecordCells, type CameraState, type RendererHandle } from './renderer.ts';

declare global { interface Window { __mfsEmit?: (payload: string) => void } }

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required map element is missing: ${selector}`);
  return element;
}
const canvas = requiredElement<HTMLCanvasElement>('#map');
const panel = requiredElement<HTMLElement>('#selection');
const overlay = requiredElement<HTMLElement>('#panel');
const status = requiredElement<HTMLElement>('#status');

function showSelection(map: RendererHandle, index: number) {
  panel.replaceChildren();
  const heading = document.createElement('h2');
  if (index < 0) {
    heading.textContent = 'セルを選択';
    const note = document.createElement('p'); note.textContent = '250mメッシュ単位の集計値です。';
    panel.append(heading, note);
    map.select(-1);
    return;
  }
  const cell = map.cells[index];
  heading.textContent = `メッシュ ${cell.code}`;
  const details = document.createElement('p');
  const label = cell.status === 'count' ? `${cell.rawValue}人` : cell.status === 'zero' ? '0人（明示値）' : cell.status === 'suppressed' ? '秘匿（*）' : cell.status === 'no-row' ? '表に行なし' : `値なし（${cell.rawValue ?? '空欄'}）`;
  const source = cell.source ? `${cell.source.table} · ${cell.source.field} · HTKSYORI ${cell.source.HTKSYORI ?? '—'} · HTKSAKI ${cell.source.HTKSAKI ?? '—'}` : '国勢調査表に行なし';
  details.textContent = `0～14歳人口: ${label} ／ 出典列 ${source}`;
  panel.append(heading, details);
  map.select(index);
}

function scheduleDraw(map: RendererHandle) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; map.draw(); });
  };
}

async function start() {
  try {
    if (!navigator.gpu) throw new Error('このブラウザーは WebGPU に対応していません');
    const response = await fetch('../../../../data/baked/30DayMapChallenge-2026-27/cells.json');
    if (!response.ok) throw new Error(`データを読み込めませんでした (HTTP ${response.status})`);
    const source = sourceRecordCells(await response.json());
    const cells = parseCensusCells(JSON.stringify(source.cells));
    const bench = new URLSearchParams(location.search).has('bench') ? await import('./bench.ts') : null;
    const map = await mount(canvas, cells, source.bounds);
    const openingCamera = { ...map.camera };
    openingCamera.lon -= (overlay.getBoundingClientRect().width * devicePixelRatio * 0.42) / (map.scale() * Math.cos(openingCamera.lat * Math.PI / 180));
    map.setView(openingCamera);
    const redraw = scheduleDraw(map);
    new ResizeObserver(() => { map.resize(); redraw(); }).observe(canvas);
    let active = false, moved = false, lastX = 0, lastY = 0, startX = 0, startY = 0;
    const point = (event: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect(), scale = devicePixelRatio;
      return [(event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale] as const;
    };
    canvas.addEventListener('pointerdown', (event) => {
      active = true; moved = false;
      const [x, y] = point(event); lastX = startX = x; lastY = startY = y;
      if (event.isTrusted) canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!active) return;
      const [x, y] = point(event), dx = x - lastX, dy = y - lastY;
      if (Math.hypot(x - startX, y - startY) > 3) moved = true;
      lastX = x; lastY = y;
      const camera: CameraState = { ...map.camera };
      camera.lon -= dx / (map.scale() * Math.cos(camera.lat * Math.PI / 180));
      camera.lat += dy / map.scale();
      map.setView(camera); redraw();
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!active) return;
      active = false;
      if (!moved) {
        const [x, y] = point(event), index = map.pick(x, y);
        showSelection(map, index); redraw();
      }
    });
    canvas.addEventListener('pointercancel', () => { active = false; });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const [x, y] = point(event), [width, height] = map.size(), camera: CameraState = { ...map.camera };
      const cosLat = Math.cos(camera.lat * Math.PI / 180), beforeScale = map.scale();
      const worldLon = camera.lon + (x - width / 2) / (beforeScale * cosLat);
      const worldLat = camera.lat - (y - height / 2) / beforeScale;
      camera.zoom = Math.max(0.5, Math.min(20, camera.zoom * Math.exp(-event.deltaY * 0.0015)));
      const afterScale = map.scale() * camera.zoom / map.camera.zoom;
      camera.lon = worldLon - (x - width / 2) / (afterScale * cosLat);
      camera.lat = worldLat + (y - height / 2) / afterScale;
      map.setView(camera); redraw();
    }, { passive: false });

    const counts = cells.reduce<Record<string, number>>((acc, cell) => { acc[cell.status] = (acc[cell.status] ?? 0) + 1; return acc; }, {});
    status.textContent = `WebGPU ready · ${cells.length} meshes · ${counts.count ?? 0} counted / ${counts.suppressed ?? 0} suppressed`;
    map.draw();
    const mounted = performance.now();
    if (bench) await bench.run(map, mounted, panel, canvas);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.error = 'true';
    console.error(error);
    if (new URLSearchParams(location.search).has('bench')) {
      window.__mfsEmit?.(JSON.stringify({ error: status.textContent }));
      window.__mfsEmit?.(JSON.stringify({ done: true }));
    }
  }
}

void start();
