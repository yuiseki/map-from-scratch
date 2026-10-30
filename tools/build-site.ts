// Build the GitHub Pages site: every browser example (and baseline) as static
// files, so that each can be opened and used as it was measured.
//
//   node tools/build-site.ts [outDir]     (default .cache/site)
//
// GitHub Pages cannot serve .ts as JavaScript, so each module reachable from
// a page is written as .js with its types stripped (the same transform the
// harness server uses) and its import specifiers rewritten. Data comes from
// each spec.yaml's datasets.outputs; files over GitHub's 100 MB limit stop
// the build.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { loadSpec, publishOnPages } from '../harness/lib/spec.ts';
import { expandFiles } from '../harness/lib/footprint.ts';
import type { Spec } from '../harness/lib/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] ?? '.cache/site');
const MAX_FILE = 100 * 1024 * 1024;
const REPO_URL = 'https://github.com/yuiseki/map-from-scratch';

// Module specifiers in a source file: static imports, re-exports, dynamic
// imports with a string literal, and <script src> in HTML.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g;
const SCRIPT_SRC = /<script\b[^>]*\bsrc=(['"])([^'"]+)\1/g;
const LINK_HREF = /<link\b[^>]*\bhref=(['"])([^'"]+)\1/g;

const toJs = (p: string) => p.replace(/\.ts$/, '.js');
const isLocal = (s: string) => s.startsWith('./') || s.startsWith('../');

function writeOut(srcAbs: string, body: Buffer | string): void {
  const dst = join(out, toJs(relative(root, srcAbs)));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, body);
}

const copied = new Set<string>();
function copyModule(abs: string): void {
  if (copied.has(abs)) return;
  copied.add(abs);
  if (!existsSync(abs)) throw new Error(`missing module ${relative(root, abs)}`);
  let src = readFileSync(abs, 'utf8');
  const deps: string[] = [];
  src = src.replace(SPECIFIER, (m, q: string, spec: string) => {
    if (!isLocal(spec)) return m;
    deps.push(resolve(dirname(abs), spec));
    return m.replace(`${q}${spec}${q}`, `${q}${toJs(spec)}${q}`);
  });
  if (abs.endsWith('.ts')) src = stripTypeScriptTypes(src, { mode: 'transform' });
  writeOut(abs, src);
  for (const d of deps) copyModule(d);
}

function copyPage(htmlAbs: string): void {
  let html = readFileSync(htmlAbs, 'utf8');
  const scripts: string[] = [];
  html = html.replace(SCRIPT_SRC, (m, q: string, src: string) => {
    if (!isLocal(src)) return m;
    scripts.push(resolve(dirname(htmlAbs), src));
    return m.replace(`${q}${src}${q}`, `${q}${toJs(src)}${q}`);
  });
  html = html.replace(LINK_HREF, (m, q: string, href: string) => {
    if (!isLocal(href)) return m;
    const abs = resolve(dirname(htmlAbs), href);
    if (!href.endsWith('.ts')) { copyFile(abs); return m; }
    scripts.push(abs);   // modulepreload of a module
    return m.replace(`${q}${href}${q}`, `${q}${toJs(href)}${q}`);
  });
  writeOut(htmlAbs, html);
  for (const s of scripts) (s.endsWith('.ts') || s.endsWith('.js') ? copyModule : copyFile)(s);
}

function copyFile(abs: string): void {
  if (copied.has(abs)) return;
  copied.add(abs);
  const size = statSync(abs).size;
  if (size > MAX_FILE) throw new Error(`${relative(root, abs)} is ${(size / 2 ** 20).toFixed(0)} MB, over GitHub Pages' 100 MB per file`);
  const dst = join(out, relative(root, abs));
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(abs, dst);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

// TODO.md is the inventory of the four original galleries. Keep the link on
// each new example card without duplicating 225 URLs in individual specs.
const originalUrls = new Map<string, string>();
const inventory = readFileSync(join(root, 'TODO.md'), 'utf8');
for (const match of inventory.matchAll(/^- \[[ x]\] `([a-z0-9]+-\d{3}-[^`]+)`.*? — \[[^\]]+\]\((https:\/\/[^)]+)\)/gm)) {
  originalUrls.set(match[1], match[2]);
}
for (const match of inventory.matchAll(/^- \[[ x]\] `([a-z0-9]+-\d{3}-[^`]+)`/gm)) {
  if (!originalUrls.has(match[1])) throw new Error(`${match[1]}: original gallery URL missing in TODO.md`);
}

const galleries = [
  { id: 'maplibre', label: 'MapLibre GL JS' },
  { id: 'mapbox', label: 'Mapbox GL JS' },
  { id: 'cesium', label: 'CesiumJS' },
  { id: 'openglobus', label: 'OpenGlobus' },
  { id: 'deckgl', label: 'deck.gl' },
  { id: 'd3', label: 'D3' },
  { id: 'leaflet', label: 'Leaflet' },
  { id: 'tangram', label: 'Tangram' },
  { id: 'forge3d', label: 'forge3d' },
  { id: 'kepler', label: 'kepler.gl' },
  { id: 'luma', label: 'luma.gl' },
  { id: 'webgpu', label: 'WebGPU' },
  { id: 'opfs', label: 'OPFS' },
  { id: 'legacy', label: '既存の例' },
] as const;
const galleryOf = (dir: string) => galleries.find(({ id }) => dir.startsWith(`examples/${id}/`))?.id ?? 'legacy';

// The examples, from spec.yaml, with their latest measurements when present.
function indexPage(rows: { id: string; dir: string; spec: Spec }[]): string {
  const counts = new Map(galleries.map(({ id }) => [id, rows.filter(({ dir }) => galleryOf(dir) === id).length]));
  const filterButtons = galleries.map(({ id, label }) =>
    `<button type="button" data-filter="${id}" aria-pressed="false"${counts.get(id) ? '' : ' disabled'}>${label} <span>${counts.get(id)}</span></button>`
  ).join('\n');
  const items = rows.map(({ id, dir, spec }) => {
    const d = spec.definition!;
    const chosen = d.architecture_selection.chosen;
    const latest = join(root, 'results', id, 'latest.json');
    let numbers = '';
    if (existsSync(latest)) {
      const r = JSON.parse(readFileSync(latest, 'utf8'));
      const s = (k: string, st = 'p50') => r.summaries?.[k]?.[st];
      const parts: string[] = [];
      if (s('code_gzip_bytes') != null) parts.push(`コード ${(s('code_gzip_bytes') / 1024).toFixed(1)} KB gzip`);
      if (s('data_gzip_bytes')) parts.push(`データ ${(s('data_gzip_bytes') / 1024).toFixed(0)} KB gzip`);
      if (s('first_frame_ms') != null) parts.push(`初回描画 ${Math.round(s('first_frame_ms'))} ms`);
      if (s('frame_ms', 'p95') != null) parts.push(`フレーム p95 ${s('frame_ms', 'p95').toFixed(2)} ms`);
      numbers = `<p class="num">${esc(parts.join(' ・ '))}</p>`;
    }
    const tag = spec.baseline ? ' <span class="tag">比較用</span>' : '';
    const runtimeTag = spec.runtime === 'native' ? ' <span class="tag">ソース・計測結果</span>' : '';
    const href = spec.runtime === 'browser' ? `${esc(dir)}/` : `${REPO_URL}/tree/main/${esc(dir)}`;
    const action = spec.runtime === 'browser' ? '操作する ↗' : '実装を見る ↗';
    const requestLink = existsSync(join(root, dir, 'REQUEST.md'))
      ? ` ・ <a href="${REPO_URL}/blob/main/${esc(dir)}/REQUEST.md">設計と計測</a>`
      : '';
    const original = originalUrls.get(id);
    if (dir.startsWith('examples/') && dir.split('/').length === 3 && !original)
      throw new Error(`${id}: original gallery URL missing in TODO.md`);
    const originalLink = original ? ` ・ <a href="${esc(original)}">元例 ↗</a>` : '';
    return `<li data-gallery="${galleryOf(dir)}"><div class="card-head"><span class="id">${esc(id)}</span>${tag}${runtimeTag}</div>
  <p class="req">${esc(d.request)}</p>
  <p class="how">${esc([chosen.api, chosen.language].filter(Boolean).join(' / '))}</p>${numbers || '<p class="num">性能は未計測</p>'}
  <p class="links"><a href="${REPO_URL}/tree/main/${esc(dir)}">ソース</a> ・ <a href="${REPO_URL}/blob/main/${esc(dir)}/spec.yaml">spec.yaml</a>${requestLink}${originalLink}</p>
  <a class="open" href="${href}">${action}</a></li>`;
  }).join('\n');
  return `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>map-from-scratch</title>
<style>
  :root { --bg: #fafaf7; --fg: #1f2328; --muted: #59636e; --line: #d8dee4; --accent: #0b6e4f; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --accent: #3fb950; } }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 1200px; padding: 32px 20px 72px; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
  h1 { font-size: clamp(1.8rem, 4vw, 2.5rem); margin: 0 0 6px; }
  .lead { color: var(--muted); margin: 0 0 30px; max-width: 780px; }
  .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
  .filters button { border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; background: var(--bg); color: var(--fg); font: inherit; cursor: pointer; }
  .filters button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: white; }
  .filters button:disabled { opacity: 0.45; cursor: default; }
  .filters button span { font-size: 0.85em; opacity: 0.75; }
  .visible-count { margin: 0 0 16px; color: var(--muted); font-size: 0.88rem; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 18px; }
  li[hidden] { display: none; }
  li { min-width: 0; display: flex; flex-direction: column; padding: 20px; border: 1px solid var(--line); border-radius: 14px; background: color-mix(in srgb, var(--bg) 88%, var(--fg)); box-shadow: 0 3px 14px #0000000b; }
  li:hover { border-color: var(--accent); box-shadow: 0 8px 22px #00000018; }
  .card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .id { font-size: 0.82rem; font-weight: 700; overflow-wrap: anywhere; }
  .req { margin: 15px 0 12px; font-size: 1.05rem; font-weight: 600; }
  .how, .num, .links { margin: 3px 0; color: var(--muted); font-size: 0.88rem; }
  .links { margin-top: auto; padding-top: 14px; }
  .open { display: inline-block; align-self: flex-start; margin-top: 14px; padding: 7px 12px; border-radius: 7px; background: var(--accent); color: white; font-weight: 700; text-decoration: none; }
  .open:hover, .open:focus-visible { text-decoration: underline; }
  .tag { font-size: 0.72rem; border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; color: var(--muted); }
  a { color: var(--accent); }
</style>
<h1>map-from-scratch</h1>
<p class="lead">「X をしたいから地図を作って」という依頼ごとに作った例です。ブラウザ用の例は操作できます。表示した性能値はリポジトリのハーネスで測ったものです。 <a href="${REPO_URL}/blob/main/docs/gallery-comparison.md">比較計測の条件</a> ・ <a href="${REPO_URL}">GitHub</a></p>
<nav class="filters" aria-label="元ギャラリーで絞り込み">
<button type="button" data-filter="all" aria-pressed="true">すべて <span>${rows.length}</span></button>
${filterButtons}
</nav>
<p class="visible-count" id="visible-count">${rows.length} 件を表示</p>
<ul>
${items}
</ul>
<script>
  const buttons = [...document.querySelectorAll('[data-filter]')];
  const cards = [...document.querySelectorAll('li[data-gallery]')];
  buttons.forEach((button) => button.addEventListener('click', () => {
    const selected = button.dataset.filter;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    let visible = 0;
    cards.forEach((card) => {
      card.hidden = selected !== 'all' && card.dataset.gallery !== selected;
      if (!card.hidden) visible++;
    });
    document.getElementById('visible-count').textContent = visible + ' 件を表示';
  }));
</script>
`;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const rows: { id: string; dir: string; spec: Spec }[] = [];
for (const base of ['examples', 'baselines']) {
  for (const name of readdirSync(join(root, base)).sort()) {
    const parent = join(root, base, name);
    const dirs = existsSync(join(parent, 'spec.yaml')) ? [parent]
      : base === 'examples' ? readdirSync(parent).map((child) => join(parent, child)).filter((dir) => existsSync(join(dir, 'spec.yaml')))
      : [];
    for (const dir of dirs) {
      const spec = loadSpec(dir);
      if (!publishOnPages(spec.definition!)) continue;
      if (spec.runtime === 'browser') {
        copyPage(join(dir, 'index.html'));
        for (const f of expandFiles(root, spec.footprint.code)) if (!f.endsWith('.ts') && !f.endsWith('.html')) copyFile(join(root, f));
        for (const f of expandFiles(root, spec.footprint.data)) copyFile(join(root, f));
      }
      rows.push({ id: spec.id, dir: relative(root, dir), spec });
    }
  }
}
writeFileSync(join(out, 'index.html'), indexPage(rows));
writeFileSync(join(out, '.nojekyll'), '');   // serve dot directories (.cache) as they are
let total = 0;
const walk = (d: string): void => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else total += statSync(p).size; } };
walk(out);
console.log(`site: ${rows.length} cards, ${copied.size} files, ${(total / 2 ** 20).toFixed(1)} MB in ${relative(root, out)}`);
