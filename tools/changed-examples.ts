// Which examples a set of changed files can affect, for checking only those
// before a deploy.
//
//   node tools/changed-examples.ts <file listing changed paths, one per line>
//
// prints the ids to check, one per line, or "all".
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ExampleDir {
  id: string;
  dir: string;    // relative to the repository, no trailing slash
  refs: string[]; // ids of other examples it reads (their data, bake or code)
}

// Code every example runs on, or that builds them: a change here can break
// any of them.
const SHARED = [/^harness\//, /^tools\//, /^kits\//, /^vendor\//, /^docker\//, /^bin\//, /^package(-lock)?\.json$/, /^tsconfig[^/]*\.json$/];

export function examplesToCheck(changed: string[], examples: ExampleDir[]): string[] | 'all' {
  if (changed.some((f) => SHARED.some((r) => r.test(f)))) return 'all';
  const hit = new Set<string>();
  for (const f of changed) {
    const e = examples.find((x) => f.startsWith(x.dir + '/'));
    if (e) hit.add(e.id);
  }
  // Examples that read a changed one, and those that read them.
  for (let grew = true; grew;) {
    grew = false;
    for (const e of examples) {
      if (!hit.has(e.id) && e.refs.some((r) => hit.has(r))) { hit.add(e.id); grew = true; }
    }
  }
  return examples.filter((e) => hit.has(e.id)).map((e) => e.id);
}

// Every directory under examples/ and baselines/ with a spec.yaml. An
// example refers to another when its spec, code or page names the other's
// id (a bake, a data/baked/<id>/ path, an import).
export function findExamples(root: string): ExampleDir[] {
  const dirs: string[] = [];
  const walk = (d: string): void => {
    if (existsSync(join(root, d, 'spec.yaml'))) { dirs.push(d); return; }
    for (const n of readdirSync(join(root, d))) {
      if (statSync(join(root, d, n)).isDirectory()) walk(`${d}/${n}`);
    }
  };
  for (const top of ['examples', 'baselines']) if (existsSync(join(root, top))) walk(top);
  const ids = dirs.map((d) => readFileSync(join(root, d, 'spec.yaml'), 'utf8').match(/^id: *(\S+)/m)?.[1] ?? d);
  return dirs.map((dir, i) => {
    const text = readdirSync(join(root, dir))
      .filter((n) => /\.(ts|yaml|html)$/.test(n))
      .map((n) => readFileSync(join(root, dir, n), 'utf8')).join('\n');
    const refs = ids.filter((id, j) => j !== i && new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(text));
    return { id: ids[i], dir, refs };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(import.meta.url), '..', '..');
  const changed = readFileSync(process.argv[2], 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((f) => (f.startsWith('/') ? relative(root, f) : f));
  const r = examplesToCheck(changed, findExamples(root));
  console.log(r === 'all' ? 'all' : r.join('\n'));
}
