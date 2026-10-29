import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../tools/sources.ts';

const dir = 'data/baked/deckgl-015-point-cloud-layer';
mkdirSync(dir, { recursive: true });
const output = execFileSync('/opt/mfs-python/bin/python', [
  'examples/deckgl/015-point-cloud-layer/bake.py',
  source('deckgl-indoor-point-cloud'),
  `${dir}/points.bin`,
], { encoding: 'utf8' });
console.log(output.trim());
