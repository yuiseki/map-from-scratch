const TAG = /<(\/?)(?:bldg|gml):(BuildingInstallation|Building|lod1Solid|lod2MultiSurface|lod2Geometry|Polygon|Triangle|posList)[\s>/]/g;
const CLOSE_POS = '</gml:posList>';
const numbers = (s)=>{
    const parts = s.trim().split(/\s+/), out = new Array(parts.length);
    for(let i = 0; i < parts.length; i++)out[i] = +parts[i];
    return out;
};
export class GmlReader {
    posLists = 0;
    buf = '';
    b = null;
    list = null;
    poly = null;
    inst = false;
    tri = false;
    onBuilding;
    onTriangle;
    constructor(onBuilding, onTriangle){
        this.onBuilding = onBuilding;
        this.onTriangle = onTriangle;
    }
    push(text) {
        const s = this.buf ? this.buf + text : text;
        const keep = s.lastIndexOf('<');
        let rest = keep < 0 ? s.length : keep;
        TAG.lastIndex = 0;
        for(let m; (m = TAG.exec(s)) && m.index < keep;){
            const close = m[1] === '/', name = m[2];
            if (name === 'posList') {
                if (close) continue;
                const end = s.indexOf(CLOSE_POS, TAG.lastIndex);
                if (end < 0) {
                    rest = m.index;
                    break;
                }
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
    end() {
        if (this.buf.trim().length > 0 && this.buf.includes('<gml:posList')) throw new Error('gml: input ended inside a posList');
        this.buf = '';
    }
    tag(close, name, s, at) {
        const b = this.b;
        switch(name){
            case 'Building':
                if (close) {
                    if (b) this.onBuilding?.(b);
                    this.b = null;
                } else {
                    const head = s.slice(at, s.indexOf('>', at));
                    this.b = {
                        id: (' ' + (head.match(/gml:id="([^"]+)"/)?.[1] ?? '')).slice(1),
                        lod1: [],
                        lod2: [],
                        inst: []
                    };
                }
                break;
            case 'BuildingInstallation':
                this.inst = !close;
                break;
            case 'lod1Solid':
                this.list = close || !b ? null : b.lod1;
                break;
            case 'lod2MultiSurface':
                this.list = close || !b ? null : this.inst ? b.inst : b.lod2;
                break;
            case 'lod2Geometry':
                this.list = close || !b ? null : b.inst;
                break;
            case 'Polygon':
                if (close) {
                    if (this.poly && this.list) this.list.push(this.poly);
                    this.poly = null;
                } else if (this.list) this.poly = [];
                break;
            case 'Triangle':
                this.tri = !close;
                break;
        }
    }
}
