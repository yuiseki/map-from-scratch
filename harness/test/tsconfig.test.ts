import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const webConfig = readFileSync(new URL('../../tsconfig.web.json', import.meta.url), 'utf8');

test('web type checking includes year/day example modules and excludes their Node bake scripts', () => {
  assert.match(webConfig, /"examples\/\*\/\*\/\*\/\*\.ts"/);
  assert.match(webConfig, /"examples\/\*\/\*\/\*\/bake\.ts"/);
});
