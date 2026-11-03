// Prefecture picker: 47 baked SVG paths drawn with Canvas 2D.
// Parsing is Path2D's, hit testing is isPointInPath's.
// el receives a "prefecture" CustomEvent ({code, name}) on selection.
// prefectures.json as bake.ts writes it: grid size and [code, name, path] rows.
interface Baked { w: number; h: number; p: [string, string, string][] }
export interface Prefecture { code: string; name: string; path: Path2D }
export interface PrefectureDetail { code: string; name: string }
export interface Picker {
  ctx: CanvasRenderingContext2D;
  prefs: Prefecture[];
  pick(x: number, y: number): number;
  draw(): void;
  setHover(i: number): void;
}

export function pickPath(prefs: readonly Pick<Prefecture, 'path'>[], ctx: { isPointInPath(path: Path2D, x: number, y: number): boolean }, x: number, y: number): number {
  for (let i = 0; i < prefs.length; i++) if (ctx.isPointInPath(prefs[i].path, x, y)) return i;
  return -1;
}

export async function mount(el: HTMLElement, url: string): Promise<Picker> {
  const { w, h, p }: Baked = await (await fetch(url)).json();
  const prefs = p.map(([code, name, d]): Prefecture => ({ code, name, path: new Path2D(d) }));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;  // a fresh canvas always gives a 2D context
  canvas.style.display = 'block';
  el.append(canvas);
  let hover = -1, selected = -1, k = 1;

  // Hover and selection redraw all 47: on a 4x throttled phone a full redraw
  // still keeps the frame interval at p95 1.5 ms.
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineWidth = devicePixelRatio / k;
    ctx.strokeStyle = '#fff';
    prefs.forEach(({ path }, i) => {
      ctx.fillStyle = i === selected ? '#c8553d' : i === hover ? '#f2a65a' : '#8fb8a8';
      ctx.fill(path);
      ctx.stroke(path);
    });
  }

  function setHover(i: number) {
    if (i !== hover) { hover = i; draw(); }
  }

  function resize() {
    const cssW = el.clientWidth;
    k = (cssW * devicePixelRatio) / w;
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    canvas.style.width = `${cssW}px`;
    draw();
  }

  // x, y in CSS pixels relative to the canvas. Returns an index or -1.
  function pick(x: number, y: number) {
    const dx = x * devicePixelRatio, dy = y * devicePixelRatio;
    return pickPath(prefs, ctx, dx, dy);
  }

  const at = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return pick(e.clientX - r.left, e.clientY - r.top);
  };
  canvas.addEventListener('pointermove', (e) => {
    const i = at(e);
    canvas.style.cursor = i < 0 ? '' : 'pointer';
    setHover(i);
  });
  canvas.addEventListener('click', (e) => {
    const i = at(e);
    if (i < 0) return;
    selected = i;
    draw();
    el.dispatchEvent(new CustomEvent<PrefectureDetail>('prefecture', { detail: { code: prefs[i].code, name: prefs[i].name } }));
  });
  // A lost 2D context comes back blank and with its transform reset, which
  // the hit test relies on: repaint everything.
  canvas.addEventListener('contextrestored', draw);
  new ResizeObserver(resize).observe(el);
  resize();

  return { ctx, prefs, pick, draw, setHover };
}
