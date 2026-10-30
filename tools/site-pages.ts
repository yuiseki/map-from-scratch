// Which index pages the Pages site has: the top page with every card, and
// one page per original gallery at examples/<gallery>/ with only its cards.

export const galleries = [
  { id: 'maplibre', label: 'MapLibre GL JS' },
  { id: 'mapbox', label: 'Mapbox GL JS' },
  { id: 'cesium', label: 'CesiumJS' },
  { id: 'openglobus', label: 'OpenGlobus' },
  { id: 'deckgl', label: 'deck.gl' },
  { id: 'd3', label: 'D3' },
  { id: 'leaflet', label: 'Leaflet' },
  { id: 'tangram', label: 'Tangram' },
  { id: 'forge3d', label: 'forge3d' },
  { id: 'kepler', label: 'kepler.gl' },
  { id: 'luma', label: 'luma.gl' },
  { id: 'webgpu', label: 'WebGPU' },
  { id: 'opfs', label: 'OPFS' },
  { id: 'wasm', label: 'WebAssembly' },
  { id: 'legacy', label: '既存の例' },
] as const;
export type GalleryId = typeof galleries[number]['id'];

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
