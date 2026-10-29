import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import earcut from '../../../vendor/earcut/earcut.js';
import { source } from '../../../tools/sources.ts';

type Feature = { geometry: { type: 'Polygon'; coordinates: number[][][] }; properties: { valuePerSqm: number; growth: number } };
const input = JSON.parse(readFileSync(source('deckgl-vancouver-blocks'), 'utf8')) as { features: Feature[] };
const id = 'deckgl-007-geojson-layer-polygons';
const dir = `data/baked/${id}`;
mkdirSync(dir, { recursive: true });
const R = 6378137, lon0 = -123.13, lat0 = 49.254;
const cosLat = Math.cos(lat0 * Math.PI / 180);
const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const y0 = mercY(lat0);
const xy = ([lon, lat]: number[]): [number, number] => [(lon - lon0) * Math.PI / 180 * R * cosLat, (mercY(lat) - y0) * cosLat];
const thresholds = [-0.6,-0.45,-0.3,-0.15,0,0.15,0.3,0.45,0.6,0.75,0.9,1.05,1.2];
type Vertex = [number, number, number, number, number, number];
const vertices: Vertex[] = [];
const records: number[][] = [];
let topTriangles = 0, wallTriangles = 0;
const push = (x: number, y: number, z: number, color: number, light: number, feature: number) => {
  const qx = Math.round(x * 2), qy = Math.round(y * 2), qz = Math.round(z * 5);
  if (qx < -32768 || qx > 32767 || qy < -32768 || qy > 32767 || qz < 0 || qz > 65535) throw new Error(`coordinate outside packed range: ${qx},${qy},${qz}`);
  vertices.push([qx,qy,qz,color,light,feature]);
};
for (const [featureId, feature] of input.features.entries()) {
  if (feature.geometry.type !== 'Polygon') throw new Error('unexpected geometry type');
  const value = feature.properties.valuePerSqm;
  const growth = feature.properties.growth;
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(growth)) throw new Error(`invalid properties ${featureId}`);
  const z = Math.sqrt(value) * 10;
  const color = thresholds.filter((threshold) => growth >= threshold).length;
  const rings = feature.geometry.coordinates.map((ring) => {
    const open = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
    return open.map(xy);
  }).filter((ring) => ring.length >= 3);
  const flat: number[] = [], holes: number[] = [], points: [number, number][] = [];
  for (const [ringIndex, ring] of rings.entries()) {
    if (ringIndex) holes.push(points.length);
    for (const p of ring) { points.push(p); flat.push(p[0], p[1]); }
  }
  const triangles = earcut(flat, holes, 2);
  for (const vertexIndex of triangles) {
    const [x,y] = points[vertexIndex]; push(x,y,z,color,255,featureId + 1);
  }
  topTriangles += triangles.length / 3;
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const light = Math.round(115 + 100 * Math.max(0, (dy * 0.5 - dx * 0.7) / Math.max(1, Math.hypot(dx,dy))));
    push(a[0],a[1],0,color,light,featureId + 1);
    push(b[0],b[1],0,color,light,featureId + 1);
    push(b[0],b[1],z,color,light,featureId + 1);
    push(a[0],a[1],0,color,light,featureId + 1);
    push(b[0],b[1],z,color,light,featureId + 1);
    push(a[0],a[1],z,color,light,featureId + 1);
    wallTriangles += 2;
  }
  records.push([value,growth]);
}
const out = Buffer.allocUnsafe(12 + vertices.length * 10);
out.write('VP01',0,'ascii'); out.writeUInt32LE(vertices.length,4); out.writeUInt32LE(records.length,8);
vertices.forEach(([x,y,z,color,light,feature],i) => {
  const at = 12 + i*10;
  out.writeInt16LE(x,at); out.writeInt16LE(y,at+2); out.writeUInt16LE(z,at+4);
  out[at+6]=color; out[at+7]=light; out.writeUInt16LE(feature,at+8);
});
writeFileSync(`${dir}/mesh.bin`,out);
writeFileSync(`${dir}/values.json`,JSON.stringify(records));
console.log(`${records.length} blocks, ${topTriangles} roof triangles, ${wallTriangles} wall triangles, ${vertices.length} vertices, ${out.length} bytes`);
