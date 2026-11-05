import { CATEGORY_COLORS, CATEGORIES, mount, type FlowMap } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const selectedName = document.getElementById('selected-name')!;
const total = document.getElementById('selected-total')!;
const breakdown = document.getElementById('breakdown')!;
const month = document.getElementById('month') as HTMLInputElement;
const monthText = document.getElementById('month-text')!;
const dayType = document.getElementById('day-type') as HTMLSelectElement;
const timezone = document.getElementById('timezone') as HTMLSelectElement;
let map: FlowMap;

async function updateMonth() {
  const index = Number(month.value);
  const year = Math.floor(index / 12), monthIndex = index % 12;
  await map.setFrame(year, monthIndex);
  const label = `${map.dataset.years[map.state.year]}年 ${String(map.state.month + 1).padStart(2, '0')}月`;
  monthText.textContent = label; month.setAttribute('aria-valuetext', label); updatePanel(); map.draw();
}
function updatePanel() {
  const city = map.selectedMunicipality();
  if (!city) { selectedName.textContent = '地図上の市区町村を選択'; total.textContent = ''; breakdown.replaceChildren(); return; }
  const bins = map.values(map.state.selected), sum = bins.reduce((a, b) => a + b, 0);
  selectedName.textContent = `${city.prefecture} ${city.name}`;
  total.textContent = sum ? `月平均 ${sum.toLocaleString()} 人（公表された区分値の合計）` : '値なし（非公表またはデータなし）';
  breakdown.replaceChildren();
  const largest = Math.max(1, ...bins);
  bins.forEach((value, i) => {
    const row = document.createElement('div'); row.className = 'flow-row';
    const label = document.createElement('span'); label.textContent = CATEGORIES[i]!;
    const track = document.createElement('span'); track.className = 'track';
    const fill = document.createElement('i'); fill.style.width = `${Math.max(0, value / largest * 100)}%`; fill.style.background = CATEGORY_COLORS[i]!;
    track.append(fill);
    const amount = document.createElement('b'); amount.textContent = value ? value.toLocaleString() : '—';
    row.append(label, track, amount); breakdown.append(row);
  });
}

try {
  map = await mount(canvas, '../../../../data/baked/30DayMapChallenge-2026-13');
  const stats = map.stats;
  const initial = map.dataset.municipalities.findIndex((city) => city.code === '13106');
  if (initial >= 0) map.select(initial);
  month.value = '34'; await updateMonth(); updatePanel();
  status.textContent = `${stats.municipalityCount.toLocaleString()} 市区町村 · 都道府県境界 ${stats.prefectureCount} 件 · データ ${stats.sourceVintage}`;
  canvas.addEventListener('municipality-select', (event) => {
    const index = (event as CustomEvent<{ index: number }>).detail.index; map.select(index); updatePanel();
  });
  month.addEventListener('input', () => { void updateMonth().catch((error) => { status.textContent = `月データ読み込みエラー: ${String(error)}`; }); });
  dayType.addEventListener('change', () => { map.state.dayType = Number(dayType.value); updatePanel(); map.draw(); });
  timezone.addEventListener('change', () => { map.state.timezone = Number(timezone.value); updatePanel(); map.draw(); });
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts'); await run(map);
  }
} catch (error) {
  console.error(error); status.textContent = `データ読み込みエラー: ${String(error)}`;
}
