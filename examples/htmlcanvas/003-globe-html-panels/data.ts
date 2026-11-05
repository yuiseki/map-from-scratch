// panels.json, written by bake.ts: the places the panels stand on, with one
// value per year of the slider.

export interface Place {
  id: string;
  name: string;
  name_ja: string;
  country_ja: string;
  iso3: string;
  lon: number;
  lat: number;
  wikidata: string;
  /** Urban agglomeration population in thousands (UN WUP, as carried by Natural Earth). */
  pop: (number | null)[];
  /** Urban population, % of the country's total (World Bank WDI SP.URB.TOTL.IN.ZS). */
  urban: (number | null)[];
}

export interface Panels { years: number[]; places: Place[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function decodePanels(raw: unknown): Panels {
  const r = raw as Panels;
  if (!Array.isArray(r?.years) || !r.years.every(isNum)) throw new Error('panels: years');
  if (!Array.isArray(r.places)) throw new Error('panels: places');
  const n = r.years.length;
  for (const p of r.places) {
    for (const k of ['id', 'name', 'name_ja', 'country_ja', 'iso3'] as const) {
      if (typeof p[k] !== 'string' || !p[k]) throw new Error(`panels: ${p.id}.${k}`);
    }
    if (!isNum(p.lon) || p.lon < -180 || p.lon > 180) throw new Error(`panels: ${p.id}.lon`);
    if (!isNum(p.lat) || p.lat < -90 || p.lat > 90) throw new Error(`panels: ${p.id}.lat`);
    if (typeof p.wikidata !== 'string' || !/^Q\d+$/.test(p.wikidata)) throw new Error(`panels: ${p.id}.wikidata`);
    for (const k of ['pop', 'urban'] as const) {
      const s = p[k];
      if (!Array.isArray(s) || s.length !== n || !s.every((v) => v === null || isNum(v))) throw new Error(`panels: ${p.id}.${k}`);
    }
  }
  return r;
}

export function valueAt(d: Panels, series: (number | null)[], year: number): number | null {
  const i = d.years.indexOf(year);
  return i < 0 ? null : series[i];
}

// Grouping by regular expression: the first toLocaleString call initialises
// ICU and cost 34 ms in example 07.
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Thousands of people as 万人 (10^4), rounded. */
export function formatPeople(thousands: number | null): string {
  return thousands === null ? '—' : `${group(Math.round(thousands / 10))}万人`;
}

export function formatPercent(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}
