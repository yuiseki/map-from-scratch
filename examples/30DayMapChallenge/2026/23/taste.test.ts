import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFoodTags,
  deduplicateFoodFeatures,
  projectFoodPoint,
  insideFoodBounds,
  aggregateFoodGrid,
  normalizeCellCount,
  encodeFoodFeatures,
  decodeFoodFeatures,
  hitTestFoodFeature,
  groupFoodFeatures,
  foodDetailLevel,
  type FoodFeature,
} from './taste.ts';

const features: FoodFeature[] = [
  { id: 'node/1', osmId: 1, source: 'point', x: 100, y: 200, category: 'eatery', tags: { amenity: 'restaurant', cuisine: 'japanese;ramen', name: '麺' } },
  { id: 'node/2', osmId: 2, source: 'point', x: 120, y: 210, category: 'drinks', tags: { amenity: 'bar' } },
  { id: 'way/3', osmId: 3, source: 'polygon', x: 320, y: 410, category: 'food-shop', tags: { shop: 'bakery', name: 'パン屋' }, geometry: { type: 'Polygon', coordinates: [[[300, 400], [340, 400], [340, 420], [300, 420], [300, 400]]] } },
];

test('classifies only explicit OSM food place tags and preserves cuisine as a separate fact', () => {
  assert.equal(classifyFoodTags({ amenity: 'restaurant', cuisine: 'japanese;ramen' }), 'eatery');
  assert.equal(classifyFoodTags({ amenity: 'cafe' }), 'cafe');
  assert.equal(classifyFoodTags({ amenity: 'pub' }), 'drinks');
  assert.equal(classifyFoodTags({ shop: 'bakery' }), 'food-shop');
  assert.equal(classifyFoodTags({ shop: 'greengrocer' }), 'food-shop');
  assert.equal(classifyFoodTags({ shop: 'convenience' }), 'food-shop');
  assert.equal(classifyFoodTags({ shop: 'clothes' }), null);
  assert.equal(classifyFoodTags({ amenity: 'school' }), null);
  assert.equal(classifyFoodTags({}), null);
});

test('groups food features by their existing display category without losing source records', () => {
  const groups = groupFoodFeatures(features);
  assert.deepEqual(groups.eatery.map((feature) => feature.id), ['node/1']);
  assert.deepEqual(groups.drinks.map((feature) => feature.id), ['node/2']);
  assert.deepEqual(groups['food-shop'].map((feature) => feature.id), ['way/3']);
  assert.equal(groups.cafe.length, 0);
  assert.equal(Object.values(groups).flat().length, features.length);
});

test('uses aggregate cells at overview scale and source points and polygons after zooming in', () => {
  assert.equal(foodDetailLevel(0.05), 'grid');
  assert.equal(foodDetailLevel(0.15), 'points');
  assert.equal(foodDetailLevel(0.25), 'geometry');
});

test('deduplicates identical source table/object keys but keeps different OSM types', () => {
  const duplicates = [features[0]!, { ...features[0]!, tags: { amenity: 'restaurant' } }, { ...features[0]!, id: 'way/1', source: 'polygon' as const }];
  const result = deduplicateFoodFeatures(duplicates);
  assert.deepEqual(result.map((feature) => feature.id), ['node/1', 'way/1']);
});

test('projects EPSG:3857 food coordinates and rejects features outside the selected extent', () => {
  const view = { x: 10, y: 20, scale: 2, width: 300, height: 200 };
  assert.deepEqual(projectFoodPoint(100, 200, view), { x: 330, y: -260 });
  const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 300 };
  assert.equal(insideFoodBounds(100, 200, bounds), true);
  assert.equal(insideFoodBounds(201, 200, bounds), false);
});

test('aggregates exact source features into category counts and has stable logarithmic normalization', () => {
  const cells = aggregateFoodGrid(features, 100);
  assert.equal(cells.length, 2);
  const first = cells.find((cell) => cell.x === 1 && cell.y === 2)!;
  assert.equal(first.count, 2);
  assert.equal(first.categories.eatery, 1);
  assert.equal(first.categories.drinks, 1);
  assert.equal(normalizeCellCount(0, 10), 0);
  assert.equal(normalizeCellCount(10, 10), 1);
  assert.ok(normalizeCellCount(2, 10) > 0 && normalizeCellCount(2, 10) < 1);
});

test('encodes and decodes feature geometry, original tags, ids and category', () => {
  const decoded = decodeFoodFeatures(JSON.parse(encodeFoodFeatures(features)));
  assert.deepEqual(decoded, features);
  assert.throws(() => decodeFoodFeatures([{ ...features[0], x: Number.NaN }]), /coordinate/i);
});

test('hit testing chooses the closest feature in screen space and respects the radius', () => {
  const near = [{ feature: features[0]!, screenX: 12, screenY: 14 }, { feature: features[1]!, screenX: 15, screenY: 14 }];
  assert.equal(hitTestFoodFeature(13, 14, near, 4)?.feature.id, 'node/1');
  assert.equal(hitTestFoodFeature(40, 40, near, 4), null);
});
