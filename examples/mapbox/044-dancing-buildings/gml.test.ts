import test from 'node:test';
import assert from 'node:assert/strict';
import { Lod1Reader, type Lod1Building } from './gml.ts';

const ring = (z: number) => `<gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>35.0 139.0 ${z} 35.0 139.001 ${z} 35.001 139.001 ${z} 35.0 139.0 ${z}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;
const doc = `<core:CityModel>
<bldg:Building gml:id="bldg_a"><gml:name>丸の内ビル</gml:name>
 <bldg:measuredHeight uom="m">35.5</bldg:measuredHeight>
 <bldg:boundedBy><bldg:RoofSurface><bldg:lod2MultiSurface>${ring(99)}</bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy>
 <bldg:lod1Solid><gml:Solid><gml:exterior><gml:CompositeSurface>
  <gml:surfaceMember>${ring(4.1)}</gml:surfaceMember>
  <gml:surfaceMember>${ring(39.6)}</gml:surfaceMember>
 </gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod1Solid>
</bldg:Building>
<bldg:Building gml:id="bldg_b"><bldg:lod1Solid>${ring(2)}</bldg:lod1Solid></bldg:Building>
</core:CityModel>`;

function readAll(chunkSize: number): Lod1Building[] {
  const out: Lod1Building[] = [];
  const r = new Lod1Reader((b) => out.push(b));
  for (let i = 0; i < doc.length; i += chunkSize) r.push(doc.slice(i, i + chunkSize));
  r.end();
  return out;
}

test('reads id, name, measured height and only the lod1Solid polygons', () => {
  const [a, b] = readAll(doc.length);
  assert.equal(a.id, 'bldg_a');
  assert.equal(a.name, '丸の内ビル');
  assert.equal(a.measuredHeight, 35.5);
  assert.equal(a.lod1.length, 2, 'the lod2 roof is not a lod1 polygon');
  assert.deepEqual(a.lod1.map((p) => p[0][2]), [4.1, 39.6]);
  assert.equal(b.id, 'bldg_b');
  assert.equal(b.measuredHeight, null);
  assert.equal(b.name, null);
  assert.equal(b.lod1.length, 1);
});

test('gives the same result whatever the chunk boundaries', () => {
  const whole = JSON.stringify(readAll(doc.length));
  for (const n of [1, 7, 13, 64]) assert.equal(JSON.stringify(readAll(n)), whole, `chunk ${n}`);
});
