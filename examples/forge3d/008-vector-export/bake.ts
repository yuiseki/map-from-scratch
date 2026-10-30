import { mkdirSync, writeFileSync } from 'node:fs';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const toMerc = ([lon, lat]: [number, number]): [number, number] => [
  Number(mercX(lon).toFixed(6)),
  Number(mercY(lat).toFixed(6)),
];

// Same rail geometry as the forge3d-004 example, baked separately so this
// renderer stands alone.
const boundary: [number, number][] = [
  [6.02, 50.18], [6.13, 50.14], [6.15, 49.95], [6.36, 49.80],
  [6.53, 49.73], [6.40, 49.53], [6.36, 49.46], [6.03, 49.44],
  [5.90, 49.50], [5.74, 49.53], [5.89, 49.66], [5.73, 49.81],
  [5.83, 49.95], [6.02, 50.18],
];

const rails: [number, number][][] = [
  [[6.133, 49.600], [6.140, 49.700], [6.103, 49.847], [6.040, 49.980], [6.000, 50.120], [5.940, 50.180]],
  [[6.133, 49.600], [6.115, 49.560], [6.101, 49.518], [6.085, 49.480]],
  [[6.101, 49.518], [6.050, 49.510], [5.981, 49.495], [5.900, 49.520], [5.840, 49.545]],
  [[6.133, 49.600], [6.250, 49.640], [6.386, 49.700], [6.502, 49.715]],
  [[6.133, 49.600], [6.050, 49.620], [5.914, 49.643]],
  [[6.103, 49.847], [6.160, 49.868]],
];

const stations = [
  { name: 'Luxembourg', pos: [6.133, 49.600] as [number, number] },
  { name: 'Bettembourg', pos: [6.101, 49.518] as [number, number] },
  { name: 'Esch-sur-Alzette', pos: [5.981, 49.495] as [number, number] },
  { name: 'Ettelbruck', pos: [6.103, 49.847] as [number, number] },
  { name: 'Wasserbillig', pos: [6.502, 49.715] as [number, number] },
  { name: 'Troisvierges', pos: [6.000, 50.120] as [number, number] },
];

const data = {
  title: 'Luxembourg rail network',
  boundary: boundary.map(toMerc),
  rails: rails.map((line) => line.map(toMerc)),
  stations: stations.map((s) => ({ name: s.name, pos: toMerc(s.pos) })),
};

const dir = 'data/baked/forge3d-008-vector-export';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/luxembourg.json`, JSON.stringify(data));
console.log(`Baked Luxembourg rail network for SVG export -> ${dir}`);
