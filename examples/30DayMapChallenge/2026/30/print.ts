export interface Point { x: number; y: number }
export interface Segment { a: Point; b: Point }
export interface ContourLine { level: number; segments: Segment[] }
export interface ContourPath { points: Point[]; closed: boolean }
export interface RegularGrid {
  width: number; height: number; originX: number; originY: number;
  stepX: number; stepY: number; values: number[]; valid: number[];
}
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface PrintFrame {
  xMm: number; yMm: number; widthMm: number; heightMm: number;
  scale: number; centerLatitude: number;
}
export interface PrintSheet {
  title: string; grid: RegularGrid; bounds: Bounds; frame: PrintFrame;
  levels: number[]; intervalM: number; minElevationM: number; maxElevationM: number; attribution: string;
}

export function contourLevels(min: number, max: number, interval: number): number[] {
  if (!(interval > 0) || !Number.isFinite(interval)) throw new RangeError('interval must be positive and finite');
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const first = Math.ceil(min / interval) * interval;
  const out: number[] = [];
  for (let level = first; level < max; level += interval) out.push(Number(level.toFixed(9)));
  return out;
}

const lerp = (a: Point, b: Point, va: number, vb: number, level: number): Point => {
  const t = va === vb ? 0.5 : Math.max(0, Math.min(1, (level - va) / (vb - va)));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};

export function extractContours(grid: RegularGrid, levels: number[]): ContourLine[] {
  const { width, height, values, valid, originX, originY, stepX, stepY } = grid;
  if (width < 2 || height < 2 || values.length !== width * height || valid.length !== values.length) {
    throw new RangeError('grid dimensions and arrays do not match');
  }
  return levels.map(level => {
    const segments: Segment[] = [];
    for (let row = 0; row < height - 1; row++) for (let col = 0; col < width - 1; col++) {
      const indices = [row * width + col, row * width + col + 1,
        (row + 1) * width + col + 1, (row + 1) * width + col];
      if (indices.some(i => !valid[i] || !Number.isFinite(values[i]!))) continue;
      const points = [
        { x: originX + col * stepX, y: originY + row * stepY },
        { x: originX + (col + 1) * stepX, y: originY + row * stepY },
        { x: originX + (col + 1) * stepX, y: originY + (row + 1) * stepY },
        { x: originX + col * stepX, y: originY + (row + 1) * stepY },
      ];
      const vals = indices.map(i => values[i]!);
      // Edge order: top, right, bottom, left. Equality is consistently assigned above.
      const crosses = [0, 1, 2, 3].map(edge => {
        const next = (edge + 1) % 4;
        return (vals[edge]! < level) !== (vals[next]! < level);
      });
      const crossingEdges = crosses.flatMap((crosses, edge) => crosses ? [edge] : []);
      if (crossingEdges.length < 2) continue;
      const edgePoint = (edge: number): Point => lerp(points[edge]!, points[(edge + 1) % 4]!, vals[edge]!, vals[(edge + 1) % 4]!, level);
      if (crossingEdges.length === 2) {
        segments.push({ a: edgePoint(crossingEdges[0]!), b: edgePoint(crossingEdges[1]!) });
      } else if (crossingEdges.length === 4) {
        // Asymptotic decider: the bilinear value at the cell center chooses pairing.
        const centerAbove = (vals[0]! + vals[1]! + vals[2]! + vals[3]!) / 4 >= level;
        const corner0Above = vals[0]! >= level;
        const pairs = centerAbove === corner0Above ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
        for (const [a, b] of pairs) segments.push({ a: edgePoint(a!), b: edgePoint(b!) });
      }
    }
    return { level, segments };
  }).filter(line => line.segments.length > 0);
}

