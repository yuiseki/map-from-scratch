// A streaming reader for PLATEAU CityGML buildings and DEM TINs. Text comes
// in chunks of any size (a tag or a posList may be cut anywhere); push()
// keeps the unfinished tail. Only the elements below are looked at, so the
// appearance and attribute parts of the file (most of its bytes) are skipped
// by one regular expression.
//
// A building's geometry goes to one of three lists:
//   lod1   bldg:lod1Solid polygons                         (centroid; fallback when there is no LOD2)
//   lod2   bldg:boundedBy/*/bldg:lod2MultiSurface polygons  (Roof, Wall, Ground, OuterCeiling, OuterFloor)
//   inst   bldg:BuildingInstallation lod2 polygons          (the additive detail level)
// lod0 and lod3 (6 buildings near the station) are not read.
// A polygon is a list of rings, each [lat, lon, z, ...] with its closing
// point; the first ring is the exterior (GML writes it first).

export type Poly = number[][];
export interface Building { id: string; lod1: Poly[]; lod2: Poly[]; inst: Poly[] }

const TAG = /<(\/?)(?:bldg|gml):(BuildingInstallation|Building|lod1Solid|lod2MultiSurface|lod2Geometry|Polygon|Triangle|posList)[\s>/]/g;
const CLOSE_POS = '</gml:posList>';

const numbers = (s: string): number[] => {
  const parts = s.trim().split(/\s+/), out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) out[i] = +parts[i];
  return out;
};

export class GmlReader {
  posLists = 0;            // every posList seen (the bake compares it with DuckDB's line count)
  private buf = '';
  private b: Building | null = null;
  private list: Poly[] | null = null;     // where the current section's polygons go
  private poly: Poly | null = null;
  private inst = false;
  private tri = false;
  private onBuilding?: (b: Building) => void;
  private onTriangle?: (p: number[]) => void;
  constructor(onBuilding?: (b: Building) => void, onTriangle?: (p: number[]) => void) {
    this.onBuilding = onBuilding;
    this.onTriangle = onTriangle;
  }

  push(text: string): void {
    const s = this.buf ? this.buf + text : text;
    const keep = s.lastIndexOf('<');      // a tag from here on may be incomplete
    let rest = keep < 0 ? s.length : keep;
    TAG.lastIndex = 0;
    for (let m: RegExpExecArray | null; (m = TAG.exec(s)) && m.index < keep;) {
      const close = m[1] === '/', name = m[2];
      if (name === 'posList') {
        if (close) continue;
        const end = s.indexOf(CLOSE_POS, TAG.lastIndex);
        if (end < 0) { rest = m.index; break; }
        this.posLists++;
        const body = s.slice(s.indexOf('>', m.index) + 1, end);
        if (this.poly) this.poly.push(numbers(body));
        else if (this.tri) this.onTriangle?.(numbers(body));
        TAG.lastIndex = end + CLOSE_POS.length;
        continue;
      }
      this.tag(close, name, s, m.index);
    }
    this.buf = s.slice(rest);
  }

  end(): void {
    // push() holds back everything from the last '<'. A '<' that starts no
    // tag lets it read the tags held back (the input may end on one, as in
    // </bldg:Building>); what is left then is an unfinished posList or text.
    if (this.buf) this.push('<');
    if (this.buf.includes('<gml:posList')) throw new Error('gml: input ended inside a posList');
    this.buf = '';
  }

  private tag(close: boolean, name: string, s: string, at: number): void {
    const b = this.b;
    switch (name) {
      case 'Building':
        if (close) { if (b) this.onBuilding?.(b); this.b = null; } else {
          const head = s.slice(at, s.indexOf('>', at));
          // Copied (' ' + id).slice(1): a plain slice would keep the whole
          // text chunk it came from alive for as long as the building lives.
          this.b = { id: (' ' + (head.match(/gml:id="([^"]+)"/)?.[1] ?? '')).slice(1), lod1: [], lod2: [], inst: [] };
        }
        break;
      case 'BuildingInstallation': this.inst = !close; break;
      case 'lod1Solid': this.list = close || !b ? null : b.lod1; break;
      case 'lod2MultiSurface': this.list = close || !b ? null : this.inst ? b.inst : b.lod2; break;
      case 'lod2Geometry': this.list = close || !b ? null : b.inst; break;
      case 'Polygon':
        if (close) { if (this.poly && this.list) this.list.push(this.poly); this.poly = null; } else if (this.list) this.poly = [];
        break;
      case 'Triangle': this.tri = !close; break;
    }
  }
}
