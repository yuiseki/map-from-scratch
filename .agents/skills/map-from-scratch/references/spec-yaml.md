# spec.yaml: the definition of an example

Every example (and baseline) is defined by one `spec.yaml` with seven
sections. The harness reads it (`harness/lib/spec.ts`), refuses an
incomplete one, and takes its run settings from it, so the definition and
what is measured cannot drift apart. The YAML subset the harness parses is in
`harness/lib/yaml.ts` (block maps and lists, flow `[...]` `{...}`, quoted
strings, `>` and `|` blocks, comments; no anchors or tags).

Write the text fields in the language of the request. Copy the closest
example's `spec.yaml` as the starting point.

```yaml
id: 07-world-cities-hover          # = directory name
request: >-                        # the request, quoted as given
  ...
baseline: true                     # only under baselines/: dependencies allowed, no budgets needed
publication: {pages: false, reason: "source data redistribution is pending"} # optional; skips GitHub Pages
requirements: [...]
evaluation: {...}
benchmarks: {...}
datasets: {...}
performance_knowledge: [...]
architecture_selection: {...}
verification: {...}
```

## requirements

What the request needs, one item per need, in the request's words.

| field | |
| --- | --- |
| `id` | short kebab-case name, referenced by budgets |
| `need` | the need as the requester would say it |
| `rationale` | how the need became a number (60 Hz → 16.7 ms, 4G → 600 KB) |
| `unmeasured` | when no budget measures it: why, and where it is checked instead |

Every requirement has at least one budget pointing at it, or an `unmeasured`
reason. The harness refuses anything else.

## evaluation

How pass and fail are decided.

| field | |
| --- | --- |
| `budgets` | list of `{metric, stat, max | min, unit, requirement}`. `stat` is one of min, p50 (default), p95, p99, max, mean. `requirement` must name a requirement |
| `gates` | the other conditions, in words (no errors, hardware GPU, all checks pass) |

A run passes when every budget holds, every check of `verification` passes in
every iteration, and no error was reported. A budget whose metric was never
reported fails.

Metrics come from these places:

- the renderer: anything it emits (`frame_ms`, `pick_ms`, `whole_frame_ms`
  from `benchFrames(..., {prefix: 'whole_'})`, counters);
- the harness, browser: `first_frame_ms` is what the page emits (define it
  in `benchmarks`), `js_heap_mb`, `transfer_kb` and `requests` (all responses
  of the page, uncompressed: the static server does not gzip; requests made
  by workers are not counted), `browser_rss_mb`;
- by convention, a renderer that reads data by HTTP Range emits
  `range_requests` and `range_bytes` (per view or per scenario, named in
  `benchmarks.scenarios`), counted in its own fetch wrapper;
- the harness, native: `<mark>_ms` from `{"mark": ...}` (time since fork),
  `wall_ms`, `process_cpu_ms`, `peak_rss_mb`;
- the harness, footprint: `code_bytes`, `code_gzip_bytes`, `data_bytes`,
  `data_gzip_bytes`, `total_gzip_bytes` (code + data, each file gzipped as a
  server would), `elf_text_bytes`, `elf_rodata_bytes`, `elf_ram_bytes`,
  `dependencies`.

## benchmarks

How the renderer is run and what each measured scenario is.

| field | |
| --- | --- |
| `runtime` | `browser` or `native` |
| `page` | browser: page path from the repository root; the harness adds `?bench=1` |
| `viewport` | browser: `{width, height, device_scale_factor, mobile}` |
| `cpu_throttle` | browser: CPU slowdown factor (4 for a phone) |
| `display` | browser: `headless` (default) or `xvfb`, a headed Chromium on a private X server. WebGPU needs `xvfb` to get the GPU |
| `network` | browser: `{name, latency_ms, download_mbps, upload_mbps}` emulated with CDP; e.g. 4G `{latency_ms: 60, download_mbps: 9}`. Use it whenever data is fetched while the map is used |
| `cmd` | native: argv from the repository root |
| `iterations` | runs; first frame and checks repeat per run |
| `timeout_ms` | per run, default 120000 |
| `scenarios` | list of `{id, what, metrics}`: what each part of the bench does and which metrics it reports. State exactly when `first_frame_ms` starts and stops |

## datasets

Where the data comes from and what the renderer receives.

| field | |
| --- | --- |
| `bake` | argv run by `bin/mfs bake <id>` |
| `sources` | list of `{id, origin, license}`; `id` names an entry of `tools/sources.ts` |
| `outputs` | baked files (or directories) the renderer loads; they are the footprint's data and what GitHub Pages publishes (each file under 100 MB) |
| `preparation` | the bake steps in words: projection, simplification, quantisation, ordering, encoding |

Raw sources live in `tools/sources.ts` (converted once to `data/raw/`,
again when their settings change). Processing specific to one example
(dissolving countries, clipping) belongs in its `bake.ts`.

Set `publication.pages: false` with a nonempty `reason` when the example's
data must not be copied to GitHub Pages. The site builder omits the entire
example, including its page, code, data and index entry. Omit `publication`
for examples that may be published.

## performance_knowledge

What was learnt by measuring, kept with the numbers.

| field | |
| --- | --- |
| `id` | short name |
| `finding` | the claim |
| `evidence` | the measurement behind it, with numbers |
| `applies_when` | when a later renderer can reuse it |

Dead ends and measurement mistakes belong here too.

## architecture_selection

What was built and why, and what was not.

| field | |
| --- | --- |
| `chosen.platform` / `api` / `language` | the runtime choice |
| `chosen.gpu` | `hardware` (a software rasteriser is an error) or `none` |
| `chosen.build` | argv run by `bin/mfs build <id>` |
| `chosen.toolchain` | the image the build needs, `docker/Dockerfile.<toolchain>` (e.g. `emscripten`); build with `MFS_TOOLCHAIN=<toolchain> bin/mfs build <id>` (docker/README.md) |
| `chosen.code` | files that ship (browser: the page and modules it needs, not the bench code; native: the executable) |
| `chosen.elf` | microcontroller object files, sized with `llvm-size` |
| `chosen.dependencies` | external dependencies; only `earcut` is allowed outside baselines |
| `chosen.why` | why this choice fits the request |
| `alternatives` | `{option, rejected_because}`; say "not compared" when it was not measured |
| `not_doing` | the features this renderer deliberately lacks |

## verification

Checks of correctness, each reported by the renderer under its id.

| field | |
| --- | --- |
| `checks` | list of `{id, what, how, expected, by}` |
| `checks[].by` | `bench` (default): the renderer emits `{"check": id, "pass": bool, "detail": ...}` in every iteration. `build`: enforced by the build command failing |
| `harness` | the checks the harness does on its own, in words |

A check that is not reported counts as failed. Read back what reached the
screen, not an intermediate buffer, and allow for neighbours: a dense area
can put another feature's outline on the pixel you test.
