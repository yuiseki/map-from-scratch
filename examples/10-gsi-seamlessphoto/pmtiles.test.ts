import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { directory, find, openArchive, tileId } from './pmtiles.ts';

function varint(value: number): number[] {
  const out: number[] = [];
  do { const byte = value % 128; value = Math.floor(value / 128); out.push(byte | (value ? 128 : 0)); } while (value);
  return out;
}
function encodedDirectory(): Uint8Array {
  // IDs 1, 3, 7; runs 1, 0, 2; lengths 5, 7, 11; offsets 0, 19, 26.
  return Uint8Array.from([3, ...varint(1), ...varint(2), ...varint(4), 1, 0, 2, 5, 7, 11, 1, 20, 0]);
}

test('PMTiles directory decodes delta IDs, offset shorthand and binary-search lookup', () => {
  const entries = directory(encodedDirectory());
  assert.deepEqual(entries, [
    { id: 1, run: 1, length: 5, offset: 0 },
    { id: 3, run: 0, length: 7, offset: 19 },
    { id: 7, run: 2, length: 11, offset: 26 },
  ]);
  assert.equal(find(entries, 0), null);
  assert.equal(find(entries, 2), entries[0]);
  assert.equal(find(entries, 6), entries[1]);
  assert.equal(find(entries, 8), entries[2]);
  assert.throws(() => directory(Uint8Array.of(1, 0x80)), /途中で終わりました/);
});

test('PMTiles tile ids follow Hilbert order within each zoom', () => {
  assert.deepEqual([
    tileId(1, 0, 0), tileId(1, 0, 1), tileId(1, 1, 1), tileId(1, 1, 0),
  ], [1, 2, 3, 4]);
  assert.equal(new Set(Array.from({ length: 64 }, (_, i) => tileId(3, i % 8, Math.floor(i / 8)))).size, 64);
});

test('archive reader cancels full-file 200 responses and reads a tile with byte ranges', async () => {
  const root = gzipSync(Uint8Array.of(1, 0, 1, 3, 1));
  const archive = new Uint8Array(16384);
  const view = new DataView(archive.buffer);
  archive.set(new TextEncoder().encode('PMTiles'));
  archive[7] = 3;
  view.setBigUint64(8, 127n, true); view.setBigUint64(16, BigInt(root.length), true);
  view.setBigUint64(40, BigInt(127 + root.length), true); view.setBigUint64(56, 200n, true);
  view.setBigUint64(64, 3n, true); archive[97] = 2; archive[98] = 1; archive[99] = 3;
  archive[100] = 0; archive[101] = 3;
  archive.set(root, 127);
  archive.set([9, 8, 7], 200);

  const originalFetch = globalThis.fetch;
  let calls = 0, cancelled = false;
  const urls: string[] = [], ranges: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls++; urls.push(String(input)); ranges.push(new Headers(init?.headers).get('range') ?? '');
    if (calls === 1) return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 });
    const range = ranges.at(-1)!.match(/^bytes=(\d+)-(\d+)$/)!;
    const start = Number(range[1]), end = Number(range[2]);
    return new Response(archive.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${archive.length}` } });
  }) as typeof fetch;
  try {
    const pmtiles = await openArchive();
    assert.deepEqual([...(await pmtiles.tile(0, 0, 0) ?? [])], [9, 8, 7]);
    assert.equal(await pmtiles.tile(0, 1, 0), null);
    assert.equal(cancelled, true);
    assert.deepEqual(ranges, ['bytes=0-16383', 'bytes=0-16383', 'bytes=200-202']);
    assert.ok(urls.every((url) => url === urls[0]));
  } finally { globalThis.fetch = originalFetch; }
});
