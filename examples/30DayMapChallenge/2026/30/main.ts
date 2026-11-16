declare global { interface Window { __mfsEmit?: (payload: string) => void } }
const started = performance.now();
const image = document.querySelector<HTMLImageElement>('#sheet');
const status = document.querySelector<HTMLElement>('#status');
const printButton = document.querySelector<HTMLButtonElement>('#print');

if (!image || !status || !printButton) throw new Error('印刷プレビュー要素がありません');
const preview = image;
const statusElement = status;
printButton.addEventListener('click', () => window.print());

async function start(): Promise<void> {
  try {
    const response = await fetch('../../../../data/baked/30DayMapChallenge-2026-30/sheet.svg');
    if (!response.ok) throw new Error(`印刷シートを取得できません (HTTP ${response.status})`);
    const svg = await response.text();
    await preview.decode();
    if (preview.naturalWidth / preview.naturalHeight < 1.4 || preview.naturalWidth / preview.naturalHeight > 1.43) {
      throw new Error('A4横向きのSVG比率が正しくありません');
    }
    statusElement.textContent = `A4横 · 100 m等高線 · ${new TextEncoder().encode(svg).byteLength.toLocaleString()} B`;
    document.documentElement.dataset.ready = 'true';
    const params = new URLSearchParams(location.search);
    if (params.has('bench')) {
      const { run } = await import('./bench.ts');
      await run(preview, svg, started);
    }
  } catch (error) {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
    statusElement.dataset.error = 'true';
    console.error(error);
    window.__mfsEmit?.(JSON.stringify({ error: statusElement.textContent }));
  }
}
await start();

export {};
