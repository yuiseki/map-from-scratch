// The emscripten image (docker/Dockerfile.emscripten) can build C to wasm32
// and run JSPI builds in Node and in the harness's Chromium, offline.
// Runs only in that image: MFS_TOOLCHAIN=emscripten bin/mfs test
// Builds go to the container's own /tmp, which goes away with the container.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchBrowser } from '../runners/browser.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'emscripten');
const skip = process.env.MFS_TOOLCHAIN === 'emscripten' ? false : 'needs the emscripten image: MFS_TOOLCHAIN=emscripten bin/mfs test';

const emcc = (src: string, out: string, flags: string[] = []): void => {
  execFileSync('emcc', ['-O2', ...flags, join(fixtures, src), '-o', out], { stdio: 'pipe' });
};
const node = (file: string) => spawnSync(process.execPath, [file], { encoding: 'utf8' });

test('C builds to wasm32 and runs in Node', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfs-em-'));
  emcc('hello.c', join(dir, 'hello.js'));
  const r = node(join(dir, 'hello.js'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'sum=55\n');
});

test('a JSPI build suspends C on an async JS read, in Node and Chromium', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfs-em-'));
  emcc('jspi.c', join(dir, 'jspi.js'), ['-sJSPI']);
  const r = node(join(dir, 'jspi.js'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'jspi total=32640\n');

  // Without JSPI the same C cannot wait for the promise: the suspension
  // above is JSPI's doing, not a read that happened to be synchronous.
  emcc('jspi.c', join(dir, 'plain.js'));
  assert.doesNotMatch(node(join(dir, 'plain.js')).stdout, /total=32640/);

  writeFileSync(join(dir, 'jspi.html'), `<!doctype html>
<script>
const emit = (o) => window.__mfsEmit(JSON.stringify(o));
var Module = {
  print: (t) => { emit({ info: { stdout: t } }); emit({ done: true }); },
  onAbort: (what) => emit({ error: String(what) }),
};
</script>
<script src="jspi.js"></script>
`);
  const settings = { run: { page: 'jspi.html', viewport: { width: 64, height: 64, deviceScaleFactor: 1, mobile: false }, cpuThrottle: 1 }, timeoutMs: 30000 };
  const raw = await benchBrowser(dir, settings, dir, { iterations: 1 });
  assert.deepEqual(raw.errors, []);
  assert.equal(raw.info.stdout, 'jspi total=32640');
});
