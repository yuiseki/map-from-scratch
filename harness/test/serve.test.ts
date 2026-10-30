import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { serve, parseRange } from '../lib/serve.ts';

test('parseRange: first-last, open end, suffix, and what is refused', () => {
  assert.deepEqual(parseRange('bytes=0-9', 100), [0, 9]);
  assert.deepEqual(parseRange('bytes=90-', 100), [90, 99]);
  assert.deepEqual(parseRange('bytes=-10', 100), [90, 99]);
  assert.deepEqual(parseRange('bytes=95-200', 100), [95, 99], 'clamped to the file');
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1,5-6', 100), null, 'multiple ranges: send the whole file');
  assert.equal(parseRange('items=0-1', 100), null);
});

test('the server answers Range requests with 206 and the right bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-'));
  writeFileSync(join(dir, 'a.bin'), Buffer.from(Array.from({ length: 100 }, (_, i) => i)));
  writeFileSync(join(dir, 'm.ts'), 'const x: number = 1;\nexport default x;\n');
  writeFileSync(join(dir, 'd.wasm'), Buffer.from([0, 97, 115, 109]));
  const server = await serve(dir);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const r = await fetch(`${base}/a.bin`, { headers: { Range: 'bytes=10-14' } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), 'bytes 10-14/100');
    assert.equal(r.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [10, 11, 12, 13, 14]);

    const all = await fetch(`${base}/a.bin`);
    assert.equal(all.status, 200);
    assert.equal((await all.arrayBuffer()).byteLength, 100);

    const bad = await fetch(`${base}/a.bin`, { headers: { Range: 'bytes=200-' } });
    assert.equal(bad.status, 416);
    await bad.arrayBuffer();

    const ts = await fetch(`${base}/m.ts`);
    assert.match(ts.headers.get('content-type') ?? '', /javascript/);
    assert.doesNotMatch(await ts.text(), /: number/, 'types are stripped');

    // WebAssembly.compileStreaming refuses any other type.
    const wasm = await fetch(`${base}/d.wasm`);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    await wasm.arrayBuffer();
  } finally {
    server.close();
  }
});
