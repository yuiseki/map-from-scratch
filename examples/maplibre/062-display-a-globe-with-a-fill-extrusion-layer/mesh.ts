// Load-time: one vertex buffer and one index buffer for the ocean, the
// lids and the walls. Each vertex is four int16: lon and lat in 0.01
// degree, the country id (OCEAN_ID for the sea) and whether it sits on the
// lid (1) or the surface (0). The vertex shader turns these into a position
// on the sphere or the plane, so the same buffer serves both views.
//
// Walls are not shipped: they are the consecutive vertices of each ring,
// rebuilt here (pattern "do not ship what can be rebuilt", example 02).
import type { Countries } from './format.ts';

export const OCEAN_ID = -1;
export const OCEAN_STEP = 3; // degrees; the limb is a 120-gon, 0.05 px off a circle at 300 px

export interface Mesh {
  verts: Int16Array; idx: Uint32Array;
  oceanFirstIndex: number; oceanTriangles: number;
  lidFirstVertex: number; lidFirstIndex: number; lidTriangles: number;
  wallFirstVertex: number; wallFirstIndex: number; wallTriangles: number;
}

// An edge Natural Earth made by cutting a ring at 180 degrees or closing it
// along a pole: a wall there would stand inside the land.
function isCut(alon: number, alat: number, blon: number, blat: number): boolean {
  return (alon === blon && Math.abs(alon) === 18000) || (alat === blat && Math.abs(alat) === 9000);
}

export function buildMesh(c: Countries): Mesh {
  const cols = 360 / OCEAN_STEP, rows = 180 / OCEAN_STEP;
  const nOcean = (cols + 1) * (rows + 1);
  let nWalls = 0;
  for (let r = 0, o = 0; r < c.ringLen.length; o += c.ringLen[r++]) {
    const n = c.ringLen[r];
    for (let i = 0; i < n; i++) {
      const a = o + i, b = o + ((i + 1) % n);
      if (!isCut(c.ringLon[a], c.ringLat[a], c.ringLon[b], c.ringLat[b])) nWalls++;
    }
  }
  const nv = nOcean + c.lon.length + 4 * nWalls;
  const verts = new Int16Array(4 * nv);
  const idx = new Uint32Array(6 * cols * rows + c.idx.length + 6 * nWalls);
  let v = 0, k = 0;
  const put = (lon: number, lat: number, id: number, top: number) => {
    verts[4 * v] = lon; verts[4 * v + 1] = lat; verts[4 * v + 2] = id; verts[4 * v + 3] = top; return v++;
  };

  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) put(-18000 + i * OCEAN_STEP * 100, -9000 + j * OCEAN_STEP * 100, OCEAN_ID, 0);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, d = a + cols + 1, e = d + 1;
      idx.set([a, b, d, b, e, d], k); k += 6;
    }
  }

  const lidFirstVertex = v, lidFirstIndex = k;
  for (let i = 0; i < c.lon.length; i++) put(c.lon[i], c.lat[i], c.id[i], 1);
  for (let i = 0; i < c.idx.length; i++) idx[k++] = lidFirstVertex + c.idx[i];

  const wallFirstVertex = v, wallFirstIndex = k;
  for (let r = 0, o = 0; r < c.ringLen.length; o += c.ringLen[r++]) {
    const n = c.ringLen[r], id = c.ringId[r];
    for (let i = 0; i < n; i++) {
      const a = o + i, b = o + ((i + 1) % n);
      const al = c.ringLon[a], at = c.ringLat[a], bl = c.ringLon[b], bt = c.ringLat[b];
      if (isCut(al, at, bl, bt)) continue;
      const p = put(al, at, id, 0); put(bl, bt, id, 0); put(al, at, id, 1); put(bl, bt, id, 1);
      // The last vertex of each triangle is a bottom one (top 0): WebGL's
      // provoking vertex, so the fragment shader's flat 'top' tells a wall
      // from a lid.
      idx.set([p + 2, p + 1, p, p + 3, p + 2, p + 1], k); k += 6;
    }
  }
  return {
    verts, idx,
    oceanFirstIndex: 0, oceanTriangles: 2 * cols * rows,
    lidFirstVertex, lidFirstIndex, lidTriangles: c.idx.length / 3,
    wallFirstVertex, wallFirstIndex, wallTriangles: 2 * nWalls,
  };
}
