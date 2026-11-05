// Bench for htmlcanvas-003, loaded only with ?bench. The interaction checks
// go through the browser's own hit testing: document.elementFromPoint at the
// screen position of a control must return that control, and the click is
// sent to what it returned. A click dispatched on the control itself would
// pass without hit testing, so it is not used as evidence.
import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import { applyCss, cssTransform, facing, projectWorld, clipMatrix, unitVector, zoom, type Camera } from './geometry.ts';
import { formatPeople, valueAt } from './data.ts';
import type { App, PanelView } from './main.ts';

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

export async function run(app: App): Promise<void> {
  const { canvas, gl, views } = app;
  canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));
  const wantDrawable = !new URLSearchParams(location.search).has('fallback');
  const OPEN: Camera = { ...app.camera() };

  // First frame: from the page's first script to the first draw with every visible panel's texture.
  for (let i = 0; i < 300 && !app.firstFrame(); i++) await frame();
  emit({ metric: 'first_frame_ms', value: app.firstFrame() });
  const sizes = views.map((v) => v.texture ? `${v.texture.width}x${v.texture.height}` : 'none');
  const textureBytes = views.reduce((s, v) => s + (v.texture ? Math.round(v.texture.width * v.texture.height * 4 * 4 / 3) : 0), 0);
  emit({ info: { gpu: glRenderer(gl), path: app.drawable ? 'html-in-canvas' : 'dom-overlay', panel_textures: sizes.join(' '), texture_bytes_with_mips: textureBytes } });

  emit({
    check: 'render-path', pass: app.drawable === wantDrawable,
    detail: `content=${canvas.getAttribute('content')}, drawable=${app.drawable}, wanted ${wantDrawable ? 'html-in-canvas' : 'fallback (?fallback)'}`,
  });

  const W = () => canvas.clientWidth, H = () => canvas.clientHeight;
  const pixel = (x: number, y: number): number[] => {
    const d = canvas.width / W(), out = new Uint8Array(4);
    gl.readPixels(Math.round(x * d), canvas.height - 1 - Math.round(y * d), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [...out];
  };
  // Mean colour of a 5x5 neighbourhood; read right after app.render() in the same task.
  const mean = (x: number, y: number): number[] => {
    const s = [0, 0, 0];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const p = pixel(x + dx, y + dy); for (let i = 0; i < 3; i++) s[i] += p[i] / 25; }
    return s.map(Math.round);
  };
  const isCard = (c: number[]) => c[0] > 230 && c[1] > 230 && c[2] > 230;
  const byId = (id: string) => views.find((v) => v.place.id === id)!;
  // Centre of a control in its panel's CSS box (layout, untouched by the canvas transform).
  const localCentre = (v: PanelView, el: HTMLElement): [number, number] => {
    let x = el.offsetWidth / 2, y = el.offsetHeight / 2;
    for (let e: HTMLElement | null = el; e && e !== v.el; e = e.offsetParent as HTMLElement | null) { x += e.offsetLeft; y += e.offsetTop; }
    return [x, y];
  };
  const centreOf = (v: PanelView, el: HTMLElement): [number, number] => applyCss(v.css!, ...localCentre(v, el));
  const paint = () => new Promise<Event & { changedElements?: Element[] }>((r) => canvas.addEventListener('paint', (e) => r(e as Event & { changedElements?: Element[] }), { once: true }));
  const hitName = (e: Element | null) => e ? `${e.tagName.toLowerCase()}${e.className ? '.' + e.className : ''}${e.closest('.panel') ? ' in ' + (e.closest('.panel') as HTMLElement).dataset.id : ''}` : 'null';

  // The opening view faces the Atlantic: London, Lagos, New York and São Paulo
  // stand on the near side and Tokyo on the far side (geography, not the renderer).
  app.setCamera(OPEN);
  app.render();
  const shown = views.filter((v) => v.visible).map((v) => v.place.id).sort().join(',');
  const cards = views.filter((v) => v.visible).map((v) => [v.place.id, mean(...applyCss(v.css!, 215, 14))] as const);
  const tokyo = byId('tokyo');
  const tokyoFree = !tokyo.visible && !document.elementFromPoint(...(projectWorld(clipMatrix(OPEN, W() / H()), unitVector(139.7, 35.7), W(), H()) ?? [0, 0]))?.closest('.panel');
  emit({
    check: 'panels-drawn-in-canvas',
    pass: shown === 'lagos,london,new-york,sao-paulo' && tokyoFree && (app.drawable ? cards.every(([, c]) => isCard(c)) : cards.every(([, c]) => !isCard(c))),
    detail: `visible ${shown}; tokyo hidden and not hit ${tokyoFree}; canvas pixel inside each card (${app.drawable ? 'must be the card colour' : 'fallback: must not be, the card is DOM'}): ${cards.map(([id, c]) => `${id}=${c}`).join(' ')}`,
  });

  // Pins drawn where the cities are, in their geographic order; desert north of the Gulf of Guinea, ocean south of it.
  const m = clipMatrix(OPEN, W() / H());
  const at = (lon: number, lat: number) => projectWorld(m, unitVector(lon, lat), W(), H())!;
  const pins = ['london', 'lagos', 'new-york', 'sao-paulo'].map((id) => { const v = byId(id); const [x, y] = at(v.place.lon, v.place.lat); return { id, x, y, c: pixel(x, y) }; });
  const pin = (id: string) => pins.find((p) => p.id === id)!;
  const order = pin('london').y < pin('lagos').y && pin('sao-paulo').x < pin('lagos').x && pin('new-york').x < pin('london').x && pin('sao-paulo').y > pin('lagos').y;
  const desertAt = at(2, 31), oceanAt = at(-10, -20);
  const desert = mean(...desertAt), ocean = mean(...oceanAt);
  const bare = [desertAt, oceanAt].every((p) => document.elementFromPoint(...p) === canvas);
  emit({
    check: 'geography-on-screen',
    pass: order && pins.every((p) => p.c[0] > 180 && p.c[1] < 130) && bare && desert[0] > ocean[0] + 40 && ocean[2] > ocean[0],
    detail: `pins ${pins.map((p) => `${p.id}@${p.x.toFixed(0)},${p.y.toFixed(0)}=${p.c}`).join(' ')}; order ok ${order}; not under a panel ${bare} (${[desertAt, oceanAt].map((p) => `${p.map(Math.round)}:${hitName(document.elementFromPoint(...p))}`).join(' ')}); Sahara 2E 31N ${desert}, Atlantic 10W 20S ${ocean}`,
  });

  // A real click through hit testing on London's bookmark button.
  const london = byId('london');
  const [bx, by] = centreOf(london, london.button);
  app.render();
  const before = mean(bx - 18, by);
  const hit = document.elementFromPoint(bx, by);
  const uploadsBefore = london.uploads;
  const painted = app.drawable ? paint() : Promise.resolve(null);
  (hit as HTMLElement | null)?.click();
  const ev = await Promise.race([painted, new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
  app.render();
  const after = mean(bx - 18, by);
  london.button.focus();
  const focused = document.activeElement === london.button;
  const hudOk = document.getElementById('bookmarks')!.textContent === 'ロンドン';
  const blueToGreen = app.drawable ? before[2] > 180 && before[0] < 80 && after[1] > 120 && after[0] < 60 && after[2] < 120 : true;
  emit({
    check: 'button-click-through-hit-testing',
    pass: hit === london.button && app.bookmarks.has('london') && hudOk && focused && blueToGreen && (!app.drawable || (london.uploads === uploadsBefore + 1 && !!ev?.changedElements?.includes(london.el))),
    detail: `elementFromPoint(${bx.toFixed(1)},${by.toFixed(1)}) = ${hitName(hit)}; bookmarks [${[...app.bookmarks]}], HUD "${document.getElementById('bookmarks')!.textContent}"; button pixel ${before} -> ${after}; london uploads ${uploadsBefore} -> ${london.uploads}, changedElements [${(ev?.changedElements ?? []).map((e) => (e as HTMLElement).dataset.id)}]; focusable ${focused}`,
  });

  // The link is hit where it is drawn.
  const [lx, ly] = centreOf(london, london.link);
  const linkHit = document.elementFromPoint(lx, ly);
  emit({
    check: 'link-hit', pass: linkHit === london.link && london.link.href === `https://www.wikidata.org/wiki/${london.place.wikidata}`,
    detail: `elementFromPoint(${lx.toFixed(1)},${ly.toFixed(1)}) = ${hitName(linkHit)} href=${london.link.href}`,
  });

  // Turn London behind the horizon: the same screen point, and the button's
  // projected point, must not reach the panel, and a click there changes nothing.
  const BEHIND: Camera = { lon: 179.9, lat: -35, distance: OPEN.distance };
  app.setCamera(BEHIND);
  app.render();
  const f = facing(BEHIND, london.place.lon, london.place.lat);
  const t = cssTransform(clipMatrix(BEHIND, W() / H()), london.model, W(), H());
  const ghost = applyCss(t, ...localCentre(london, london.button));
  const hits = [document.elementFromPoint(bx, by), ...(ghost.every(Number.isFinite) ? [document.elementFromPoint(...ghost)] : [])];
  for (const e of hits) (e as HTMLElement | null)?.click();
  const reached = hits.some((e) => e && london.el.contains(e));
  const behindPixel = mean(bx, by);
  emit({
    check: 'hidden-panel-not-hit',
    pass: f < 0 && !london.visible && !reached && app.bookmarks.has('london') && !(app.drawable && isCard(behindPixel)),
    detail: `facing ${f.toFixed(3)}; elementFromPoint at the old button point = ${hitName(hits[0])}, at the projected hidden button = ${hits[1] ? hitName(hits[1]) : 'n/a'}; clicked them, bookmarks [${[...app.bookmarks]}]; canvas pixel ${behindPixel}`,
  });

  // The slider changes its own panel only: one paint, one upload, new text drawn.
  app.setCamera(OPEN);
  app.render();
  await frame();
  const lagos = byId('lagos');
  const [rx, ry] = centreOf(lagos, lagos.range);
  const rangeHit = document.elementFromPoint(rx, ry);
  // The paint of the frame just awaited comes after its rAF callbacks: let it pass, and note what it repainted.
  const settle: string[] = [];
  const onSettle = (e: Event) => settle.push(`[${((e as Event & { changedElements?: Element[] }).changedElements ?? []).map((x) => (x as HTMLElement).dataset.id)}]`);
  canvas.addEventListener('paint', onSettle);
  await frame(); await frame(); await frame();
  canvas.removeEventListener('paint', onSettle);
  const counts = () => views.map((v) => v.uploads);
  const c0 = counts();
  const popEl = lagos.el.querySelector('.stat b') as HTMLElement;
  const [px0, py0] = centreOf(lagos, popEl);
  app.render();
  const textBefore = mean(px0, py0);
  const sliderMs: number[] = [];
  let changed: string[] = [];
  for (const year of [1950, 1990, 2020, 1960, 2000, 2025, 1955, 1975, 2010, 1950]) {
    const p = app.drawable ? paint() : null;
    const t0 = performance.now();
    (rangeHit as HTMLInputElement).value = String(year);
    rangeHit!.dispatchEvent(new Event('input', { bubbles: true }));
    const e = p ? await p : (await frame(), null);
    sliderMs.push(performance.now() - t0);
    if (year === 1950 && e && !changed.length) changed = (e.changedElements ?? []).map((x) => (x as HTMLElement).dataset.id ?? '?');
  }
  app.render();
  const textAfter = mean(px0, py0);
  const c1 = counts();
  const onlyLagos = views.every((v, i) => c1[i] - c0[i] === (v === lagos && app.drawable ? 10 : 0));
  const textOk = popEl.textContent === formatPeople(valueAt(app.panels, lagos.place.pop, 1950));
  emit({ metric: 'slider_frame_ms', values: sliderMs });
  emit({
    check: 'slider-redraws-its-panel',
    pass: rangeHit === lagos.range && onlyLagos && textOk && (!app.drawable || (changed.join() === 'lagos' && textBefore.join() !== textAfter.join())),
    detail: `paints while settling ${settle.join(' ')}; elementFromPoint = ${hitName(rangeHit)}; uploads ${c0} -> ${c1}; changedElements of the first input [${changed}]; text "${popEl.textContent}"; pixel in the number ${textBefore} -> ${textAfter}`,
  });

  // Zooming in grows the drawn panel: a point just right of London's panel at the opening zoom is inside it after.
  app.setCamera(OPEN);
  app.render();
  // A point inside the top-right corner of London's panel (blank card) as it will be drawn after the zoom.
  const zoomed = { ...OPEN, distance: zoom(OPEN.distance, -500) };
  const edge = applyCss(cssTransform(clipMatrix(zoomed, W() / H()), london.model, W(), H()), 232 - 12, 6);
  const outside = mean(...edge);
  const outsideHit = document.elementFromPoint(...edge);
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true, clientX: edge[0], clientY: edge[1] }));
  app.render();
  const inside = mean(...edge);
  const insideHit = document.elementFromPoint(...edge);
  emit({
    check: 'zoom-scales-panels',
    pass: app.camera().distance < OPEN.distance && !london.el.contains(outsideHit) && london.el.contains(insideHit) && (!app.drawable || (!isCard(outside) && isCard(inside))),
    detail: `distance ${OPEN.distance} -> ${app.camera().distance.toFixed(3)}; point ${edge.map((v) => v.toFixed(0))}: ${hitName(outsideHit)} ${outside} -> ${hitName(insideHit)} ${inside}`,
  });

  // Keyboard focus on a panel behind the horizon turns the globe to it, and its button is then hit where it is drawn.
  app.setCamera(OPEN);
  app.render();
  const tk = byId('tokyo');
  const hiddenBefore = !tk.visible;
  tk.button.focus();
  await frame();
  app.render();
  const [tx, ty] = tk.visible ? centreOf(tk, tk.button) : [NaN, NaN];
  const tkHit = tk.visible ? document.elementFromPoint(tx, ty) : null;
  emit({
    check: 'focus-brings-panel-into-view',
    // In the DOM fallback a hidden panel is visibility:hidden and cannot take the focus at all.
    pass: app.drawable
      ? hiddenBefore && document.activeElement === tk.button && tk.visible && tkHit === tk.button
      : hiddenBefore && document.activeElement !== tk.button && !tk.visible,
    detail: `${app.drawable ? '' : 'fallback, focus must be refused; '}tokyo hidden before ${hiddenBefore}; focused ${document.activeElement === tk.button}; camera ${JSON.stringify(app.camera())}; visible ${tk.visible}; elementFromPoint(${tx.toFixed?.(1)},${ty.toFixed?.(1)}) = ${hitName(tkHit)}`,
  });
  tk.button.blur();

  // Upload cost per panel: texElementSubImage2D + mips, waited for with gl.finish.
  if (app.drawable) {
    const up: number[] = [];
    for (let k = 0; k < 10; k++) for (const v of views) {
      const t0 = performance.now();
      gl.bindTexture(gl.TEXTURE_2D, v.texture!.tex);
      (gl as unknown as { texElementSubImage2D(a: number, b: number, c: number, d: number, e: Element): void }).texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, v.el);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.finish();
      up.push(performance.now() - t0);
    }
    emit({ metric: 'upload_ms', values: up });
    emit({ metric: 'paint_upload_ms', values: app.uploadMs });
  }

  // Moving the camera for 120 real frames (one full turn) uploads nothing: geometry changes are not repaints.
  app.setCamera(OPEN);
  app.render();
  // Let the repaints of the focus and blur above (London's and Tokyo's focus rings) land first.
  for (let i = 0; i < 3; i++) await frame();
  const u0 = app.uploads();
  const intervals: number[] = [];
  const log: string[] = [];
  let frameNo = 0;
  const onPaint = (e: Event) => log.push(`f${frameNo}:paint[${((e as Event & { changedElements?: Element[] }).changedElements ?? []).map((x) => (x as HTMLElement).dataset.id)}]`);
  canvas.addEventListener('paint', onPaint);
  let last = await frame();
  for (let i = 0; i < 120; i++) {
    frameNo = i;
    const vis0 = views.map((v) => v.visible), dom0 = [...canvas.children].map((e) => (e as HTMLElement).dataset.id).join();
    app.setCamera({ lon: OPEN.lon + 3 * i, lat: OPEN.lat - 10 * Math.sin(i / 19), distance: OPEN.distance });
    app.render();
    views.forEach((v, k) => { if (v.visible !== vis0[k]) log.push(`f${i}:${v.place.id}${v.visible ? '+' : '-'}`); });
    const dom1 = [...canvas.children].map((e) => (e as HTMLElement).dataset.id).join();
    if (dom1 !== dom0) log.push(`f${i}:order`);
    const now = await frame();
    intervals.push(now - last);
    last = now;
  }
  canvas.removeEventListener('paint', onPaint);
  emit({ metric: 'frame_interval_ms', values: intervals });
  emit({
    check: 'no-uploads-while-moving', pass: app.uploads() === u0,
    detail: `uploads ${u0} -> ${app.uploads()} over 120 frames of rotation; ${log.join(' ')}`,
  });

  // The camera path, timed: rotate a full turn while zooming in and out.
  app.geometryMs.length = 0;
  await benchFrames(gl, 90, (i) => {
    const u = i / 90;
    app.setCamera({ lon: OPEN.lon + 360 * u, lat: OPEN.lat - 15 * Math.sin(2 * Math.PI * u), distance: 2.4 + 1.2 * (0.5 - 0.5 * Math.cos(2 * Math.PI * u)) });
    app.render();
  });
  emit({ metric: 'geometry_ms', values: app.geometryMs.slice(-90) });

  // Leave the opening view, with Lagos back at 2020, for the screenshot.
  lagos.range.value = '2020';
  lagos.range.dispatchEvent(new Event('input'));
  app.setCamera(OPEN);
  app.render();
  await frame();
  emit({ done: true });
}
