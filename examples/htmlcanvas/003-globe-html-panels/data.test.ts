import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePanels, formatPeople, formatPercent, valueAt } from './data.ts';

const sample = {
  years: [1950, 1955, 1960],
  places: [
    {
      id: 'lagos', name: 'Lagos', name_ja: 'ラゴス', country_ja: 'ナイジェリア', iso3: 'NGA',
      lon: 3.389585, lat: 6.445208, wikidata: 'Q8673', pop: [305, 468, 762], urban: [null, null, 15.4],
    },
  ],
};

test('decodes places with one value per year', () => {
  const d = decodePanels(sample);
  assert.equal(d.places.length, 1);
  assert.equal(d.places[0].name_ja, 'ラゴス');
  assert.equal(valueAt(d, d.places[0].pop, 1955), 468);
  assert.equal(valueAt(d, d.places[0].urban, 1950), null);
  assert.equal(valueAt(d, d.places[0].urban, 1960), 15.4);
});

test('a year outside the table has no value', () => {
  const d = decodePanels(sample);
  assert.equal(valueAt(d, d.places[0].pop, 1957), null);
  assert.equal(valueAt(d, d.places[0].pop, 2000), null);
});

test('rejects a place whose series does not match the years', () => {
  const bad = structuredClone(sample);
  bad.places[0].pop = [305, 468];
  assert.throws(() => decodePanels(bad), /pop/);
});

test('rejects coordinates outside the globe and a non-Q Wikidata id', () => {
  const lat = structuredClone(sample);
  lat.places[0].lat = 91;
  assert.throws(() => decodePanels(lat), /lat/);
  const wd = structuredClone(sample);
  wd.places[0].wikidata = 'javascript:alert(1)';
  assert.throws(() => decodePanels(wd), /wikidata/);
});

test('formats thousands of people in man (10^4) with grouping, and missing values as a dash', () => {
  assert.equal(formatPeople(36399), '3,640万人');
  assert.equal(formatPeople(305), '31万人');
  assert.equal(formatPeople(null), '—');
  assert.equal(formatPercent(77.345), '77.3%');
  assert.equal(formatPercent(null), '—');
});
