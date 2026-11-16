import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Find every example directory, including year/day/gallery nesting. */
export function discoverSpecDirs(base: string): string[] {
  if (!existsSync(base)) return [];
  const result: string[] = [];
  const visit = (dir: string): void => {
    if (existsSync(join(dir, 'spec.yaml'))) {
      result.push(dir);
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(dir, entry.name));
    }
  };
  visit(base);
  return result.sort();
}
