import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
try {
  const map = await mount(canvas, '../../../../data/baked/30DayMapChallenge-2026-10');
  const { stats } = map;
  document.getElementById('counts')!.textContent = `${stats.renderedAirports.toLocaleString()} か所を描画 · 定期便あり ${stats.scheduledServiceAirports.toLocaleString()} か所`;
  document.getElementById('source-counts')!.textContent = `OurAirports ${stats.sourceAirportRows.toLocaleString()} レコード中、閉鎖または座標なし ${stats.excludedClosedOrUnlocated.toLocaleString()} 件を除外`;
  const promptResponse = await fetch('./PROMPT.md');
  if (!promptResponse.ok) throw new Error(`PROMPT.md: HTTP ${promptResponse.status}`);
  const prompt = await promptResponse.text();
  const productionPrompt = prompt.match(/^## 実際に地図を作るために用いたプロンプト\s*\n\s*> ([\s\S]*?)(?=\n\n|$)/m)?.[1];
  document.getElementById('prompt-text')!.textContent = productionPrompt ?? '地図制作プロンプトを読み込めませんでした。';
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(map);
  }
} catch (error) {
  console.error(error);
  const node = document.createElement('pre');
  node.className = 'error';
  node.textContent = String(error);
  document.body.append(node);
}
