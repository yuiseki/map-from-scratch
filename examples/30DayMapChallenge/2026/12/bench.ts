import { emit, readBack } from '../../../../harness/page/bench.ts';
import type { PowerMap } from './renderer.ts';
import { powerColor } from './power.ts';

function containsColor(map: PowerMap, iso3: string, color: [number, number, number]): { found: boolean; center: number[] } {
  const point = map.screenForCountry(iso3);
  if (!point) return { found: false, center: [] };
  const dpr = Math.min(2, window.devicePixelRatio || 1), pixels = readBack(map.canvas.getContext('2d')!, point.x * dpr - 9, point.y * dpr - 9, 19, 19).data;
  const center = [...pixels.slice((9 * 19 + 9) * 4, (9 * 19 + 9) * 4 + 3)];
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.abs(pixels[i]! - color[0]) < 24 && Math.abs(pixels[i + 1]! - color[1]) < 24 && Math.abs(pixels[i + 2]! - color[2]) < 24) return { found: true, center };
  }
  return { found: false, center };
}

export async function run(map: PowerMap) {
  const { stats, countries } = map;
  const coverage1990 = stats.joinedByYear[1990 - stats.startYear]!, coverage2024 = stats.joinedByYear[2024 - stats.startYear]!;
  emit({ metric: 'joined_country_1990', value: coverage1990 });
  emit({ metric: 'joined_country_2024', value: coverage2024 });
  emit({ metric: 'rendered_country_count', value: countries.length });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ metric: 'data_bytes', value: stats.geometryBytes + stats.accessBytes });
  emit({ info: { renderer: 'TypeScript + Canvas 2D custom Equal Earth choropleth', sourceDate: stats.sourceDate,
    indicator: stats.indicator, years: `${stats.startYear}-${stats.endYear}`, renderedCountries: countries.length,
    polygons: stats.polygonCount, rings: stats.ringCount, vertices: stats.pointCount, coverage1990, coverage2024 } });
  emit({ check: 'coverage-by-year', pass: coverage1990 >= 80 && coverage2024 >= 200 && countries.length >= 250,
    detail: `${coverage1990} countries joined in 1990; ${coverage2024} in 2024 across ${countries.length} geometries` });
  const expected: Record<string, number> = { JPN: 100, CHN: 100, IND: 99.9, USA: 100, COD: 22.5 };
  const wrong = Object.entries(expected).filter(([code, value]) => Math.abs((map.value(code, 2024) ?? NaN) - value) > 0.05);
  const oldDrc = map.value('COD', 1990);
  emit({ check: 'missing-and-known-values', pass: wrong.length === 0 && oldDrc === null && coverage1990 < countries.length,
    detail: `${wrong.length} unexpected 2024 known values; DRC 1990=${oldDrc}; ${countries.length - coverage1990} countries have no 1990 value` });
  map.setYear(2024);
  await map.whenYearRendered(2024);
  const japanColor = powerColor(map.value('JPN', 2024));
  const japanPixel = containsColor(map, 'JPN', japanColor);
  map.setYear(1990);
  await map.whenYearRendered(1990);
  const drcPixel = containsColor(map, 'COD', powerColor(null));
  const ocean = readBack(map.canvas.getContext('2d')!, 1, 1).data;
  const oceanPixel = Math.abs(ocean[0]! - 9) < 6 && Math.abs(ocean[1]! - 21) < 8;
  emit({ check: 'map-pixels', pass: japanPixel.found && drcPixel.found && oceanPixel,
    detail: `Japan 2024 ${japanPixel.found} center=${japanPixel.center}; DRC No Data 1990 ${drcPixel.found} center=${drcPixel.center}; ocean ${oceanPixel}` });
  const text = document.body.innerText;
  const links = [...document.querySelectorAll('a')].map((anchor) => anchor.href);
  emit({ check: 'source-disclosure', pass: text.includes('EG.ELC.ACCS.ZS') && text.includes('2026-10-01') && text.includes('CC BY 4.0')
    && text.includes('送電網') && text.includes('does not endorse') && links.includes('https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS'),
    detail: 'indicator, source snapshot, license, non-endorsement and scope caveat are visible' });
  const original = { ...map.view }, frames: number[] = [], cpu: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 80; i++) {
    map.view.zoom = 1 + 1.15 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 79));
    map.view.panX = Math.sin(i / 15) * 36; map.view.panY = Math.cos(i / 19) * 22;
    const started = performance.now(); map.draw();
    cpu.push(performance.now() - started); await new Promise(requestAnimationFrame); frames.push(performance.now() - started);
  }
  Object.assign(map.view, original); map.setYear(2024);
  const yearCpu: number[] = [], yearFrames: number[] = [];
  for (let i = 0; i < 35; i++) {
    const target = stats.startYear + i, started = performance.now(); map.setYear(target);
    yearCpu.push(performance.now() - started); await map.whenYearRendered(target); yearFrames.push(performance.now() - started);
  }
  map.setYear(2024);
  emit({ metric: 'draw_cpu_ms', values: cpu }); emit({ metric: 'frame_ms', values: frames });
  emit({ metric: 'year_change_cpu_ms', values: yearCpu }); emit({ metric: 'year_change_frame_ms', values: yearFrames }); emit({ done: true });
}
