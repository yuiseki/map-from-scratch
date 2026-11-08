import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examplesToCheck, type ExampleDir } from '../changed-examples.ts';

const examples: ExampleDir[] = [
  { id: '04-osm-node-density', dir: 'examples/04-osm-node-density', refs: [] },
  { id: 'webgpu-004-osm-node-density', dir: 'examples/webgpu/004-osm-node-density', refs: ['04-osm-node-density'] },
  { id: '16-plateau-buildings-3d', dir: 'examples/16-plateau-buildings-3d', refs: [] },
  { id: 'webgpu-001-gpu-driven-culling', dir: 'examples/webgpu/001-gpu-driven-culling', refs: ['16-plateau-buildings-3d'] },
  { id: 'b02-maplibre', dir: 'baselines/b02-maplibre', refs: [] },
];

test('a file inside an example checks that example', () => {
  assert.deepEqual(examplesToCheck(['examples/16-plateau-buildings-3d/main.ts'], examples), ['16-plateau-buildings-3d', 'webgpu-001-gpu-driven-culling']);
  assert.deepEqual(examplesToCheck(['examples/webgpu/001-gpu-driven-culling/map.ts'], examples), ['webgpu-001-gpu-driven-culling']);
  assert.deepEqual(examplesToCheck(['baselines/b02-maplibre/spec.yaml'], examples), ['b02-maplibre']);
});

test('an example that reads another example is checked when that one changes', () => {
  assert.deepEqual(examplesToCheck(['examples/04-osm-node-density/bake.ts'], examples), ['04-osm-node-density', 'webgpu-004-osm-node-density']);
});

test('a directory that only shares a prefix with an example is not that example', () => {
  assert.deepEqual(examplesToCheck(['examples/04-osm-node-density-old/x.ts'], examples), []);
});

test('the harness, tools, kits, vendor, docker, bin and project files check every example', () => {
  for (const f of ['harness/page/bench.ts', 'tools/build-site.ts', 'kits/geoparquet/reader.ts', 'kits/earcut/earcut.ts', 'docker/base/Dockerfile', 'bin/mfs', 'package.json', 'tsconfig.web.json']) {
    assert.equal(examplesToCheck([f], examples), 'all', f);
  }
});

test('documents and other files outside the examples check none', () => {
  assert.deepEqual(examplesToCheck(['README.md', 'TODO.md', 'AGENTS.md', 'docs/a.md', '.agents/skills/x/SKILL.md', 'tests/a.test.ts'], examples), []);
});

test('the result is in the order of the examples, each once', () => {
  assert.deepEqual(
    examplesToCheck(['examples/webgpu/004-osm-node-density/main.ts', 'examples/04-osm-node-density/main.ts', 'examples/04-osm-node-density/spec.yaml'], examples),
    ['04-osm-node-density', 'webgpu-004-osm-node-density'],
  );
});
