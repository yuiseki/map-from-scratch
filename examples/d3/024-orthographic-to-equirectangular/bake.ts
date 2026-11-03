import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import '../005-world-map/bake.ts';
import { encodeGrayPng, rasterizePolygons, type LandPolygons } from '../../../tools/land-mask.ts';

const polygons = JSON.parse(readFileSync('data/baked/d3-005-world-map/land.json', 'utf8')) as LandPolygons;
const width = 1024, height = 512;
const mask = rasterizePolygons(polygons, width, height);
const png = encodeGrayPng(width, height, mask);
const out = 'data/baked/d3-024-orthographic-to-equirectangular/land.png';
mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true });
writeFileSync(out, png);
console.log(`${width}x${height} grayscale land mask (${png.length} bytes) -> ${out}`);
