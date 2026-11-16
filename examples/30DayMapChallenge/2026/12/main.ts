import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const slider = document.getElementById('year') as HTMLInputElement;
const yearLabel = document.getElementById('year-value')!;
const coverage = document.getElementById('coverage')!;
const playButton = document.getElementById('play') as HTMLButtonElement;
let playing = false, timer = 0;

try {
  const map = await mount(canvas, '../../../../data/baked/30DayMapChallenge-2026-12');
  slider.min = String(map.stats.startYear); slider.max = String(map.stats.endYear); slider.value = String(map.stats.endYear);
  const updateYear = (year: number) => {
    map.setYear(year); slider.value = String(year); yearLabel.textContent = String(year);
    const count = map.stats.joinedByYear[year - map.stats.startYear]!;
    coverage.textContent = `${count} / ${map.stats.renderedCountryCount} か国に値あり`;
  };
  updateYear(map.stats.endYear);
  slider.addEventListener('input', () => updateYear(Number(slider.value)));
  playButton.addEventListener('click', () => {
    playing = !playing; playButton.textContent = playing ? '停止' : '▶ 再生'; playButton.setAttribute('aria-pressed', String(playing));
    if (playing) {
      let year = Number(slider.value);
      timer = window.setInterval(() => { year = year >= map.stats.endYear ? map.stats.startYear : year + 1; updateYear(year); }, 550);
    } else window.clearInterval(timer);
  });
  document.getElementById('counts')!.textContent = `${map.stats.renderedCountryCount} か国 · ${map.stats.startYear}–${map.stats.endYear}年 · ${map.stats.polygonCount.toLocaleString()} ポリゴン`;
  document.getElementById('release')!.textContent = `World Development Indicators · ${map.stats.sourceDate} スナップショット · ${map.stats.indicator}`;
  document.getElementById('source-status')!.textContent = '電力アクセス率（総人口に占めるアクセス人口の割合）を国別に表示。送電網・供給の安定性・発電構成を表しません。';
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts'); await run(map);
  }
} catch (error) {
  console.error(error);
  if (new URLSearchParams(location.search).has('bench')) {
    window.__mfsEmit?.(JSON.stringify({ error: String(error) }));
    window.__mfsEmit?.(JSON.stringify({ done: true }));
  } else {
    const node = document.createElement('pre'); node.className = 'error'; node.textContent = `地図データを読み込めません: ${String(error)}`; document.body.append(node);
  }
}
