import { calibrationPxPerMm } from './territory.ts';
import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const overview = document.getElementById('overview') as HTMLCanvasElement;
const numberFormat = new Intl.NumberFormat('ja-JP');

try {
  const map = await mount(canvas, overview, '../../../../data/baked/30DayMapChallenge-2026-14');
  document.getElementById('counts')!.textContent = `${numberFormat.format(map.stats.sourceBuildingRows)}件`;
  document.getElementById('metrics')!.textContent = `${numberFormat.format(map.stats.vertexCount)} 頂点 · ${numberFormat.format(map.stats.ringCount)} 輪郭 · 1投影単位はメートル`;

  const cardWidth = document.getElementById('card-width') as HTMLInputElement;
  const reference = document.getElementById('card-reference') as HTMLDivElement;
  const calibrationStatus = document.getElementById('calibration-status')!;
  const physicalButton = document.getElementById('physical-mode') as HTMLButtonElement;
  const overviewButton = document.getElementById('overview-mode') as HTMLButtonElement;
  const scaleStatus = document.getElementById('scale-status')!;
  const scaleLabel = document.getElementById('scale-label')!;
  const scaleBar = document.getElementById('scale-bar') as HTMLDivElement;
  const selection = document.getElementById('selection')!;

  function updateCard() {
    const maxPixels = Math.max(1, reference.parentElement!.clientWidth);
    cardWidth.min = '1';
    cardWidth.max = String(maxPixels);
    if (Number(cardWidth.value) > maxPixels) cardWidth.value = String(maxPixels);
    const pixels = Number(cardWidth.value);
    reference.style.width = `${pixels}px`;
  }
  function updateScale() {
    const modePhysical = map.state.physicalMode;
    const zoom = map.view.zoom;
    const exact = map.state.calibrated && modePhysical && Math.abs(zoom - 1) < 1e-6;
    const pxPerMm = map.state.calibrated ? calibrationPxPerMm(map.state.cardReferenceCssPixels) : 0;
    if (!map.state.calibrated) {
      scaleStatus.textContent = '縮尺: 画面スケール不明（未校正）';
      scaleLabel.textContent = '画面スケール不明';
      scaleBar.style.width = '0px';
    } else if (exact) {
      const mpp = Math.cos(map.stats.physicalFocus.wgs84.lat * Math.PI / 180);
      scaleStatus.textContent = `局所地表 1:1 · 画面 ${pxPerMm.toFixed(3)} CSS px/mm · Web Mercator cos φ=${mpp.toFixed(5)} 補正済み`;
      scaleLabel.textContent = '地表 50 mm';
      scaleBar.style.width = `${Math.max(1, 50 * pxPerMm)}px`;
    } else if (modePhysical) {
      scaleStatus.textContent = `校正済み · ズーム ×${zoom.toFixed(3)} · 現在は1:1ではありません`;
      scaleLabel.textContent = `1:1基準から ×${zoom.toFixed(2)}`;
      scaleBar.style.width = `${Math.max(1, 50 * pxPerMm * zoom)}px`;
    } else {
      scaleStatus.textContent = '500 m 全体図 · 画面表示は1:1ではありません';
      scaleLabel.textContent = 'EPSG:3857 投影上 50 m';
      scaleBar.style.width = `${Math.max(1, 50 * map.scalePxPerProjectedMeter)}px`;
    }
    physicalButton.setAttribute('aria-pressed', String(modePhysical));
    overviewButton.setAttribute('aria-pressed', String(!modePhysical));
  }

  updateCard(); updateScale();
  cardWidth.addEventListener('input', () => {
    updateCard();
    if (map.state.calibrated) {
      map.setPhysicalMode(false); map.state.calibrated = false; physicalButton.disabled = true;
      calibrationStatus.textContent = '幅が変わりました — 実物のカード幅に合わせて再校正してください'; updateScale();
    }
  });
  window.addEventListener('resize', () => {
    updateCard();
    if (map.state.calibrated) {
      map.setPhysicalMode(false); map.state.calibrated = false; physicalButton.disabled = true;
      calibrationStatus.textContent = '表示領域が変わりました — 実物のカード幅に合わせて再校正してください'; updateScale();
    }
  });
  document.getElementById('calibrate')!.addEventListener('click', () => {
    map.setCalibration(Number(cardWidth.value));
    physicalButton.disabled = false;
    calibrationStatus.textContent = `校正済み · 85.60 mm = ${cardWidth.value} CSS px · 表示環境を変えたら再校正してください`;
    updateScale();
  });
  physicalButton.addEventListener('click', () => {
    map.setPhysicalMode(true); updateScale();
  });
  overviewButton.addEventListener('click', () => {
    map.setPhysicalMode(false); updateScale();
  });
  document.getElementById('reset-scale')!.addEventListener('click', () => {
    if (!map.state.calibrated) {
      selection.textContent = '先に画面表示をカード幅で校正してください。';
      return;
    }
    map.setPhysicalMode(true); updateScale();
  });
  canvas.addEventListener('wheel', () => requestAnimationFrame(updateScale), { passive: true });
  canvas.addEventListener('territoryselect', (event) => {
    const { index, x, y } = (event as CustomEvent<{ index: number; x: number; y: number }>).detail;
    if (index < 0) return;
    const feature = map.dataset.features[index]!;
    const osmKind = feature.id < 0n ? 'way' : 'relation';
    const osmId = feature.id < 0n ? -feature.id : feature.id;
    const [worldX, worldY] = map.projectedAt(x, y);
    const lon = worldX / 6378137 * 180 / Math.PI;
    const lat = (2 * Math.atan(Math.exp(worldY / 6378137)) - Math.PI / 2) * 180 / Math.PI;
    selection.replaceChildren();
    const label = document.createElement('span');
    label.textContent = `建物 #${osmId} · ${feature.kind} · 選択地点 ${lat.toFixed(7)}°N, ${lon.toFixed(7)}°E · OSM `;
    const link = document.createElement('a'); link.href = `https://www.openstreetmap.org/${osmKind}/${osmId}`; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = `${osmKind}/${osmId}`;
    selection.append(label, link);
  });

  const promptResponse = await fetch('./PROMPT.md');
  if (promptResponse.ok) document.getElementById('prompt-text')!.textContent = await promptResponse.text();
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(map);
  }
} catch (error) {
  console.error(error);
  const node = document.createElement('pre'); node.className = 'error'; node.textContent = String(error); document.body.append(node);
}
