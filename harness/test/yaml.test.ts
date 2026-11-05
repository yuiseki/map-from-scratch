import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../lib/yaml.ts';

test('scalars: strings, numbers, booleans, null', () => {
  assert.deepEqual(parseYaml('a: hello\nb: 12\nc: 1.5\nd: -3\ne: true\nf: false\ng: null\nh: ~\ni:\n'), {
    a: 'hello', b: 12, c: 1.5, d: -3, e: true, f: false, g: null, h: null, i: null,
  });
});

test('quoted strings keep colons, hashes and leading zeros', () => {
  assert.deepEqual(parseYaml('a: "x: y # z"\nb: \'it\'\'s\'\nc: "0123"\nd: "a\\nb"'), {
    a: 'x: y # z', b: "it's", c: '0123', d: 'a\nb',
  });
});

test('a plain scalar cannot start with a reserved YAML indicator', () => {
  for (const indicator of ['&', '*', '!', '|', '>', '@', '%', '`']) {
    assert.throws(() => parseYaml(`value: ${indicator}plain`), /reserved YAML indicator/);
    assert.deepEqual(parseYaml(`value: "${indicator}plain"`), { value: `${indicator}plain` });
  }
});

test('comments and blank lines are ignored; # inside plain text after a space starts a comment', () => {
  assert.deepEqual(parseYaml('# top\n\na: 1  # one\nb: c#d\n'), { a: 1, b: 'c#d' });
});

test('nested mappings', () => {
  assert.deepEqual(parseYaml('run:\n  page: x.html\n  viewport:\n    width: 390\n    mobile: true\n'), {
    run: { page: 'x.html', viewport: { width: 390, mobile: true } },
  });
});

test('sequences of scalars and of mappings', () => {
  const y = `
list:
  - a
  - 2
items:
  - id: R1
    need: light
  - id: R2
    budgets: [x, y]
`;
  assert.deepEqual(parseYaml(y), {
    list: ['a', 2],
    items: [{ id: 'R1', need: 'light' }, { id: 'R2', budgets: ['x', 'y'] }],
  });
});

test('a sequence directly under a key at the same indent', () => {
  assert.deepEqual(parseYaml('a:\n- 1\n- 2\nb: 3'), { a: [1, 2], b: 3 });
});

test('flow sequences and mappings, nested', () => {
  assert.deepEqual(parseYaml('a: [node, "x, y", 3]\nb: {stat: p95, max: 8.3}\nc: [{a: 1}, [2, 3]]\nd: []\ne: {}'), {
    a: ['node', 'x, y', 3], b: { stat: 'p95', max: 8.3 }, c: [{ a: 1 }, [2, 3]], d: [], e: {},
  });
});

test('folded and literal block scalars', () => {
  const y = 'f: >-\n  one\n  two\n\n  three\nl: |\n  line 1\n    indented\n  line 3\nafter: x\n';
  assert.deepEqual(parseYaml(y), { f: 'one two\nthree', l: 'line 1\n  indented\nline 3\n', after: 'x' });
});

test('Japanese text and URLs stay as they are', () => {
  assert.deepEqual(parseYaml('need: ページが重くならない\nurl: https://example.com/a:b'), {
    need: 'ページが重くならない', url: 'https://example.com/a:b',
  });
});

test('a sequence item that is a nested sequence', () => {
  assert.deepEqual(parseYaml('a:\n  - - 1\n    - 2\n  - [3]'), { a: [[1, 2], [3]] });
});

test('bad indentation is an error with a line number', () => {
  assert.throws(() => parseYaml('a:\n  b: 1\n c: 2'), /line 3/);
});

test('a tab in indentation is an error', () => {
  assert.throws(() => parseYaml('a:\n\tb: 1'), /tab/);
});
