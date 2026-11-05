import { mount } from './renderer.ts';
import { PROJECTION_NAMES, type ProjectionName } from './projections.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const selector = document.getElementById('projection') as HTMLSelectElement;
const note = document.getElementById('projection-note')!;
const descriptions: Record<ProjectionName, string> = {
  'Equirectangular': '経緯度をそのまま平面へ。赤道上の東西距離と緯度方向の角度を同じ縮尺で置きますが、高緯度ほど面積が大きく見えます。',
  'Mercator': '局所角度を保つ円筒図法。高緯度ほど面積が拡大し、極は無限遠なので ±85.0511° で切っています。',
  'Equal Earth': '世界全体の面積を保つ擬円筒図法。形状は地域により変わり、特に縁で東西方向が圧縮されます。',
  'Winkel Tripel': '距離・面積・形の歪みを全体として抑える妥協図法。特定の性質を完全には保ちません。',
};

try {
  const map = await mount(canvas, '../../../../data/baked/30DayMapChallenge-2026-22/countries.json');
  document.getElementById('status')!.textContent = `${map.data.features.length} COUNTRIES · ALL VIEWS SHARE ONE SOURCE`;
  for (const name of PROJECTION_NAMES) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selector.append(option);
  }
  selector.value = map.projection;
  const update = () => {
    map.setProjection(selector.value as ProjectionName);
    note.textContent = descriptions[map.projection];
  };
  selector.addEventListener('change', update);
  document.getElementById('reset')!.addEventListener('click', () => { selector.value = 'Equal Earth'; update(); });
  note.textContent = descriptions[map.projection];
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(map);
  }
} catch (error) {
  document.getElementById('status')!.textContent = `読み込みエラー: ${String(error)}`;
  console.error(error);
}
