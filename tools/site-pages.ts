// Which index pages the Pages site has: the top page with every card, one
// page per original gallery at examples/<gallery>/, and one page per
// technology at tech/<technology>/, each with only its own cards.

// group: a map library whose gallery is recreated, a directory of examples
// that try out a browser technology (found through the technology links), or
// neither.
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
  { id: 'webgpu', label: 'WebGPU', group: 'experiment' },
  { id: 'opfs', label: 'OPFS', group: 'experiment' },
  { id: 'wasm', label: 'WebAssembly', group: 'experiment' },
  { id: 'legacy', label: '既存の例', group: 'other' },
] as const;
export type GalleryId = typeof galleries[number]['id'];

// The rows of gallery links; the technology row is built from techniques.
export const galleryGroups = [
  { key: 'library', label: 'ライブラリ' },
  { key: 'other', label: 'その他' },
].map((g) => ({ ...g, galleries: galleries.filter(({ group }) => group === g.key) }));

// The numbered examples (examples/01-*) and the baselines have no gallery
// directory of their own; their page is examples/legacy/.
export const galleryOf = (dir: string): GalleryId =>
  galleries.find(({ id }) => dir.startsWith(`examples/${id}/`))?.id ?? 'legacy';

// Technologies, read from architecture_selection.chosen.api (free text) and
// from the experiment directory an example sits in. Listed in display order.
export const techniques = [
  { id: 'canvas-2d', label: 'Canvas 2D', match: /canvas\s*2d/i },
  { id: 'webgl2', label: 'WebGL2', match: /webgl\s*2/i },
  { id: 'webgpu', label: 'WebGPU', match: /webgpu/i },
  { id: 'wasm', label: 'WebAssembly', match: /webassembly|\bwasm\b/i },
  { id: 'opfs', label: 'OPFS', match: /\bopfs\b/i },
  { id: 'web-worker', label: 'Web Worker', match: /\bworker\b/i },
  { id: 'opengl-es', label: 'OpenGL ES', match: /opengl\s*es/i },
] as const;
export type TechniqueId = typeof techniques[number]['id'];

export function techniquesOf({ dir, api }: { dir: string; api?: string }): TechniqueId[] {
  const gallery = galleryOf(dir);
  return techniques.filter(({ id, match }) => (api !== undefined && match.test(api)) || id === gallery).map(({ id }) => id);
}

export interface IndexPage<T> { path: string; gallery: GalleryId | null; technique?: TechniqueId; rows: T[] }

export function indexPages<T extends { dir: string; api?: string }>(rows: T[]): IndexPage<T>[] {
  const pages: IndexPage<T>[] = [{ path: 'index.html', gallery: null, rows }];
  for (const { id } of galleries) {
    const own = rows.filter(({ dir }) => galleryOf(dir) === id);
    if (own.length) pages.push({ path: `examples/${id}/index.html`, gallery: id, rows: own });
  }
  for (const { id } of techniques) {
    const own = rows.filter((r) => techniquesOf(r).includes(id));
    if (own.length) pages.push({ path: `tech/${id}/index.html`, gallery: null, technique: id, rows: own });
  }
  return pages;
}

// Prefix that turns a link written from the site root into one that works
// from the page at path.
export const toRoot = (path: string): string => '../'.repeat(path.split('/').length - 1);
