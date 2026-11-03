// Bake-time: one centreline per Shinkansen line from the ways of its OSM
// route relation. A relation holds both tracks, station loops, platform
// edges and depot spurs; the tube needs one path from end to end.
//
// The ways' vertices are binned into cells of cellKm. Each cell keeps the
// mean of the vertices in it, so two tracks a few metres apart give one
// centroid between them. Cells are joined along the ways and to their eight
// neighbours (a gap in one track, or two tracks falling in two rows of
// cells, does not split the line). The line is then the longest shortest
// path of the largest connected piece, found by a double Dijkstra sweep
// (exact on a tree, and a ladder of cells is close to one): spurs and
// loops shorter than the main line fall away.
//
// exclude drops cells, e.g. those on an earlier line (the Yamagata
// relation also contains the Tohoku tracks from Tokyo to Fukushima).

const KM_PER_DEG = 111.195; // 6371 km sphere

export interface CentrelineOptions { cellKm: number; exclude?: (lon: number, lat: number) => boolean }

export function pathKm(path: number[][]): number {
  let km = 0;
  for (let i = 1; i < path.length; i++) {
    const c = Math.cos(((path[i][1] + path[i - 1][1]) / 2) * Math.PI / 180);
    km += Math.hypot((path[i][0] - path[i - 1][0]) * c, path[i][1] - path[i - 1][1]) * KM_PER_DEG;
  }
  return km;
}

export function centreline(pieces: number[][][], { cellKm, exclude }: CentrelineOptions): number[][] {
  let latSum = 0, n = 0;
  for (const p of pieces) for (const v of p) { latSum += v[1]; n++; }
  if (!n) return [];
  const kx = KM_PER_DEG * Math.cos((latSum / n) * Math.PI / 180), ky = KM_PER_DEG;

  // cells: key -> index; per cell the sum of x, y and the count
  const index = new Map<string, number>();
  const sx: number[] = [], sy: number[] = [], cnt: number[] = [], gx: number[] = [], gy: number[] = [];
  const adj: Set<number>[] = [];
  const cellOf = (x: number, y: number): number => {
    const ix = Math.floor(x / cellKm), iy = Math.floor(y / cellKm), key = `${ix},${iy}`;
    let c = index.get(key);
    if (c === undefined) {
      c = sx.length;
      index.set(key, c);
      sx.push(0); sy.push(0); cnt.push(0); gx.push(ix); gy.push(iy); adj.push(new Set());
    }
    sx[c] += x; sy[c] += y; cnt[c]++;
    return c;
  };
  for (const piece of pieces) {
    let prev = -1, px = 0, py = 0;
    for (const [lon, lat] of piece) {
      const x = lon * kx, y = lat * ky;
      // densify, so a long straight segment visits every cell it crosses
      const steps = prev < 0 ? 1 : Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / (cellKm / 2)));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const c = prev < 0 ? cellOf(x, y) : cellOf(px + (x - px) * t, py + (y - py) * t);
        if (prev >= 0 && c !== prev) { adj[c].add(prev); adj[prev].add(c); }
        prev = c;
      }
      px = x; py = y;
    }
  }
  const N = sx.length;
  const cx = sx.map((s, i) => s / cnt[i]), cy = sy.map((s, i) => s / cnt[i]);
  // eight-neighbour links
  for (let c = 0; c < N; c++) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const o = index.get(`${gx[c] + dx},${gy[c] + dy}`);
      if (o !== undefined && o !== c) { adj[c].add(o); adj[o].add(c); }
    }
  }
  const alive = new Uint8Array(N).fill(1);
  if (exclude) for (let c = 0; c < N; c++) if (exclude(cx[c] / kx, cy[c] / ky)) alive[c] = 0;

  // largest connected piece
  const comp = new Int32Array(N).fill(-1);
  let best = -1, bestSize = 0;
  for (let c = 0, id = 0; c < N; c++) {
    if (!alive[c] || comp[c] >= 0) continue;
    const stack = [c];
    comp[c] = id;
    let size = 0;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const v of adj[u]) if (alive[v] && comp[v] < 0) { comp[v] = id; stack.push(v); }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  if (best < 0) return [];
  const inPiece = (c: number) => alive[c] === 1 && comp[c] === best;

  const dist = new Float64Array(N), from = new Int32Array(N);
  const dijkstra = (src: number): number => {
    dist.fill(Infinity); from.fill(-1);
    dist[src] = 0;
    const heap: [number, number][] = [[0, src]];
    let far = src;
    while (heap.length) {
      const [d, u] = heapPop(heap);
      if (d > dist[u]) continue;
      if (d > dist[far]) far = u;
      for (const v of adj[u]) {
        if (!inPiece(v)) continue;
        const nd = d + Math.hypot(cx[u] - cx[v], cy[u] - cy[v]);
        if (nd < dist[v]) { dist[v] = nd; from[v] = u; heapPush(heap, [nd, v]); }
      }
    }
    return far;
  };
  let start = 0;
  while (!inPiece(start)) start++;
  const a = dijkstra(start);
  const b = dijkstra(a);
  const path: number[][] = [];
  for (let c = b; c >= 0; c = from[c]) path.push([cx[c] / kx, cy[c] / ky]);
  return path;
}

function heapPush(h: [number, number][], e: [number, number]): void {
  h.push(e);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
function heapPop(h: [number, number][]): [number, number] {
  const top = h[0], last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}
