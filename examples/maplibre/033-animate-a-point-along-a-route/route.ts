// examples/maplibre/033-animate-a-point-along-a-route/route.ts
export interface RouteAnimationMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  step(): void;
  reset(): void;
  draw(): void;
  getStep(): number;
  readPixel(x: number, y: number): [number, number, number, number];
  getMarkerScreenPos(): [number, number];
  start(): void;
  stop(): void;
}

export const nextRouteStep = (current: number, maxSteps: number): number => (current + 1) % (maxSteps + 1);

export async function mount(
  canvas: HTMLCanvasElement,
  landUrl: string,
  routeUrl: string,
): Promise<RouteAnimationMap> {
  const ctx = canvas.getContext('2d')!;
  const [landRes, routeRes] = await Promise.all([fetch(landUrl), fetch(routeUrl)]);
  const landPolygons: number[][][] = await landRes.json();
  const routePoints: [number, number][] = await routeRes.json();

  let animFrameId = 0;
  let isRunning = false;
  let currentStep = 0;
  const maxSteps = routePoints.length - 1;

  // View center around North America / United States
  // center: [-96, 37.8] -> Mercator [0.2333, 0.366]
  const centerMx = 0.2333;
  const centerMy = 0.366;
  const zoom = 3.2;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
  }

  function getScreenCoords(mx: number, my: number): [number, number] {
    const scale = Math.pow(2, zoom) * canvas.height;
    const sx = canvas.width / 2 + (mx - centerMx) * scale;
    const sy = canvas.height / 2 + (my - centerMy) * scale;
    return [sx, sy];
  }

  function draw() {
    const w = canvas.width;
    const h = canvas.height;

    // 1. Ocean background (#e0f2fe)
    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(0, 0, w, h);

    // 2. Draw Land Polygons (#f8fafc with #cbd5e1 outline)
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;

    for (const poly of landPolygons) {
      ctx.beginPath();
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i += 2) {
          const [sx, sy] = getScreenCoords(ring[i], ring[i + 1]);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }

    // 3. Draw Route Line (#4882c5, width 4)
    if (routePoints.length > 1) {
      ctx.strokeStyle = '#4882c5';
      ctx.lineWidth = 4 * (window.devicePixelRatio || 1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      for (let i = 0; i < routePoints.length; i++) {
        const [sx, sy] = getScreenCoords(routePoints[i][0], routePoints[i][1]);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // 4. Draw Animated Moving Point (#3887be with white stroke)
    if (routePoints.length > 0) {
      const pt = routePoints[currentStep];
      const [sx, sy] = getScreenCoords(pt[0], pt[1]);
      const r = 9 * (window.devicePixelRatio || 1);

      // Outer glow / shadow
      ctx.fillStyle = '#3887be';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * (window.devicePixelRatio || 1);

      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function step() {
    currentStep = nextRouteStep(currentStep, maxSteps);
    draw();
  }

  function reset() {
    currentStep = 0;
    draw();
  }

  function loop() {
    if (!isRunning) return;
    step();
    animFrameId = requestAnimationFrame(loop);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    animFrameId = requestAnimationFrame(loop);
  }

  function stop() {
    isRunning = false;
    cancelAnimationFrame(animFrameId);
  }

  resize();
  window.addEventListener('resize', () => {
    resize();
    draw();
  });
  draw();

  return {
    canvas,
    ctx,
    step,
    reset,
    draw,
    getStep: () => currentStep,
    readPixel: (x: number, y: number) => {
      const px = ctx.getImageData(x, y, 1, 1).data;
      return [px[0], px[1], px[2], px[3]];
    },
    getMarkerScreenPos: () => {
      const pt = routePoints[currentStep];
      return getScreenCoords(pt[0], pt[1]);
    },
    start,
    stop,
  };
}
