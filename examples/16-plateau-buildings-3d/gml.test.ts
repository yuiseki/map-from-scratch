import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GmlReader } from './gml.ts';

test('streaming CityGML reader preserves buildings and polygons across arbitrary chunk boundaries', () => {
  const buildings: { id: string; lod1: number[][][]; lod2: number[][][]; inst: number[][][] }[] = [];
  const xml = '<bldg:Building gml:id="b-1"><bldg:lod1Solid><gml:Polygon><gml:posList>35 139 4 35 140 4</gml:posList></gml:Polygon></bldg:lod1Solid><bldg:boundedBy><bldg:RoofSurface><bldg:lod2MultiSurface><gml:Polygon><gml:posList>36 139 8 36 140 8</gml:posList></gml:Polygon></bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy><bldg:BuildingInstallation><bldg:lod2Geometry><gml:MultiSurface><gml:Polygon><gml:posList>37 139 9</gml:posList></gml:Polygon></gml:MultiSurface></bldg:lod2Geometry></bldg:BuildingInstallation></bldg:Building>';
  const reader = new GmlReader((building) => buildings.push(building));
  for (let i = 0; i < xml.length; i += 7) reader.push(xml.slice(i, i + 7));
  // The input ends right after </bldg:Building>: end() must read it.
  reader.end();

  assert.equal(reader.posLists, 3);
  assert.deepEqual(buildings, [{
    id: 'b-1',
    lod1: [[ [35, 139, 4, 35, 140, 4] ]],
    lod2: [[ [36, 139, 8, 36, 140, 8] ]],
    inst: [[ [37, 139, 9] ]],
  }]);
});

test('reader reports input truncated inside a position list', () => {
  const reader = new GmlReader();
  reader.push('<gml:posList>1 2 3');
  assert.throws(() => reader.end(), /ended inside a posList/);
});

test('triangle position lists are sent to the triangle callback outside polygons', () => {
  const triangles: number[][] = [];
  const reader = new GmlReader(undefined, (triangle) => triangles.push(triangle));
  reader.push('<gml:Triangle><gml:posList>1 2 3 4 5 6</gml:posList></gml:Triangle>');
  reader.end();
  assert.deepEqual(triangles, [[1, 2, 3, 4, 5, 6]]);
});
