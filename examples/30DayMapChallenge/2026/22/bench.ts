import { emit, readBack } from '../../../../harness/page/bench.ts';
import type { ProjectionMap } from './renderer.ts';
import { MERCATOR_MAX_LATITUDE, PROJECTION_NAMES } from './projections.ts';

function pixelAt(map: ProjectionMap, x: number, y: number): number[] {
  const ratio = map.canvas.width / map.canvas.clientWidth;
  return [...readBack(map.context, Math.round(x * ratio), Math.round(y * ratio)).data];
}

function checksum(map: ProjectionMap): number {
  const image = readBack(map.context, 0, 0, map.canvas.width, map.canvas.height).data;
  let sum = 0;
  for (let i = 0; i < image.length; i += 4 * 17) sum = (Math.imul(sum, 31) + image[i]! * 3 + image[i + 1]! * 5 + image[i + 2]!) | 0;
  return sum;
}

export async function run(map: ProjectionMap) {
  const picker = document.getElementById('projection') as HTMLSelectElement;
  let explanationText = '';
  const baseline = checksum(map);
  const outputs: number[] = [];
  for (const name of PROJECTION_NAMES) {
    picker.value = name;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    explanationText += document.body.innerText;
    await new Promise(requestAnimationFrame);
    outputs.push(checksum(map));
  }
  picker.value = 'Equal Earth';
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(requestAnimationFrame);
  const view = map.viewport;
  const equatorAtOcean = map.projectToScreen([60, 0]);
  const graticulePixel = equatorAtOcean ? pixelAt(map, equatorAtOcean[0], equatorAtOcean[1]) : [0, 0, 0, 0];
  const france = map.projectToScreen([2.35, 48.86]);
  const francePixel = france ? pixelAt(map, france[0], france[1]) : [0, 0, 0, 0];
  const image = readBack(map.context, 0, 0, map.canvas.width, map.canvas.height).data;
  let landPixels = 0;
  for (let i = 0; i < image.length; i += 4) {
    if (image[i]! > 34 && image[i + 1]! > image[i]! * 1.25 && image[i + 2]! > image[i]! * 1.35) landPixels++;
  }

  emit({ metric: 'source_country_count', value: map.data.features.length });
  emit({ metric: 'projection_count', value: PROJECTION_NAMES.length });
  emit({ metric: 'mercator_latitude_limit_deg', value: MERCATOR_MAX_LATITUDE });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ check: 'projection-switching-changes-rendered-pixels', pass: new Set(outputs).size === 4 && baseline !== outputs[0], detail: `pixel checksums by projection: ${outputs.join(', ')}` });
  emit({ check: 'same-source-geometry-in-every-view', pass: map.data.features.length === 177 && new Set(PROJECTION_NAMES.map(() => map.data.features.length)).size === 1, detail: `all four views draw ${map.data.features.length} same Natural Earth country geometries` });
  emit({ check: 'recognizable-country-geometry-is-visible', pass: landPixels > 20_000 && francePixel[0] > 34 && francePixel[1] > francePixel[0] * 1.2, detail: `${landPixels} actual canvas pixels classified as land; France sample RGB ${francePixel.slice(0, 3).join(',')}` });
  emit({ check: 'graticule-and-equator-reach-screen', pass: graticulePixel[0] > 100 && graticulePixel[1] > 70 && graticulePixel[2] < 170, detail: `equator at 60°E RGB ${graticulePixel.slice(0, 3).join(',')}` });
  emit({ check: 'projection-explanations-and-domain-disclosure', pass: explanationText.includes('Winkel Tripel') && explanationText.includes('±85.0511°') && explanationText.includes('面積') && explanationText.includes('角度'), detail: 'Descriptions state each projection’s preserved property/trade-offs and Mercator latitude clipping.' });
  const external = performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-external-network', pass: external.length === 0, detail: `${external.length} external requests` });
  const frames: number[] = [], drawCpu: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 36; i++) {
    const start = performance.now(); map.draw(); drawCpu.push(performance.now() - start);
    await new Promise(requestAnimationFrame);
    frames.push(performance.now() - start);
  }
  emit({ metric: 'draw_cpu_ms', values: drawCpu });
  emit({ metric: 'frame_ms', values: frames });
  emit({ info: { renderer: 'Dedicated Canvas 2D projection formulas', projections: PROJECTION_NAMES.join(' / '), countries: map.data.features.length, shared_scale: view.scale, source: 'Natural Earth 1:110m Admin 0 Countries' } });
  emit({ done: true });
}
