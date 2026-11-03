import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { shippedSource } from './strip.ts';

export interface Footprint {
  code_bytes: number;
  code_gzip_bytes: number;
  data_bytes: number;
  data_gzip_bytes: number;
  total_gzip_bytes: number;
}

// What the renderer costs to ship: the code a user downloads (or the binary
// that gets installed) and the data it loads. spec.footprint lists the files,
// relative to the repository root. Gzip sizes are per file, as a server would
// send them. TypeScript is measured as the JavaScript a browser receives.
// A listed directory stands for every file under it (tile sets split into
// many files for HTTP serving).
export function expandFiles(root: string, files: string[]): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const abs = join(root, rel);
    // A listed directory ships its files, not the tests kept next to them.
    if (statSync(abs).isDirectory()) for (const f of readdirSync(abs).sort()) { if (!f.endsWith('.test.ts')) walk(join(rel, f)); }
    else out.push(rel);
  };
  for (const f of files) {
    try { walk(f); } catch { throw new Error(`footprint file not found: ${f} (build/bake first?)`); }
  }
  return out;
}

export function measureFootprint(root: string, { code = [], data = [] }: { code?: string[]; data?: string[] }): Footprint {
  const read = (f: string): Buffer => {
    try {
      return shippedSource(join(root, f));
    } catch {
      throw new Error(`footprint file not found: ${f} (build/bake first?)`);
    }
  };
  const gz = (bufs: Buffer[]) => bufs.reduce((a, b) => a + gzipSync(b, { level: 9 }).length, 0);
  const codeBufs = expandFiles(root, code).map(read);
  const dataBufs = expandFiles(root, data).map(read);
  return {
    code_bytes: codeBufs.reduce((a, b) => a + b.length, 0),
    code_gzip_bytes: gz(codeBufs),
    data_bytes: dataBufs.reduce((a, b) => a + b.length, 0),
    data_gzip_bytes: gz(dataBufs),
    total_gzip_bytes: gz(codeBufs) + gz(dataBufs),
  };
}

// For microcontroller targets, what an object file will occupy: code in
// flash (.text), constants in flash (.rodata), and RAM (.data + .bss, small
// data sections included). Input is `llvm-size -A` output.
export function parseSizeA(text: string): { text: number; rodata: number; ram: number } {
  const r = { text: 0, rodata: 0, ram: 0 };
  for (const line of text.split('\n')) {
    const m = line.match(/^(\.\S+)\s+(\d+)/);
    if (!m) continue;
    const [, name, size] = m;
    if (/^\.text/.test(name)) r.text += Number(size);
    else if (/^\.s?rodata/.test(name)) r.rodata += Number(size);
    else if (/^\.s?(data|bss)/.test(name)) r.ram += Number(size);
  }
  return r;
}

// spec.footprint.elf: object files to size with llvm-size.
export function measureElf(root: string, files: string[]) {
  const sum = { elf_text_bytes: 0, elf_rodata_bytes: 0, elf_ram_bytes: 0 };
  for (const f of files) {
    const s = parseSizeA(execFileSync('llvm-size', ['-A', join(root, f)], { encoding: 'utf8' }));
    sum.elf_text_bytes += s.text;
    sum.elf_rodata_bytes += s.rodata;
    sum.elf_ram_bytes += s.ram;
  }
  return sum;
}

export const ALLOWED_DEPENDENCIES = ['earcut'];

export function checkDependencies(deps: string[]): string[] {
  return deps.filter((d) => !ALLOWED_DEPENDENCIES.includes(d));
}

// A frame time measured on SwiftShader or llvmpipe is a CPU number dressed up
// as a GPU number. Runs that land there are reported as errors.
export function isSoftwareGpu(name: unknown): boolean {
  return /swiftshader|llvmpipe|softpipe|software/i.test(typeof name === 'string' ? name : '');
}
