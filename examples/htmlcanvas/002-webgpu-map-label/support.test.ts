import assert from 'node:assert/strict';
import test from 'node:test';
import { hitTestCacheBuster, supportsHtmlInCanvas } from './support.ts';

// A stand-in for HTMLCanvasElement: a browser that knows the attribute
// reflects it as the content property; one that does not leaves it unset.
const canvas = (reflects: boolean) => {
  const attrs = new Map<string, string>();
  return {
    setAttribute(name: string, value: string) { attrs.set(name, value); },
    getAttribute(name: string) { return attrs.get(name) ?? null; },
    get content() { return reflects ? attrs.get('content') ?? '' : undefined; },
  };
};

test('HTML-in-Canvas is detected by the content property reflecting "drawable"', () => {
  assert.equal(supportsHtmlInCanvas(canvas(true)), true);
  assert.equal(supportsHtmlInCanvas(canvas(false)), false);
});

test('detection sets the attribute itself, so markup without it is detected too', () => {
  const c = canvas(true);
  assert.equal(supportsHtmlInCanvas(c), true);
  assert.equal(c.getAttribute('content'), 'drawable');
});

test('each geometry change writes a new value to an element outside the document', () => {
  const writes: string[] = [];
  const stamp = { dataset: {} as Record<string, string> };
  const bump = hitTestCacheBuster(() => stamp);
  bump(); writes.push(stamp.dataset.v);
  bump(); writes.push(stamp.dataset.v);
  assert.equal(writes.length, 2);
  assert.notEqual(writes[0], writes[1]);
});
