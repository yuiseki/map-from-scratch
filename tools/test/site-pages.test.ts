import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galleryOf, indexPages, toRoot, techniquesOf } from '../site-pages.ts';

const rows = [
  { dir: 'examples/maplibre/010-add-a-default-marker', api: 'Canvas 2D' },
  { dir: 'examples/maplibre/012-add-a-geojson-line', api: 'Canvas 2D' },
  { dir: 'examples/deckgl/001-arc-layer', api: 'WebGL2 instanced line quads' },
  { dir: 'examples/01-prefecture-picker' },
  { dir: 'baselines/01-prefecture-picker-maplibre' },
];

test('an example belongs to the gallery of its directory, others to legacy', () => {
  assert.equal(galleryOf('examples/maplibre/010-add-a-default-marker'), 'maplibre');
  assert.equal(galleryOf('examples/01-prefecture-picker'), 'legacy');
  assert.equal(galleryOf('baselines/01-prefecture-picker-maplibre'), 'legacy');
});

test('the top page has every card, each gallery a page with only its own', () => {
  const pages = indexPages(rows);
  assert.deepEqual(pages.map((p) => p.path), ['index.html', 'examples/maplibre/index.html', 'examples/deckgl/index.html', 'examples/legacy/index.html', 'tech/canvas-2d/index.html', 'tech/webgl2/index.html']);
  assert.equal(pages[0].gallery, null);
  assert.equal(pages[0].rows.length, 5);
  assert.deepEqual(pages[1].rows.map((r) => r.dir), ['examples/maplibre/010-add-a-default-marker', 'examples/maplibre/012-add-a-geojson-line']);
  assert.equal(pages[1].gallery, 'maplibre');
  assert.equal(pages[3].rows.length, 2);
});

test('a gallery with no cards gets no page', () => {
  assert.ok(!indexPages(rows).some((p) => p.gallery === 'cesium'));
});

test('links written from the site root are reached from any page', () => {
  assert.equal(toRoot('index.html'), '');
  assert.equal(toRoot('examples/maplibre/index.html'), '../../');
});

test('every gallery directory under examples/ is a known gallery', async () => {
  const { readdirSync, existsSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const examples = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples');
  const galleryDirs = readdirSync(examples).filter((d) => !existsSync(join(examples, d, 'spec.yaml')) && !/^\d/.test(d));
  for (const d of galleryDirs) assert.notEqual(galleryOf(`examples/${d}/001-x`), 'legacy', `examples/${d}/ is missing from galleries`);
});

test('no gallery is listed twice', async () => {
  const { galleries } = await import('../site-pages.ts');
  const ids = galleries.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the gallery links are the libraries and the rest; technologies come from the API', async () => {
  const { galleryGroups } = await import('../site-pages.ts');
  const ids = (key: string) => galleryGroups.find((g) => g.key === key)!.galleries.map(({ id }) => id);
  assert.deepEqual(galleryGroups.map((g) => g.key), ['library', 'other']);
  assert.ok(ids('library').includes('maplibre') && ids('library').includes('luma'));
  assert.deepEqual(ids('other'), ['legacy']);
});

test('technologies are read from chosen.api and the experiment directory', () => {
  assert.deepEqual(techniquesOf({ dir: 'examples/maplibre/010-x', api: 'Canvas 2D' }), ['canvas-2d']);
  assert.deepEqual(techniquesOf({ dir: 'examples/x', api: 'WebGL2 point sprites and Canvas2D land and labels' }), ['canvas-2d', 'webgl2']);
  assert.deepEqual(techniquesOf({ dir: 'examples/opfs/001-x', api: 'Canvas 2D + OPFS + Dedicated Worker' }), ['canvas-2d', 'opfs', 'web-worker']);
  assert.deepEqual(techniquesOf({ dir: 'examples/wasm/001-x', api: 'WebAssembly + JSPI + Canvas 2D' }), ['canvas-2d', 'wasm']);
  assert.deepEqual(techniquesOf({ dir: 'examples/webgpu/001-x', api: 'WebGPU' }), ['webgpu']);
  assert.deepEqual(techniquesOf({ dir: 'examples/05-x', api: 'EGL + OpenGL ES 3.0' }), ['opengl-es']);
  assert.deepEqual(techniquesOf({ dir: 'examples/x', api: undefined }), []);
});

test('every browser example is drawn with a technology the site knows', async () => {
  const { readdirSync, existsSync } = await import('node:fs');
  const { join, dirname, relative } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { loadSpec } = await import('../../harness/lib/spec.ts');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const DRAWING = ['canvas-2d', 'webgl2', 'webgpu'];
  for (const base of ['examples', 'baselines']) {
    for (const name of readdirSync(join(root, base))) {
      const parent = join(root, base, name);
      const dirs = existsSync(join(parent, 'spec.yaml')) ? [parent]
        : readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(parent, d.name)).filter((d) => existsSync(join(d, 'spec.yaml')));
      for (const dir of dirs) {
        const spec = loadSpec(dir);
        if (spec.runtime !== 'browser' || spec.baseline) continue;
        const tags = techniquesOf({ dir: relative(root, dir), api: spec.definition!.architecture_selection.chosen.api });
        assert.ok(tags.some((t) => DRAWING.includes(t)), `${spec.id}: no drawing API in "${spec.definition!.architecture_selection.chosen.api}"`);
      }
    }
  }
});
