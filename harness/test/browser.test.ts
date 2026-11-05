// The harness's browser is the one examples are written for: stable Chrome,
// with no Blink feature switched on by a flag. HTML-in-Canvas shipped in
// Chrome 157, so an older browser, or a flag that hides its absence, would
// let an example pass here and fail for everyone who opens the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { benchBrowser, browserFlags } from '../runners/browser.ts';

// CI runs the unit tests in plain node:24-trixie-slim, which has no browser.
const skip = process.env.CHROME_BIN ? false : 'needs the browser of docker/base/Dockerfile (CHROME_BIN)';

test('no Blink feature is enabled by flag, on GPU or SwiftShader', () => {
  for (const gpu of [true, false]) {
    const flags = browserFlags(gpu);
    assert.ok(flags.length > 0);
    assert.deepEqual(flags.filter((f) => f.startsWith('--enable-blink-features')), [], flags.join(' '));
  }
});

test('the browser is Chrome 157 or later and has HTML-in-Canvas without a flag', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfs-browser-'));
  writeFileSync(join(dir, 'probe.html'), `<!doctype html>
<canvas id="c" content="drawable"><div drawable>x</div></canvas>
<script>
const brand = navigator.userAgentData.brands.find((b) => /Chrom/.test(b.brand) && b.brand !== 'Not.A/Brand');
const c = document.getElementById('c');
window.__mfsEmit(JSON.stringify({ info: {
  major: Number(brand ? brand.version : 0),
  content: c.content,
  drawElementImage: typeof CanvasRenderingContext2D.prototype.drawElementImage,
  texElementSubImage2D: typeof WebGL2RenderingContext.prototype.texElementSubImage2D,
  updateElementGeometry: typeof c.updateElementGeometry,
} }));
window.__mfsEmit(JSON.stringify({ done: true }));
</script>
`);
  const settings = { run: { page: 'probe.html', viewport: { width: 64, height: 64, deviceScaleFactor: 1, mobile: false }, cpuThrottle: 1 }, timeoutMs: 30000 };
  const raw = await benchBrowser(dir, settings, dir, { iterations: 1 });
  assert.deepEqual(raw.errors, []);
  assert.ok((raw.info.major as number) >= 157, `Chrome ${raw.info.major}`);
  assert.equal(raw.info.content, 'drawable');
  assert.equal(raw.info.drawElementImage, 'function');
  assert.equal(raw.info.texElementSubImage2D, 'function');
  assert.equal(raw.info.updateElementGeometry, 'function');
});
