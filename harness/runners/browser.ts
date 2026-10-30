import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP } from '../lib/cdp.ts';
import { serve } from '../lib/serve.ts';
import { Collector } from '../lib/protocol.ts';
import type { AddressInfo } from 'node:net';
import type { MfsEvent, RawResult, Spec } from '../lib/types.ts';

export interface Chrome { cdp: CDP; pid: number; close(): Promise<void> }
type RunSettings = Pick<Spec, 'run' | 'timeoutMs'>;

// GPU flags for headless Chromium on Linux with the NVIDIA driver injected by
// the container runtime. Override with MFS_CHROME_FLAGS when a machine needs
// something else; the GPU the page actually got is recorded in info.gpu, so a
// silent fall back to SwiftShader is visible in every result.
// Do not add the VulkanFromANGLE feature: with it the GPU process crashes
// right after launch and every context created before that is lost.
const GPU_FLAGS = [
  '--ignore-gpu-blocklist',
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--enable-unsafe-webgpu',
  '--enable-blink-features=CanvasDrawElement',
  '--disable-gpu-vsync',
  '--disable-frame-rate-limit',
];

export async function launchChrome(logFile?: string): Promise<Chrome> {
  const profileBase = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache');
  mkdirSync(profileBase, { recursive: true });
  const userDir = mkdtempSync(join(profileBase, 'mfs-chrome-'));
  const flags = process.env.MFS_CHROME_FLAGS ? process.env.MFS_CHROME_FLAGS.split(/\s+/) : GPU_FLAGS;
  const proc = spawn(process.env.CHROME_BIN ?? 'chromium', [
    '--headless=new',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDir}`,
    ...flags,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`chromium did not start:\n${buf}`)), 30000);
    proc.stderr.on('data', (d) => {
      buf += d;
      if (logFile) appendFileSync(logFile, d);
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`chromium exited ${code}:\n${buf}`)));
  });
  const cdp = await CDP.connect(wsUrl);
  return {
    cdp,
    pid: proc.pid!,
    async close() {
      cdp.close();
      proc.kill('SIGKILL');
      await new Promise((r) => proc.once('exit', r));
      rmSync(userDir, { recursive: true, force: true });
    },
  };
}

// Resident memory of the browser and every process under it, in MB.
function treeRssMb(rootPid: number): number {
  const children = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const status = readFileSync(`/proc/${name}/status`, 'utf8');
      const ppid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);
      const kb = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
      rss.set(Number(name), kb);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid)!.push(Number(name));
    } catch { /* process went away */ }
  }
  let total = 0;
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop()!;
    total += rss.get(pid) ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return total / 1024;
}

async function runOnce(chrome: Chrome, url: string, spec: RunSettings, outDir: string, i: number, collector: Collector, screenshot: boolean): Promise<void> {
  const { cdp } = chrome;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m: string, p: object = {}) => cdp.send(m, p, sessionId);
  const off: (() => void)[] = [];
  try {
    await s('Runtime.enable');
    await s('Page.enable');
    await s('Performance.enable');
    await s('Network.enable');
    await s('Network.setCacheDisabled', { cacheDisabled: true });
    const net = spec.run.network;
    if (net) {
      await s('Network.emulateNetworkConditions', {
        offline: false, latency: net.latencyMs,
        downloadThroughput: (net.downloadKbps * 1000) / 8, uploadThroughput: (net.uploadKbps * 1000) / 8,
      });
    }
    const v = spec.run.viewport!;
    await s('Emulation.setDeviceMetricsOverride', v);
    if (v.mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true });
    await s('Emulation.setCPUThrottlingRate', { rate: spec.run.cpuThrottle });
    await s('Runtime.addBinding', { name: '__mfsEmit' });

    let bytes = 0, requests = 0;
    off.push(cdp.on('Network.loadingFinished', (p, sid) => { if (sid === sessionId) { bytes += p.encodedDataLength; requests++; } }));
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout after ${spec.timeoutMs} ms`)), spec.timeoutMs);
      off.push(cdp.on('Runtime.bindingCalled', (p, sid) => {
        if (sid !== sessionId || p.name !== '__mfsEmit') return;
        const ev = JSON.parse(p.payload) as MfsEvent;
        collector.add(ev);
        if ('done' in ev || 'error' in ev) { clearTimeout(timer); resolve(); }
      }));
      off.push(cdp.on('Runtime.exceptionThrown', (p, sid) => {
        if (sid !== sessionId) return;
        const d = p.exceptionDetails;
        collector.add({ error: `exception: ${d.exception?.description ?? d.text}` });
        clearTimeout(timer);
        resolve();
      }));
    });
    await s('Page.navigate', { url });
    await done;

    const { metrics } = await s('Performance.getMetrics');
    const m: Record<string, number> = Object.fromEntries(metrics.map((x: { name: string; value: number }) => [x.name, x.value]));
    collector.add({ metric: 'js_heap_mb', value: m.JSHeapUsedSize / 2 ** 20 });
    collector.add({ metric: 'transfer_kb', value: bytes / 1024 });
    collector.add({ metric: 'requests', value: requests });
    collector.add({ metric: 'browser_rss_mb', value: treeRssMb(chrome.pid) });
    if (screenshot) {
      const { data } = await s('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, 'screenshot.png'), Buffer.from(data, 'base64'));
    }
  } finally {
    for (const f of off) f();
    await cdp.send('Target.closeTarget', { targetId });
  }
}

// root: where the pages are served from (the repository, or the built site);
// the harness's own pages always come from the repository.
export async function benchBrowser(root: string, spec: RunSettings, outDir: string, { iterations }: { iterations: number }): Promise<RawResult> {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const server = await serve(root, 0, '127.0.0.1', { '/harness/probe/': join(repo, 'harness/probe') });
  // MFS_PAGE_QUERY appends parameters, for comparing variants of a renderer.
  const extra = process.env.MFS_PAGE_QUERY ? `&${process.env.MFS_PAGE_QUERY}` : '';
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${spec.run.page}?bench=1${extra}`;
  const logFile = join(outDir, 'chrome.log');
  writeFileSync(logFile, '');
  const chrome = await launchChrome(logFile);
  const collector = new Collector();
  try {
    const { product } = await chrome.cdp.send('Browser.getVersion');
    collector.add({ info: { browser: product, page_query: process.env.MFS_PAGE_QUERY ?? '' } });
    const warm = new Collector();
    const warmSpec: RunSettings = { run: { viewport: { width: 64, height: 64, deviceScaleFactor: 1, mobile: false }, cpuThrottle: 1 }, timeoutMs: 30000 };
    const base = url.slice(0, url.indexOf('/', 'http://'.length));
    await runOnce(chrome, `${base}/harness/probe/warmup.html`, warmSpec, outDir, -1, warm, false);
    collector.add({ info: warm.info });
    for (const e of warm.errors) collector.add({ error: `warm-up: ${e}` });
    for (let i = 0; i < iterations; i++) {
      await runOnce(chrome, url, spec, outDir, i, collector, i === iterations - 1);
    }
  } finally {
    await chrome.close();
    server.close();
  }
  return collector.result();
}
