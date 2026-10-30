import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteSpecifiers } from '../../tools/specifiers.ts';

test('static, re-export and dynamic imports are rewritten to .js', () => {
  const src = `import { a } from './a.ts';\nexport * from "../b.ts";\nconst c = await import('./c.ts');\nimport './d.ts';`;
  const r = rewriteSpecifiers(src);
  assert.deepEqual(r.specs, ['./a.ts', '../b.ts', './c.ts', './d.ts']);
  assert.match(r.src, /from '\.\/a\.js'/);
  assert.match(r.src, /from "\.\.\/b\.js"/);
  assert.match(r.src, /import\('\.\/c\.js'\)/);
  assert.match(r.src, /import '\.\/d\.js'/);
});

test('a module worker URL is followed and rewritten (opfs 001 shipped without its worker)', () => {
  const src = `const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });`;
  const r = rewriteSpecifiers(src);
  assert.deepEqual(r.specs, ['./worker.ts']);
  assert.match(r.src, /new URL\('\.\/worker\.js', import\.meta\.url\)/);
});

test('data URLs and non-local specifiers are left alone', () => {
  const src = `const w = new URL('./reader.wasm', import.meta.url);\nimport x from 'node:fs';\nconst u = new URL('./a.ts', location.href);`;
  const r = rewriteSpecifiers(src);
  assert.deepEqual(r.specs, []);
  assert.equal(r.src, src);
});
