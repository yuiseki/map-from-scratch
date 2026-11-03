// Bake side: a streaming reader of PLATEAU CityGML that keeps only each
// building's (or building part's) LOD1 solid, as a footprint and a height.
// Text arrives in chunks cut anywhere; push() keeps the unfinished tail.
// Everything else (appearance, attributes, LOD0/LOD2 geometry, most of the
// file's bytes) is skipped by one regular expression. Adapted from the
// reader of example 16 (examples/16-plateau-buildings-3d/gml.ts), cut down
// to LOD1 and extended to BuildingPart and interior rings.
//
// The footprint is the solid's bottom face: the polygon whose every vertex
// lies at the solid's lowest z. Height = highest z - lowest z.
export interface Solid { id: string; rings: [number, number][][]; height: number; base: number }

const TAG = /<(\/?)(?:bldg|gml):(BuildingPart|Building|lod1Solid|Polygon|posList)[\s>/]/g;
const CLOSE_POS = '</gml:posList>';

interface Open { id: string; polys: number[][][] }

export class Lod1Reader {
  private buf = '';
  private stack: Open[] = [];
  private inSolid = false;
  private poly: number[][] | null = null;
  private emit: (s: Solid) => void;
  constructor(emit: (s: Solid) => void) { this.emit = emit; }

  push(text: string): void {
    const s = this.buf ? this.buf + text : text;
    const keep = s.lastIndexOf('<');
    let rest = keep < 0 ? s.length : keep;
    TAG.lastIndex = 0;
    for (let m: RegExpExecArray | null; (m = TAG.exec(s)) && m.index < keep;) {
      const close = m[1] === '/', name = m[2];
      if (name === 'posList') {
        if (close) continue;
        const end = s.indexOf(CLOSE_POS, TAG.lastIndex);
        if (end < 0) { rest = m.index; break; }
        if (this.poly) {
          const parts = s.slice(s.indexOf('>', m.index) + 1, end).trim().split(/\s+/);
          const v = new Array<number>(parts.length);
          for (let i = 0; i < parts.length; i++) v[i] = +parts[i];
          this.poly.push(v);
        }
        TAG.lastIndex = end + CLOSE_POS.length;
        continue;
      }
      this.tag(close, name, s, m.index);
    }
    this.buf = s.slice(rest);
  }

  end(): void {
    if (this.buf) this.push('<');
    this.buf = '';
  }

  private tag(close: boolean, name: string, s: string, at: number): void {
    const top = this.stack[this.stack.length - 1];
    switch (name) {
      case 'Building': case 'BuildingPart':
        if (close) { const o = this.stack.pop(); if (o) this.finish(o); } else {
          const head = s.slice(at, s.indexOf('>', at));
          this.stack.push({ id: (' ' + (head.match(/gml:id="([^"]+)"/)?.[1] ?? '')).slice(1), polys: [] });
        }
        break;
      case 'lod1Solid': this.inSolid = !close && !!top; break;
      case 'Polygon':
        if (close) { if (this.poly && top) top.polys.push(this.poly); this.poly = null; } else if (this.inSolid) this.poly = [];
        break;
    }
  }

  private finish(o: Open): void {
    if (!o.polys.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const p of o.polys) for (const r of p) for (let i = 2; i < r.length; i += 3) { lo = Math.min(lo, r[i]); hi = Math.max(hi, r[i]); }
    const flat = (p: number[][]) => p.every((r) => { for (let i = 2; i < r.length; i += 3) if (Math.abs(r[i] - lo) > 1e-6) return false; return true; });
    const bottom = o.polys.find(flat);
    if (!bottom) return;
    const rings = bottom.map((r) => {
      const pts: [number, number][] = [];
      for (let i = 0; i + 2 < r.length; i += 3) pts.push([r[i], r[i + 1]]);
      const a = pts[0], b = pts[pts.length - 1];
      if (pts.length > 1 && a[0] === b[0] && a[1] === b[1]) pts.pop();
      return pts;
    }).filter((r) => r.length >= 3);
    if (rings.length) this.emit({ id: o.id, rings, height: hi - lo, base: lo });
  }
}
