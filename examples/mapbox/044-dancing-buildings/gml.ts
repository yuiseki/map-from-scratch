// A streaming reader for the LOD1 part of PLATEAU CityGML buildings, cut
// down from examples/16-plateau-buildings-3d/gml.ts (same repository, GPL-3):
// only bldg:Building, its gml:name, bldg:measuredHeight and the polygons of
// bldg:lod1Solid are looked at. Text comes in chunks of any size; push()
// keeps the unfinished tail. A polygon is a list of rings, each
// [lat, lon, z, ...] with its closing point, the exterior first.

export type Poly = number[][];
export interface Lod1Building { id: string; name: string | null; measuredHeight: number | null; lod1: Poly[] }

const TAG = /<(\/?)(?:bldg|gml):(Building|lod1Solid|Polygon|posList|measuredHeight|name)[\s>/]/g;

const numbers = (s: string): number[] => {
  const parts = s.trim().split(/\s+/), out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) out[i] = +parts[i];
  return out;
};

export class Lod1Reader {
  private buf = '';
  private b: Lod1Building | null = null;
  private inLod1 = false;
  private poly: Poly | null = null;
  private onBuilding: (b: Lod1Building) => void;
  constructor(onBuilding: (b: Lod1Building) => void) { this.onBuilding = onBuilding; }

  push(text: string): void {
    const s = this.buf ? this.buf + text : text;
    const keep = s.lastIndexOf('<');      // a tag from here on may be incomplete
    let rest = keep < 0 ? s.length : keep;
    TAG.lastIndex = 0;
    for (let m: RegExpExecArray | null; (m = TAG.exec(s)) && m.index < keep;) {
      const close = m[1] === '/', name = m[2];
      if (name === 'posList' || name === 'measuredHeight' || name === 'name') {
        if (close) continue;
        // Text elements: wait until the closing tag has arrived.
        const closeTag = name === 'posList' ? '</gml:posList>' : name === 'name' ? '</gml:name>' : '</bldg:measuredHeight>';
        const end = s.indexOf(closeTag, TAG.lastIndex);
        if (end < 0) { rest = m.index; break; }
        const body = s.slice(s.indexOf('>', m.index) + 1, end);
        const b = this.b;
        if (name === 'posList') { if (this.poly) this.poly.push(numbers(body)); }
        else if (b && name === 'measuredHeight') b.measuredHeight = Math.max(b.measuredHeight ?? -Infinity, +body);
        else if (b && name === 'name' && b.name === null) b.name = (' ' + body.trim()).slice(1);
        TAG.lastIndex = end + closeTag.length;
        continue;
      }
      this.tag(close, name, s, m.index);
    }
    this.buf = s.slice(rest);
  }

  end(): void {
    if (this.buf) this.push('<');
    if (this.buf.includes('<gml:posList')) throw new Error('gml: input ended inside a posList');
    this.buf = '';
  }

  private tag(close: boolean, name: string, s: string, at: number): void {
    switch (name) {
      case 'Building':
        if (close) { if (this.b) this.onBuilding(this.b); this.b = null; } else {
          const head = s.slice(at, s.indexOf('>', at));
          this.b = { id: (' ' + (head.match(/gml:id="([^"]+)"/)?.[1] ?? '')).slice(1), name: null, measuredHeight: null, lod1: [] };
        }
        break;
      case 'lod1Solid': this.inLod1 = !close && this.b !== null; break;
      case 'Polygon':
        if (close) { if (this.poly && this.b) this.b.lod1.push(this.poly); this.poly = null; } else if (this.inLod1) this.poly = [];
        break;
    }
  }
}
