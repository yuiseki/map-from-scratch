import { buildMembershipNetwork, decodeNetwork, type BusStop } from './network.ts';
import { createNetworkRenderer } from './renderer.ts';

const bootStarted = performance.now();

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const loading = document.querySelector<HTMLElement>('#loading')!;
const selection = document.querySelector<HTMLElement>('#selection')!;
const routeCount = document.querySelector<HTMLElement>('#route-count')!;
const stopCount = document.querySelector<HTMLElement>('#stop-count')!;
const membershipCount = document.querySelector<HTMLElement>('#membership-count')!;
const labelGroupCount = document.querySelector<HTMLElement>('#label-group-count')!;
const operatorCount = document.querySelector<HTMLElement>('#operator-count')!;

function showStop(stop: BusStop | null): void {
  selection.replaceChildren();
  if (!stop) { selection.textContent = '地図上の停留所を選択してください。'; return; }
  const title = document.createElement('strong'); title.textContent = stop.name || '名称未設定';
  const details = document.createElement('span');
  details.textContent = `\n${stop.operator} · ${stop.id}\n系統 ${stop.nRoutes}: ${stop.routes.join(' / ') || '記録なし'}\nバス区分コード: ${stop.kinds.join(', ') || '記録なし'}`;
  selection.append(title, details);
}

try {
  const response = await fetch('../../../../data/baked/30DayMapChallenge-2026-24/network.json');
  if (!response.ok) throw new Error(`data/network.json: HTTP ${response.status}`);
  const data = decodeNetwork(await response.text());
  const network = buildMembershipNetwork(data.stops);
  const operatorStats = new Map<string, { routes: number; stops: number; memberships: number }>();
  const statsFor = (operator: string) => operatorStats.get(operator) ?? { routes: 0, stops: 0, memberships: 0 };
  for (const route of data.routes) { const stats = statsFor(route.operator); stats.routes++; operatorStats.set(route.operator, stats); }
  for (const stop of data.stops) { const stats = statsFor(stop.operator); stats.stops++; stats.memberships += stop.routes.length; operatorStats.set(stop.operator, stats); }
  const operatorFilter = document.querySelector<HTMLSelectElement>('#operator-filter')!;
  for (const [operator, count] of [...operatorStats].sort((a, b) => b[1].stops - a[1].stops || a[0].localeCompare(b[0], 'ja'))) {
    const option = document.createElement('option'); option.value = operator;
    option.textContent = `${operator} · ${count.stops.toLocaleString('ja-JP')}停留所 / ${count.routes.toLocaleString('ja-JP')}線`;
    operatorFilter.append(option);
  }
  const updateStats = (operator: string) => {
    const routes = operator ? data.routes.filter((route) => route.operator === operator) : data.routes;
    const stops = operator ? data.stops.filter((stop) => stop.operator === operator) : data.stops;
    const memberships = buildMembershipNetwork(stops);
    routeCount.textContent = routes.length.toLocaleString('ja-JP');
    stopCount.textContent = stops.length.toLocaleString('ja-JP');
    membershipCount.textContent = stops.reduce((count, stop) => count + stop.routes.length, 0).toLocaleString('ja-JP');
    labelGroupCount.textContent = memberships.routeNodes.length.toLocaleString('ja-JP');
    operatorCount.textContent = (operator ? 1 : operatorStats.size).toLocaleString('ja-JP');
  };
  labelGroupCount.textContent = network.routeNodes.length.toLocaleString('ja-JP');
  updateStats('');
  const renderer = createNetworkRenderer(canvas, data, showStop);
  const firstFrameMs = performance.now() - bootStarted;
  operatorFilter.addEventListener('change', () => {
    const value = operatorFilter.value || null;
    renderer.setOperatorFilter(value); updateStats(value ?? ''); showStop(null);
  });
  loading.textContent = `国土数値情報 2022年 · EPSG:6668 → EPSG:3857 · 東京都の固定範囲`;
  new ResizeObserver(() => renderer.resize()).observe(canvas);

  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(renderer, data, firstFrameMs);
  }

  let drag: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    if (drag.moved) renderer.pan(dx, dy);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (drag && !drag.moved) {
      const rect = canvas.getBoundingClientRect(); renderer.selectAt(event.clientX - rect.left, event.clientY - rect.top);
    }
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    renderer.zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.001));
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    const amount = event.shiftKey ? 90 : 40;
    if (event.key === 'ArrowLeft') renderer.pan(amount, 0);
    else if (event.key === 'ArrowRight') renderer.pan(-amount, 0);
    else if (event.key === 'ArrowUp') renderer.pan(0, amount);
    else if (event.key === 'ArrowDown') renderer.pan(0, -amount);
    else if (event.key === '+' || event.key === '=') renderer.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.5);
    else if (event.key === '-') renderer.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.5);
    else if (event.key === 'Home') renderer.reset();
    else return;
    event.preventDefault();
  });
  document.querySelector('#zoom-in')!.addEventListener('click', () => renderer.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.5));
  document.querySelector('#zoom-out')!.addEventListener('click', () => renderer.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.5));
  document.querySelector('#reset')!.addEventListener('click', () => renderer.reset());
} catch (error) {
  loading.textContent = error instanceof Error ? `データを表示できません: ${error.message}` : 'データを表示できません。';
  loading.setAttribute('role', 'alert');
}
