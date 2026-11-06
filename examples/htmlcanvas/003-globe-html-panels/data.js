const isNum = (v)=>typeof v === 'number' && Number.isFinite(v);
export function decodePanels(raw) {
    const r = raw;
    if (!Array.isArray(r?.years) || !r.years.every(isNum)) throw new Error('panels: years');
    if (!Array.isArray(r.places)) throw new Error('panels: places');
    const n = r.years.length;
    for (const p of r.places){
        for (const k of [
            'id',
            'name',
            'name_ja',
            'country_ja',
            'iso3'
        ]){
            if (typeof p[k] !== 'string' || !p[k]) throw new Error(`panels: ${p.id}.${k}`);
        }
        if (!isNum(p.lon) || p.lon < -180 || p.lon > 180) throw new Error(`panels: ${p.id}.lon`);
        if (!isNum(p.lat) || p.lat < -90 || p.lat > 90) throw new Error(`panels: ${p.id}.lat`);
        if (typeof p.wikidata !== 'string' || !/^Q\d+$/.test(p.wikidata)) throw new Error(`panels: ${p.id}.wikidata`);
        for (const k of [
            'pop',
            'urban'
        ]){
            const s = p[k];
            if (!Array.isArray(s) || s.length !== n || !s.every((v)=>v === null || isNum(v))) throw new Error(`panels: ${p.id}.${k}`);
        }
    }
    return r;
}
export function valueAt(d, series, year) {
    const i = d.years.indexOf(year);
    return i < 0 ? null : series[i];
}
const group = (n)=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export function formatPeople(thousands) {
    return thousands === null ? '—' : `${group(Math.round(thousands / 10))}万人`;
}
export function formatPercent(v) {
    return v === null ? '—' : `${v.toFixed(1)}%`;
}
