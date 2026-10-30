import { mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../tools/sources.ts';

const dir = 'data/baked/deckgl-015-point-cloud-layer';
mkdirSync(dir, { recursive: true });
const pythonBin = process.env.PYTHON ?? (existsSync('/opt/mfs-python/bin/python') ? '/opt/mfs-python/bin/python' : 'python3');
const output = execFileSync(pythonBin, [
  'examples/deckgl/015-point-cloud-layer/bake.py',
  source('deckgl-indoor-point-cloud'),
  `${dir}/points.bin`,
], { encoding: 'utf8' });
console.log(output.trim());
