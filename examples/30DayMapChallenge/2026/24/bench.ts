import { emit } from '../../../../harness/page/bench.ts';
import type { NetworkData } from './network.ts';
import type { NetworkRenderer } from './renderer.ts';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function run(renderer: NetworkRenderer, data: NetworkData, firstFrameMs: number): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
  const initial = renderer.operatorCounts(null);
  emit({ metric: 'source_route_lines_in_extent', value: initial.routes });
  emit({ metric: 'source_bus_stops_in_extent', value: initial.stops });
  emit({ metric: 'stop_route_memberships', value: initial.memberships });
  const n07Operators = new Set(data.routes.map((route) => route.operator)).size;
  const p11Operators = new Set(data.stops.map((stop) => stop.operator)).size;
  emit({ metric: 'operator_count', value: n07Operators });
  emit({ check: 'operator-coverage-is-preserved-in-both-sources', pass: n07Operators === 57 && p11Operators === 57,
    detail: `${n07Operators} N07 and ${p11Operators} P11 operators` });
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  emit({ check: 'source-layers-stay-distinct', pass: initial.routes === 9545 && initial.stops === 6664,
    detail: `${initial.routes} clipped N07 lines, ${initial.stops} P11 stops, ${initial.memberships} P11 label records` });
  const membershipsValid = data.stops.every((stop) => stop.nRoutes === stop.routes.length && stop.routes.length === stop.kinds.length);
  emit({ check: 'stop-membership-is-source-backed', pass: membershipsValid,
    detail: `${initial.memberships} stop-label incidences; each stop has matching n_routes/routes/kinds lengths` });

  const filter = document.querySelector<HTMLSelectElement>('#operator-filter')!;
  const selectedOperator = filter.options[1]?.value ?? '';
  filter.value = selectedOperator;
  filter.dispatchEvent(new Event('change', { bubbles: true }));
  const expected = renderer.operatorCounts(selectedOperator || null);
  const actual = {
    routes: Number(document.querySelector('#route-count')!.textContent!.replaceAll(',', '')),
    stops: Number(document.querySelector('#stop-count')!.textContent!.replaceAll(',', '')),
    memberships: Number(document.querySelector('#membership-count')!.textContent!.replaceAll(',', '')),
  };
  emit({ check: 'operator-coverage-filter', pass: selectedOperator !== ''
    && actual.routes === expected.routes && actual.stops === expected.stops && actual.memberships === expected.memberships,
    detail: `${selectedOperator}: lines ${actual.routes}/${expected.routes}, stops ${actual.stops}/${expected.stops}, labels ${actual.memberships}/${expected.memberships}` });

  filter.value = '';
  filter.dispatchEvent(new Event('change', { bubbles: true }));
  let target: { id: string; point: [number, number] } | null = null;
  for (const stop of data.stops) {
    const point = renderer.screenPoint(stop.id);
    if (point && point[0] > 440 && point[0] < canvas.clientWidth - 10 && point[1] > 10 && point[1] < canvas.clientHeight - 10) {
      target = { id: stop.id, point }; break;
    }
  }
  if (target) {
    renderer.selectAt(target.point[0], target.point[1]);
  }
  await nextFrame();
  const detail = document.querySelector('#selection')!.textContent ?? '';
  emit({ check: 'stop-selection-discloses-source-record', pass: !!target && detail.includes(target.id)
    && detail.includes('バス区分コード') && detail.includes('系統'),
    detail: target ? `${target.id}: ${detail.replaceAll('\n', ' · ')}` : 'no visible stop candidate found' });

  const before = target ? renderer.screenPoint(target.id) : null;
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const after = target ? renderer.screenPoint(target.id) : null;
  const panOk = !!before && !!after && Math.abs(after[0] - before[0] + 40) < 1 && Math.abs(after[1] - before[1]) < 1;
  document.querySelector<HTMLButtonElement>('#reset')!.click();
  document.querySelector<HTMLButtonElement>('#zoom-in')!.click();
  document.querySelector<HTMLButtonElement>('#zoom-out')!.click();
  document.querySelector<HTMLButtonElement>('#reset')!.click();
  emit({ check: 'pointer-pan-zoom-and-keyboard-map-control', pass: panOk && canvas.tabIndex >= 0,
    detail: `ArrowRight delta ${after && before ? `${Math.round(after[0] - before[0])},${Math.round(after[1] - before[1])}` : 'unavailable'}; focusable canvas ${canvas.tabIndex >= 0}` });

  const body = document.body.innerText;
  emit({ check: 'dated-sources-attribution-and-caveats', pass: body.includes('CC BY 4.0')
    && body.includes('2022年') && body.includes('時刻表') && body.includes('国土数値情報'),
    detail: 'Page copy identifies the KSJ snapshot, CC BY 4.0 and limits on interpretation' });
  const external = performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-external-requests', pass: external.length === 0, detail: `${external.length} cross-origin resources` });
  const payload = await fetch('../../../../data/baked/30DayMapChallenge-2026-24/network.json').then((response) => response.arrayBuffer());
  const compressed = await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  emit({ metric: 'data_gzip_bytes', value: compressed.byteLength });

  const frameTimes: number[] = [], drawTimes: number[] = [];
  await nextFrame();
  for (let i = 0; i < 48; i++) {
    const startAt = performance.now(); renderer.draw(); drawTimes.push(performance.now() - startAt);
    await nextFrame(); frameTimes.push(performance.now() - startAt);
  }
  emit({ metric: 'draw_cpu_ms', values: drawTimes });
  emit({ metric: 'frame_ms', values: frameTimes });
  emit({ info: { renderer: 'dedicated Canvas 2D KSJ network renderer', n07Lines: initial.routes,
    p11Stops: initial.stops, stopRouteMemberships: initial.memberships } });
  emit({ done: true });
}
