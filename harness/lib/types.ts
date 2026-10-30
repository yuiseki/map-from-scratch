// Types shared across the harness.

export type Stat = 'min' | 'p50' | 'p95' | 'p99' | 'max' | 'mean';

export interface Summary {
  n: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  mean: number | null;
  stdev: number | null;
}

export interface Budget {
  stat?: Stat;
  max?: number;
  min?: number;
}

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
}

// Emulated network for a browser run (CDP Network.emulateNetworkConditions).
export interface Network { name?: string; latencyMs: number; downloadKbps: number; uploadKbps: number }

// Run settings the harness works from, whether they came from spec.yaml
// (fromDefinition) or an old spec.json.
export interface Spec {
  id: string;
  request: string;
  baseline?: boolean;
  runtime: 'browser' | 'native';
  gpu: 'hardware' | 'none';
  bake?: string[];
  build?: string[];
  toolchain?: string;
  run: { page?: string; viewport?: Viewport; cpuThrottle?: number; network?: Network; cmd?: string[] };
  iterations: number;
  timeoutMs: number;
  footprint: { code: string[]; data: string[]; elf?: string[] };
  dependencies: string[];
  budgets: Record<string, Budget>;
  checks: string[];
  definition?: Definition;
}

// spec.yaml, as written (see .agents/skills/map-from-scratch/references/spec-yaml.md).
export interface Definition {
  id: string;
  request: string;
  baseline?: boolean;
  publication?: { pages: boolean; reason?: string };
  requirements: { id: string; need: string; rationale?: string; unmeasured?: string }[];
  evaluation: {
    budgets: { metric: string; stat?: Stat; max?: number; min?: number; unit?: string; requirement: string }[];
    gates?: string[];
  };
  benchmarks: {
    runtime: 'browser' | 'native';
    page?: string;
    viewport?: { width: number; height: number; device_scale_factor?: number; mobile?: boolean };
    cpu_throttle?: number;
    network?: { name?: string; latency_ms: number; download_mbps: number; upload_mbps?: number };
    cmd?: string[];
    iterations?: number;
    timeout_ms?: number;
    scenarios: { id: string; what: string; metrics?: string[] }[];
  };
  datasets: {
    bake?: string[];
    sources?: { id: string; origin?: string; license?: string }[];
    outputs?: string[];
    preparation?: string[];
  };
  performance_knowledge: { id: string; finding: string; evidence?: string; applies_when?: string }[];
  architecture_selection: {
    chosen: {
      platform?: string;
      api?: string;
      language?: string;
      gpu: 'hardware' | 'none';
      build?: string[];
      toolchain?: string;
      code?: string[];
      elf?: string[];
      dependencies?: string[];
      why?: string;
    };
    alternatives?: { option: string; rejected_because: string }[];
    not_doing?: string[];
  };
  verification: {
    checks: { id: string; what: string; how: string; expected: unknown; by?: 'bench' | 'build' }[];
    harness?: string[];
  };
}

// What a renderer sends, one object per "@mfs " line.
export type MfsEvent =
  | { metric: string; value?: number; values?: number[] }
  | { mark: string }
  | { info: Record<string, unknown> }
  | { check: string; pass: boolean; detail?: string }
  | { error: string }
  | { done: true };

export interface CheckRun { pass: boolean; detail?: string }

export interface RawResult {
  metrics: Record<string, number[]>;
  info: Record<string, unknown>;
  errors: string[];
  checks: Record<string, CheckRun[]>;
  done: boolean;
}
