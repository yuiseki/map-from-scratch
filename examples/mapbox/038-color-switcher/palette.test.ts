import assert from 'node:assert/strict';
import test from 'node:test';
import { PALETTES } from './palette.ts';

test('each palette provides valid ocean, land, coast and highlight colors', () => {
  for (const palette of Object.values(PALETTES)) {
    for (const color of Object.values(palette)) assert.match(color, /^#[0-9a-f]{6}$/i);
  }
});

test('palette choices are visually distinct and include the default blue palette', () => {
  assert.deepEqual(Object.keys(PALETTES).sort(), ['blue', 'dark', 'sunset']);
  assert.equal(PALETTES.blue.ocean, '#aad3df');
  assert.equal(new Set(Object.values(PALETTES).map((palette) => palette.ocean)).size, 3);
});
