// A regular grid over [0,1]^2 as (u, v, skirt) vertices. The vertex shader
// turns (u, v) into a place on the globe and samples the height there; a
// skirt vertex (third component 1) hangs below its rim vertex so the gap
// between the detailed Akita mesh and the coarse world mesh is never seen.
export interface Mesh { vertices: Float32Array; indices: Uint32Array }

export function gridMesh(nx: number, ny: number, skirts: boolean): Mesh {
  const rim: number[] = [];
  const id = (i: number, j: number) => j * (nx + 1) + i;
  if (skirts) {
    for (let i = 0; i < nx; i++) rim.push(id(i, 0));
    for (let j = 0; j < ny; j++) rim.push(id(nx, j));
    for (let i = nx; i > 0; i--) rim.push(id(i, ny));
    for (let j = ny; j > 0; j--) rim.push(id(0, j));
  }
  const nv = (nx + 1) * (ny + 1);
  const vertices = new Float32Array((nv + rim.length) * 3);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const k = id(i, j) * 3;
    vertices[k] = i / nx; vertices[k + 1] = j / ny;
  }
  rim.forEach((r, n) => {
    vertices.set([vertices[r * 3], vertices[r * 3 + 1], 1], (nv + n) * 3);
  });
  const indices = new Uint32Array((nx * ny + rim.length) * 6);
  let p = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
    indices.set([a, b, c, b, d, c], p); p += 6;
  }
  // Each rim edge (r0 -> r1) with its two skirt vertices: a vertical quad.
  for (let n = 0; n < rim.length; n++) {
    const r0 = rim[n], r1 = rim[(n + 1) % rim.length], s0 = nv + n, s1 = nv + ((n + 1) % rim.length);
    indices.set([r0, s0, r1, r1, s0, s1], p); p += 6;
  }
  return { vertices, indices };
}
