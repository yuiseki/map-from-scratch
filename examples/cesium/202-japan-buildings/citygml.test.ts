import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lod1Reader, type Solid } from './citygml.ts';

const ring = (pts: number[][], z: number) => pts.map(([la, lo]) => `${la} ${lo} ${z}`).join(' ');
const sq = [[35.0, 139.0], [35.0, 139.001], [35.001, 139.001], [35.001, 139.0], [35.0, 139.0]];
const hole = [[35.0004, 139.0004], [35.0006, 139.0004], [35.0006, 139.0006], [35.0004, 139.0006], [35.0004, 139.0004]];
const poly = (ext: string, ints: string[] = []) =>
  `<gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${ext}</gml:posList></gml:LinearRing></gml:exterior>${ints.map((i) => `<gml:interior><gml:LinearRing><gml:posList>${i}</gml:posList></gml:LinearRing></gml:interior>`).join('')}</gml:Polygon></gml:surfaceMember>`;
const wall = `${sq[0].join(' ')} 3.5 ${sq[1].join(' ')} 3.5 ${sq[1].join(' ')} 17.5 ${sq[0].join(' ')} 17.5 ${sq[0].join(' ')} 3.5`;

const xml = `<?xml version="1.0"?><core:CityModel>
<app:appearanceMember><app:textureCoordinates ring="#x">0.1 0.2</app:textureCoordinates></app:appearanceMember>
<core:cityObjectMember><bldg:Building gml:id="b1"><bldg:measuredHeight uom="m">14.0</bldg:measuredHeight>
<bldg:lod0RoofEdge><gml:MultiSurface>${poly(ring(sq, 17.5))}</gml:MultiSurface></bldg:lod0RoofEdge>
<bldg:lod1Solid><gml:Solid><gml:exterior><gml:CompositeSurface>${poly(ring(sq, 3.5), [ring(hole, 3.5)])}${poly(wall)}${poly(ring(sq, 17.5))}</gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod1Solid>
<bldg:boundedBy><bldg:WallSurface><bldg:lod2MultiSurface>${poly(ring(sq, 99))}</bldg:lod2MultiSurface></bldg:WallSurface></bldg:boundedBy>
</bldg:Building></core:cityObjectMember>
<core:cityObjectMember><bldg:Building gml:id="b2"><bldg:consistsOfBuildingPart><bldg:BuildingPart gml:id="p1">
<bldg:lod1Solid><gml:Solid><gml:exterior><gml:CompositeSurface>${poly(ring(sq, 10))}${poly(ring(sq, 250.25))}</gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod1Solid>
</bldg:BuildingPart></bldg:consistsOfBuildingPart></bldg:Building></core:cityObjectMember>
<core:cityObjectMember><bldg:Building gml:id="b3"><bldg:lod0RoofEdge><gml:MultiSurface>${poly(ring(sq, 5))}</gml:MultiSurface></bldg:lod0RoofEdge></bldg:Building></core:cityObjectMember>
</core:CityModel>`;

function readAll(chunk: number): Solid[] {
  const out: Solid[] = [];
  const r = new Lod1Reader((s) => out.push(s));
  for (let i = 0; i < xml.length; i += chunk) r.push(xml.slice(i, i + chunk));
  r.end();
  return out;
}

test('a LOD1 solid becomes its bottom footprint (with the courtyard) and its height', () => {
  // The roof polygon here has no courtyard, so only the bottom face gives two rings.
  const [b1] = readAll(1 << 20);
  assert.equal(b1.id, 'b1');
  assert.equal(b1.rings.length, 2, 'exterior and interior ring');
  assert.equal(b1.rings[0].length, 4, 'closing point dropped');
  assert.deepEqual(b1.rings[0][1], [35.0, 139.001]);
  assert.ok(Math.abs(b1.height - 14) < 1e-9 && Math.abs(b1.base - 3.5) < 1e-9);
});

test('a building made of parts yields each part; a building without LOD1 yields nothing; LOD2 is ignored', () => {
  const all = readAll(1 << 20);
  assert.deepEqual(all.map((s) => s.id), ['b1', 'p1']);
  assert.ok(Math.abs(all[1].height - 240.25) < 1e-9);
});

test('the same result whatever the chunk boundaries', () => {
  const ref = JSON.stringify(readAll(1 << 20));
  for (const n of [1, 7, 64, 333]) assert.equal(JSON.stringify(readAll(n)), ref, `chunks of ${n}`);
});
