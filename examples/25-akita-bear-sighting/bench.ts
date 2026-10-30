// Benchmarking and pixel verification for 25-akita-bear-sighting
import { emit, glRenderer, benchFrames } from '../../harness/page/bench.ts';

export async function runBench(api: any): Promise<void> {
  const { gl, canvas, meta, setDay, setFilter, render, readPixel } = api;

  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webgl context lost' }));

  const t0 = performance.now();
  render();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  emit({ metric: 'first_frame_ms', value: performance.now() - t0 });
  emit({ info: { gpu: glRenderer(gl), records: meta.totalRecords } });

  // Play timeline across 300 frames
  await benchFrames(gl, 300, (i) => {
    const day = (i / 300) * meta.maxDays;
    setDay(day);
  });

  // Verification checks:
  // 1. Autumn 2023 peak bear sighting in Akita city (clipX: -0.0513, clipY: 0.0407)
  setDay(555); // October 2023
  setFilter(true, true, true, true);
  render();
  const bearPixel = readPixel(-0.05128, 0.04073);

  const passBear = bearPixel[0] > 180 && bearPixel[0] > bearPixel[2] + 40;
  emit({
    check: 'autumn-2023-surge',
    pass: passBear,
    detail: `RGBA: ${bearPixel.join(',')}`,
  });

  // 2. Filter bear OFF -> pixel reverts to land background
  setFilter(false, true, true, true);
  render();
  const noBearPixel = readPixel(-0.05128, 0.04073);
  const passNoBear = noBearPixel[0] < 120 || Math.abs(noBearPixel[0] - noBearPixel[1]) < 30;
  emit({
    check: 'filter-bear-off',
    pass: passNoBear,
    detail: `RGBA: ${noBearPixel.join(',')}`,
  });

  // 3. Land background vs Sea background
  // Land: Akita inland (-0.0156, 0.0) vs Sea: Japan Sea (-0.546, 0.0)
  setFilter(true, true, true, true);
  render();
  const landPixel = readPixel(-0.0156, 0.0);
  const seaPixel = readPixel(-0.546, 0.0);
  const passLandSea = (landPixel[0] !== seaPixel[0] || landPixel[1] !== seaPixel[1] || landPixel[2] !== seaPixel[2])
    && seaPixel[2] > seaPixel[0]; // Sea has higher blue than red
  emit({
    check: 'land-background-visible',
    pass: passLandSea,
    detail: `Land: ${landPixel.join(',')}, Sea: ${seaPixel.join(',')}`,
  });

  // Reset to peak view for screenshot
  setDay(560);
  setFilter(true, true, true, true);
  render();

  emit({ done: true });
}
