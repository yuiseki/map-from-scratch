// Local module specifiers in a source file, for tools/build-site.ts: static
// imports, re-exports, dynamic imports with a string literal, and module
// URLs built with new URL('./x.ts', import.meta.url) (a module worker).
// Only .ts and .js URLs count: new URL('./reader.wasm', ...) is data, copied
// as it is, not a module to strip and rewrite.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bnew\s+URL\s*\(\s*(?=(['"])[^'"]+\.(?:ts|js)\1\s*,\s*import\.meta\.url))(['"])([^'"]+)\2/g;

export const toJs = (p: string): string => p.replace(/\.ts$/, '.js');
export const isLocal = (s: string): boolean => s.startsWith('./') || s.startsWith('../');

// Rewrites each local specifier to its .js name and returns the specifiers.
export function rewriteSpecifiers(src: string): { src: string; specs: string[] } {
  const specs: string[] = [];
  const out = src.replace(SPECIFIER, (m, _look: string, q: string, spec: string) => {
    if (!isLocal(spec)) return m;
    specs.push(spec);
    return m.replace(`${q}${spec}${q}`, `${q}${toJs(spec)}${q}`);
  });
  return { src: out, specs };
}
