import { emit } from '../../../../harness/page/bench.ts';
import type { UtopiaMap } from './renderer.ts';

export async function run(map: UtopiaMap) {
  const { data } = map;
  const dualAccess = data.cells.filter((cell) => cell.walkableToPark && cell.walkableToSchool).length;
  emit({ metric: 'mesh_count', value: data.cells.length });
  emit({ metric: 'park_count', value: data.parks.length });
  emit({ metric: 'school_count', value: data.schools.length });
  emit({ metric: 'both_accessible_mesh_count', value: dualAccess });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ info: { renderer: 'Canvas 2D custom mesh and polygon renderer', center: 'Nerima Station', meshes: data.cells.length, parks: data.parks.length, schools: data.schools.length, dual_access_meshes: dualAccess } });
  emit({ check: 'dual-access-coverage', pass: dualAccess > 0 && data.parks.length >= 20 && data.schools.length >= 20, detail: `${dualAccess} of ${data.cells.length} population meshes are within 400 m of both a park and a school` });
  emit({ check: 'population-mesh', pass: data.cells.every((cell) => Number.isFinite(cell.population) && cell.population >= 0) && data.cells.length >= 200, detail: `${data.cells.length} valid Tokyo 2020 census fifth-level meshes` });
  const outsideContext = map.canvas.getContext('2d', { willReadFrequently: true })!.getImageData(Math.floor(map.canvas.width * 0.12), Math.floor(map.canvas.height / 2), 1, 1).data;
  emit({ check: 'study-area-clip', pass: outsideContext[0] === 16 && outsideContext[1] === 28 && outsideContext[2] === 35, detail: `outer canvas sample RGB ${outsideContext[0]},${outsideContext[1]},${outsideContext[2]}` });
  const outerRegion = map.canvas.getContext('2d')!.getImageData(0, Math.floor(map.canvas.height * 0.42), Math.floor(map.canvas.width * 0.22), Math.floor(map.canvas.height * 0.16)).data;
  let changedPixels = 0;
  for (let i = 0; i < outerRegion.length; i += 4) if (outerRegion[i] !== 16 || outerRegion[i + 1] !== 28 || outerRegion[i + 2] !== 35) changedPixels++;
  emit({ check: 'empty-outer-margin', pass: changedPixels === 0, detail: `${changedPixels} pixels differ from the background in the outside margin` });
  const disclosure = document.body.innerText;
  const hrefs = [...document.querySelectorAll('a')].map((anchor) => anchor.href);
  emit({ check: 'source-disclosure', pass: disclosure.includes('国勢調査') && disclosure.includes('都市計画決定GISデータ') && disclosure.includes('国土数値情報') && disclosure.includes('CC BY 4.0')
    && hrefs.some((href) => href.startsWith('https://www.e-stat.go.jp/gis/statmap-search'))
    && hrefs.includes('https://www.mlit.go.jp/toshi/tosiko/toshi_tosiko_tk_000087.html')
    && hrefs.includes('https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P29-2023.html')
    && hrefs.includes('https://creativecommons.org/licenses/by/4.0/'), detail: 'e-Stat, MLIT planning GIS, KSJ schools, processed-data note and CC BY 4.0 links are visible' });
  const initial = { ...map.state }, frameTimes: number[] = [], drawTimes: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 80; i++) {
    map.state.zoom = 1 + 1.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 79));
    map.state.panX = Math.sin(i / 13) * 35 * devicePixelRatio;
    const start = performance.now(); map.draw(); drawTimes.push(performance.now() - start);
    await new Promise(requestAnimationFrame); frameTimes.push(performance.now() - start);
  }
  Object.assign(map.state, initial); map.draw();
  emit({ metric: 'draw_cpu_ms', values: drawTimes });
  emit({ metric: 'frame_ms', values: frameTimes });
  emit({ done: true });
}