const pointKey = (p: Point): string => `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
export function stitchSegments(segments: Segment[]): ContourPath[] {
  const adjacency = new Map<string, number[]>();
  const keys = segments.map(({ a, b }, i) => {
    for (const key of [pointKey(a), pointKey(b)]) {
      const edges = adjacency.get(key) ?? [];
      edges.push(i); adjacency.set(key, edges);
    }
    return [pointKey(a), pointKey(b)];
  });
  const used = new Set<number>();
  const paths: ContourPath[] = [];
  const trace = (start: string, first: number): ContourPath => {
    const points: Point[] = [];
    let key = start; let edge = first;
    while (!used.has(edge)) {
      used.add(edge);
      const [ka, kb] = keys[edge]!;
      const next = key === ka ? kb! : ka!;
      const segment = segments[edge]!;
      const point = pointKey(segment.a) === key ? segment.a : segment.b;
      if (!points.length || pointKey(points[points.length - 1]!) !== key) points.push(point);
      const nextPoint = pointKey(segment.a) === next ? segment.a : segment.b;
      points.push(nextPoint);
      if (next === start) return { points, closed: true };
      key = next;
      const candidate = (adjacency.get(key) ?? []).find(index => !used.has(index));
      if (candidate === undefined) break;
      edge = candidate;
    }
    return { points, closed: points.length > 2 && pointKey(points[0]!) === pointKey(points.at(-1)!) };
  };
  for (const [key, edges] of adjacency) if (edges.length !== 2) {
    for (const edge of edges) if (!used.has(edge)) paths.push(trace(key, edge));
  }
  for (let i = 0; i < segments.length; i++) if (!used.has(i)) paths.push(trace(keys[i]![0]!, i));
  return paths;
}

export function projectToPage(point: Point, bounds: Bounds, frame: PrintFrame): { xMm: number; yMm: number } {
  const dx = bounds.maxX - bounds.minX; const dy = bounds.maxY - bounds.minY;
  if (!(dx > 0 && dy > 0)) throw new RangeError('bounds must have positive area');
  if (!(frame.scale > 0) || Math.abs(frame.centerLatitude) >= 85) throw new RangeError('invalid print scale or center latitude');
  const localGroundFactor = Math.cos(frame.centerLatitude * Math.PI / 180) * 1000 / frame.scale;
  return {
    xMm: frame.xMm + (point.x - bounds.minX) * localGroundFactor,
    yMm: frame.yMm + (bounds.maxY - point.y) * localGroundFactor,
  };
}

const esc = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fmt = (n: number): string => Number(n.toFixed(3)).toString();
const lonFromX = (x: number): number => x / 6378137 * 180 / Math.PI;
const latFromY = (y: number): number => (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI;

export function renderPrintableSvg(sheet: PrintSheet): string {
  const { frame, bounds, grid } = sheet;
  const lines = extractContours(grid, sheet.levels);
  const clipId = 'map-frame-clip';
  const paths = lines.flatMap(line => stitchSegments(line.segments).map(path => {
    const points = path.points.map(point => projectToPage(point, bounds, frame));
    const d = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${fmt(point.xMm)} ${fmt(point.yMm)}`).join(' ') + (path.closed ? ' Z' : '');
    const index = Math.round(line.level / 500) * 500 === line.level;
    return `<path data-level="${line.level}" d="${d}" fill="none" stroke="${index ? '#57544e' : '#858178'}" stroke-width="${index ? '0.27' : '0.17'}" vector-effect="non-scaling-stroke"/>`;
  })).join('');
  const right = frame.xMm + frame.widthMm + 10;
  const attribution = esc(sheet.attribution);
  const geographicExtent = `${lonFromX(bounds.minX).toFixed(4)}–${lonFromX(bounds.maxX).toFixed(4)}°E · ${latFromY(bounds.minY).toFixed(4)}–${latFromY(bounds.maxY).toFixed(4)}°N`;
  const scaleBar = 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210" role="img" aria-labelledby="title desc">
<title id="title">${esc(sheet.title)}</title><desc id="desc">Generated contour guides from aggregated and interpolated GSI elevation data. Add route and annotations by hand.</desc>
<metadata>${attribution}</metadata><style>text{font-family:serif;fill:#292923}.small{font-size:2.6px}.body{font-size:3.2px}.heading{font-size:5px;font-weight:bold}</style>
<rect width="297" height="210" fill="#fff"/>
<text x="12" y="16" class="heading">${esc(sheet.title)}</text>
<text x="12" y="22" class="body">富士山周辺 · 標高 ${sheet.minElevationM.toFixed(0)}–${sheet.maxElevationM.toFixed(0)} m · 薄線 ${sheet.intervalM} m / 太線 500 m</text>
<text x="12" y="28" class="small">${geographicExtent} · 印刷は 100% / Actual size。薄線は標高ガイド、紙面に手書きのルートを加えてください。</text>
<defs><clipPath id="${clipId}"><rect x="${frame.xMm}" y="${frame.yMm}" width="${frame.widthMm}" height="${frame.heightMm}"/></clipPath></defs>
<rect x="${frame.xMm}" y="${frame.yMm}" width="${frame.widthMm}" height="${frame.heightMm}" fill="#fff" stroke="#555" stroke-width="0.25"/>
<g clip-path="url(#${clipId})">${paths}</g>
<text x="${frame.xMm}" y="${frame.yMm - 2}" class="small">EPSG:3857 · source-cell extent · scale 1:${frame.scale.toLocaleString('en-US')}</text>
<text x="${right}" y="${frame.yMm + 5}" class="heading">手書きエリア</text>
<text x="${right}" y="${frame.yMm + 10}" class="small">ルート・注記を自由に加えてください</text>
<rect x="${right}" y="${frame.yMm + 14}" width="${297 - right - 12}" height="${frame.heightMm - 14}" fill="none" stroke="#aaa" stroke-width="0.2" stroke-dasharray="1 1"/>
<path d="M${right} 54 h7" stroke="#858178" stroke-width="0.17"/><text x="${right + 9}" y="55" class="small">100 m 等高線</text>
<path d="M${right} 60 h7" stroke="#57544e" stroke-width="0.27"/><text x="${right + 9}" y="61" class="small">500 m 等高線</text>
<path d="M${right} 26 l0 -8 m-2 3 l2 -3 l2 3" fill="none" stroke="#292923" stroke-width="0.4"/><text x="${right + 4}" y="22" class="small">N</text>
<rect x="12" y="192" width="${scaleBar}" height="1.2" fill="#292923"/><text x="12" y="190" class="small">2 km ground distance · scale bar ${scaleBar} mm · print at 100%</text>
<text x="12" y="197" class="small">Source: Geospatial Information Authority of Japan (GSI), elevation tiles (Fundamental Geospatial Data elevation model)</text>
<text x="12" y="200" class="small">https://maps.gsi.go.jp/development/ichiran.html</text>
<text x="12" y="203" class="small">Edited and aggregated into 10×10-pixel cells by yuiseki. This is not an official GSI product.</text>
<text x="12" y="206" class="small">DEM10B values are interpolated and aggregated; contours are approximate guides, not a survey or finished hand-drawn map.</text>
</svg>`;
}
