// Which index pages the Pages site has: the top page with every card, and
// one page per original gallery at examples/<gallery>/ with only its cards.

// group: a map library whose gallery is recreated, a browser technology the
// examples try out, or neither.
export const galleries = [
  { id: 'maplibre', label: 'MapLibre GL JS', group: 'library' },
  { id: 'mapbox', label: 'Mapbox GL JS', group: 'library' },
  { id: 'cesium', label: 'CesiumJS', group: 'library' },
  { id: 'openglobus', label: 'OpenGlobus', group: 'library' },
  { id: 'deckgl', label: 'deck.gl', group: 'library' },
  { id: 'd3', label: 'D3', group: 'library' },
  { id: 'leaflet', label: 'Leaflet', group: 'library' },
  { id: 'tangram', label: 'Tangram', group: 'library' },
  { id: 'forge3d', label: 'forge3d', group: 'library' },
  { id: 'kepler', label: 'kepler.gl', group: 'library' },
  { id: 'luma', label: 'luma.gl', group: 'library' },
  { id: 'webgpu', label: 'WebGPU', group: 'technology' },
  { id: 'opfs', label: 'OPFS', group: 'technology' },
  { id: 'wasm', label: 'WebAssembly', group: 'technology' },
  { id: 'legacy', label: '既存の例', group: 'other' },
] as const;
export type GalleryId = typeof galleries[number]['id'];

export const galleryGroups = [
  { key: 'library', label: 'ライブラリ' },
  { key: 'technology', label: '技術' },
  { key: 'other', label: 'その他' },
].map((g) => ({ ...g, galleries: galleries.filter(({ group }) => group === g.key) }));

// The numbered examples (examples/01-*) and the baselines have no gallery
// directory of their own; their page is examples/legacy/.
export const galleryOf = (dir: string): GalleryId =>
  galleries.find(({ id }) => dir.startsWith(`examples/${id}/`))?.id ?? 'legacy';

export interface IndexPage<T> { path: string; gallery: GalleryId | null; rows: T[] }

export function indexPages<T extends { dir: string }>(rows: T[]): IndexPage<T>[] {
  const pages: IndexPage<T>[] = [{ path: 'index.html', gallery: null, rows }];
  for (const { id } of galleries) {
    const own = rows.filter(({ dir }) => galleryOf(dir) === id);
    if (own.length) pages.push({ path: `examples/${id}/index.html`, gallery: id, rows: own });
  }
  return pages;
}

// Prefix that turns a link written from the site root into one that works
// from the page at path.
export const toRoot = (path: string): string => '../'.repeat(path.split('/').length - 1);
