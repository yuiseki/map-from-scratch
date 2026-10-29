import { readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { parseYaml } from './yaml.ts';
import type { Definition, Spec } from './types.ts';

const RUNTIMES = ['browser', 'native'];
const STATS = ['min', 'p50', 'p95', 'p99', 'max', 'mean'];

// spec.yaml is the definition of an example: requirements, evaluation,
// benchmarks, datasets, performance knowledge, architecture selection and
// verification. The harness takes its run settings from it.
export function loadSpec(dir: string): Spec {
  const yaml = join(dir, 'spec.yaml');
  const name = basename(dirname(dirname(dir))) === 'examples'
    ? `${basename(dirname(dir))}-${basename(dir)}`
    : basename(dir);
  if (!existsSync(yaml)) throw new Error(`${name}: spec.yaml not found`);
  const def = validateDefinition(parseYaml(readFileSync(yaml, 'utf8')), name);
  return { ...validateSpec(fromDefinition(def), name), definition: def };
}

export const SECTIONS = ['requirements', 'evaluation', 'benchmarks', 'datasets', 'performance_knowledge', 'architecture_selection', 'verification'];

// Parsed YAML is checked field by field before it is trusted as a Definition.
type Loose = Record<string, any>;

export function validateDefinition(input: unknown, dirName: string): Definition {
  const fail = (msg: string): never => { throw new Error(`${dirName}/spec.yaml: ${msg}`); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('not a mapping');
  const def = input as Loose;
  if (def.publication !== undefined) {
    if (typeof def.publication?.pages !== 'boolean') fail('publication.pages must be a boolean');
    if (def.publication.pages === false && (typeof def.publication.reason !== 'string' || !def.publication.reason.trim())) {
      fail('publication.reason is required when Pages publication is disabled');
    }
  }
  for (const k of SECTIONS) if (def[k] === undefined || def[k] === null) fail(`section ${k} is required`);
  if (!Array.isArray(def.requirements)) fail('requirements must be a list');
  if (!Array.isArray(def.evaluation.budgets)) fail('evaluation.budgets must be a list');
  if (!Array.isArray(def.performance_knowledge)) fail('performance_knowledge must be a list');
  if (!Array.isArray(def.verification.checks)) fail('verification.checks must be a list');
  if (!def.architecture_selection.chosen) fail('architecture_selection.chosen is required');
  for (const r of def.requirements as Loose[]) if (!r.id || !r.need) fail('every requirement needs id and need');
  const reqIds = new Set((def.requirements as Loose[]).map((r) => r.id));
  for (const b of def.evaluation.budgets as Loose[]) {
    if (!b.metric) fail('every budget needs a metric');
    if (!reqIds.has(b.requirement)) fail(`budget ${b.metric} points at unknown requirement "${b.requirement}"`);
  }
  for (const r of def.requirements as Loose[]) {
    const measured = (def.evaluation.budgets as Loose[]).some((b) => b.requirement === r.id);
    if (!measured && !r.unmeasured) fail(`requirement ${r.id} has no budget and no "unmeasured" reason`);
  }
  for (const c of def.verification.checks as Loose[]) {
    if (!c.id || !c.what || !c.how || c.expected === undefined) fail(`check ${c.id ?? '?'} needs id, what, how and expected`);
  }
  return def as Definition;
}

export function publishOnPages(def: Definition): boolean {
  return def.publication?.pages !== false;
}

export function fromDefinition(def: Definition): Loose {
  const b = def.benchmarks, chosen = def.architecture_selection.chosen;
  const run: Loose = b.runtime === 'browser'
    ? {
      page: b.page,
      viewport: b.viewport && {
        width: b.viewport.width, height: b.viewport.height,
        deviceScaleFactor: b.viewport.device_scale_factor ?? 1, mobile: b.viewport.mobile ?? false,
      },
      cpuThrottle: b.cpu_throttle ?? 1,
      network: b.network && {
        name: b.network.name, latencyMs: b.network.latency_ms,
        downloadKbps: b.network.download_mbps * 1000, uploadKbps: (b.network.upload_mbps ?? b.network.download_mbps) * 1000,
      },
    }
    : { cmd: b.cmd };
  if (run.viewport === undefined) delete run.viewport;
  if (run.network === undefined) delete run.network;
  return {
    id: def.id,
    request: def.request,
    baseline: def.baseline ?? false,
    runtime: b.runtime,
    gpu: chosen.gpu,
    bake: def.datasets.bake,
    build: chosen.build ?? undefined,
    run,
    iterations: b.iterations,
    timeoutMs: b.timeout_ms,
    footprint: { code: chosen.code ?? [], data: def.datasets.outputs ?? [], elf: chosen.elf },
    dependencies: chosen.dependencies ?? [],
    budgets: Object.fromEntries(def.evaluation.budgets.map((x) => [x.metric, { stat: x.stat, max: x.max, min: x.min }])),
    checks: def.verification.checks.filter((c) => (c.by ?? 'bench') === 'bench').map((c) => c.id),
  };
}

// Run settings (see fromDefinition), with defaults filled in.
export function validateSpec(spec: Loose, dirName: string): Spec {
  const fail = (msg: string): never => { throw new Error(`${dirName}/spec.yaml: ${msg}`); };
  if (spec.id !== dirName) fail(`id "${spec.id}" must equal the directory name`);
  if (typeof spec.request !== 'string' || !spec.request) fail('request (the fictional instruction) is required');
  if (!RUNTIMES.includes(spec.runtime)) fail(`runtime must be one of ${RUNTIMES.join(', ')}`);
  spec.run ??= {};
  if (spec.runtime === 'browser') {
    if (!spec.run.page) fail('run.page is required for a browser renderer');
    spec.run.viewport = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, ...spec.run.viewport };
    spec.run.cpuThrottle ??= 1;
  } else if (!Array.isArray(spec.run.cmd)) {
    fail('run.cmd (argv array) is required for a native renderer');
  }
  // Code that ships: files (footprint.code), or for a microcontroller the
  // object files whose sections are measured (footprint.elf).
  const shipped = [...(spec.footprint?.code ?? []), ...(spec.footprint?.elf ?? [])];
  if (shipped.length === 0) fail('footprint.code or footprint.elf (what ships) is required');
  spec.footprint.code ??= [];
  spec.footprint.data ??= [];
  spec.dependencies ??= [];
  spec.checks ??= [];
  spec.gpu ??= 'hardware';
  if (!['hardware', 'none'].includes(spec.gpu)) fail('gpu must be "hardware" or "none"');
  spec.iterations ??= 5;
  spec.timeoutMs ??= 120000;
  spec.budgets ??= {};
  for (const [name, b] of Object.entries(spec.budgets as Record<string, Loose>)) {
    if (b.max == null && b.min == null) fail(`budget ${name} needs max or min`);
    if (b.stat !== undefined && !STATS.includes(b.stat)) fail(`budget ${name}: stat must be one of ${STATS.join(', ')}`);
  }
  return spec as Spec;
}
