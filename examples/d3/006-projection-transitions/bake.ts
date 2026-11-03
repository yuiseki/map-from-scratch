import { copyFileSync, mkdirSync } from 'node:fs';
import '../005-world-map/bake.ts';
const out = 'data/baked/d3-006-projection-transitions';
mkdirSync(out, { recursive: true });
copyFileSync('data/baked/d3-005-world-map/land.json', `${out}/land.json`);
console.log(`Natural Earth land texture input -> ${out}/land.json`);
