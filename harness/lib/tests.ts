// The unit tests of the repository: every *.test.ts, kept next to the code it
// tests (examples/23-taito-point-cloud/decode.test.ts beside decode.ts).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Generated, downloaded or third-party trees: nothing there is ours to test.
const SKIP = new Set(['node_modules', 'data', 'results', 'build', 'ref-repos', 'vendor']);

// Paths relative to root, sorted.
export function findTests(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIP.has(e.name)) walk(p);
      } else if (e.name.endsWith('.test.ts')) out.push(p);
    }
  };
  walk('');
  return out.sort();
}
