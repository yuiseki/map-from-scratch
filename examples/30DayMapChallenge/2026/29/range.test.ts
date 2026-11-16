import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchExactRange } from './range.ts';

function response(status: number, headers: Record<string, string>, bytes = [1, 2, 3], hooks: { cancelled?: boolean; pulled?: number; keepOpen?: boolean } = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(bytes)); if (!hooks.keepOpen) controller.close(); },
    pull() { hooks.pulled = (hooks.pulled ?? 0) + 1; },
    cancel() { hooks.cancelled = true; },
  });
  return new Response(body, { status, headers });
}

test('accepts only the exact requested 206 byte range', async () => {
  const result = await fetchExactRange('https://example.test/cog.tif', 10, 12, async () =>
    response(206, { 'Content-Range': 'bytes 10-12/100', 'Content-Length': '3' }));
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.equal(result.totalLength, 100);
  assert.equal(result.attempts, 1);
});

test('rejects a missing or inexact Content-Range without retry', async () => {
  let calls = 0;
  await assert.rejects(fetchExactRange('https://example.test/cog.tif', 10, 12, async () => {
    calls++;
    return response(206, { 'Content-Range': 'bytes 9-12/100' }, [1, 2, 3, 4]);
  }), /Content-Range/i);
  assert.equal(calls, 1);
});

test('cancels an unexpected 200 body before exactly one bounded retry', async () => {
  const hooks = { cancelled: false, pulled: 0, keepOpen: true };
  let calls = 0;
  const result = await fetchExactRange('https://example.test/cog.tif', 10, 12, async () => {
    calls++;
    return calls === 1
      ? response(200, { 'Content-Length': '3470279731' }, [9], hooks)
      : response(206, { 'Content-Range': 'bytes 10-12/3470279731', 'Content-Length': '3' });
  });
  assert.equal(calls, 2);
  assert.equal(hooks.cancelled, true);
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.equal(result.attempts, 2);
});

test('cancels a second 200 body and fails without reading it', async () => {
  let calls = 0;
  const hooks = { cancelled: false, pulled: 0 };
  await assert.rejects(fetchExactRange('https://example.test/cog.tif', 10, 12, async () => {
    calls++;
    return response(200, { 'Content-Length': '3470279731' }, [9], hooks);
  }), /after one retry/i);
  assert.equal(calls, 2);
  assert.equal(hooks.cancelled, true);
  assert.equal(hooks.pulled, 0);
});

test('bounds the body to the requested length even when a server lies in Content-Range', async () => {
  const hooks = { cancelled: false, pulled: 0, keepOpen: true };
  await assert.rejects(fetchExactRange('https://example.test/cog.tif', 10, 12, async () =>
    response(206, { 'Content-Range': 'bytes 10-12/100', 'Content-Length': '3' }, [1, 2, 3, 4, 5], hooks)), /body exceeds/i);
  assert.equal(hooks.cancelled, true);
});

test("accepts CORS 206 only with exact Content-Length and a trusted known object length when Content-Range is hidden", async () => {
  const fetcher = async () => {
    const result = response(206, { "Content-Length": "3" });
    Object.defineProperty(result, "type", { value: "cors" });
    return result;
  };
  const result = await fetchExactRange("https://example.test/cog.tif", 10, 12, fetcher, 100);
  assert.equal(result.totalLength, 100);
  assert.equal(result.contentRange, null);
  assert.equal(result.responseType, "cors");
});

test("rejects CORS 206 without exposed Content-Range unless a fixed object length is supplied", async () => {
  const fetcher = async () => {
    const result = response(206, { "Content-Length": "3" });
    Object.defineProperty(result, "type", { value: "cors" });
    return result;
  };
  await assert.rejects(fetchExactRange("https://example.test/cog.tif", 10, 12, fetcher), /Content-Range/i);
});

test("requires exact Content-Length when the browser cannot inspect Content-Range", async () => {
  const fetcher = async () => {
    const result = response(206, {});
    Object.defineProperty(result, "type", { value: "cors" });
    return result;
  };
  await assert.rejects(fetchExactRange("https://example.test/cog.tif", 10, 12, fetcher, 100), /Content-Length/i);
});
