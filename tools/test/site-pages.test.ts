import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galleryOf, indexPages, toRoot } from '../site-pages.ts';

const rows = [
  { dir: 'examples/maplibre/010-add-a-default-marker' },
  { dir: 'examples/maplibre/012-add-a-geojson-line' },
  { dir: 'examples/deckgl/001-arc-layer' },
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
  assert.deepEqual(pages.map((p) => p.path), ['index.html', 'examples/maplibre/index.html', 'examples/deckgl/index.html', 'examples/legacy/index.html']);
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
