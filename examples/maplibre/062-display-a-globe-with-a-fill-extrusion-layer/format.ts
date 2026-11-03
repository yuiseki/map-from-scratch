// countries.bin: what the renderer receives. Coordinates are lon/lat in
// 0.01 degree (int16 holds +-180 and +-90), each stored as the difference
// from the previous one, wrapping mod 2^16, so gzip sees small repeating
// numbers. Little endian:
//   u32 nVerts, nIdx, nRingVerts, nRings
//   u32 ringLen[nRings]      walls are each ring's consecutive vertices
//   i16 idx[nIdx]            lid triangles, delta from the previous index
//                            (triangles of one grid cell are numbered together,
//                            so the jumps stay small: 219 at most in the bake)
//   i16 lon[nVerts], lat[nVerts]          lid vertices (delta)
//   i16 ringLon[nRingVerts], ringLat[...]  ring vertices (delta)
//   u16 id[nVerts], ringId[nRings]        country of each vertex / ring
// (+ u16 padding so the file length is a multiple of 4)
export interface Countries {
  lon: Int16Array; lat: Int16Array; id: Uint16Array; idx: Uint32Array;
  ringLon: Int16Array; ringLat: Int16Array; ringLen: Uint32Array; ringId: Uint16Array;
}

const delta16 = (a: Int16Array) => Int16Array.from(a, (v, i) => v - (i ? a[i - 1] : 0));
const undelta16 = (a: Int16Array) => { for (let i = 1; i < a.length; i++) a[i] += a[i - 1]; return a; };

export function encode(c: Countries): Uint8Array {
  const idx = Int16Array.from(c.idx, (v, i) => {
    const d = v - (i ? c.idx[i - 1] : 0);
    if (d < -32768 || d > 32767) throw new Error(`index jump ${d} at ${i} does not fit int16`);
    return d;
  });
  const parts: ArrayBufferView[] = [
    Uint32Array.of(c.lon.length, c.idx.length, c.ringLon.length, c.ringLen.length),
    c.ringLen, idx, delta16(c.lon), delta16(c.lat), delta16(c.ringLon), delta16(c.ringLat), c.id, c.ringId,
  ];
  const n16 = c.idx.length + 2 * c.lon.length + 2 * c.ringLon.length + c.id.length + c.ringId.length;
  if (n16 % 2) parts.push(new Uint16Array(1));
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), o); o += p.byteLength; }
  return out;
}

export function decode(buf: ArrayBuffer): Countries {
  const [nv, ni, nrv, nr] = new Uint32Array(buf, 0, 4);
  let o = 16;
  const u32 = (n: number) => { const a = new Uint32Array(buf, o, n); o += 4 * n; return a; };
  const i16 = (n: number) => { const a = new Int16Array(buf, o, n); o += 2 * n; return a; };
  const u16 = (n: number) => { const a = new Uint16Array(buf, o, n); o += 2 * n; return a; };
  const ringLen = u32(nr);
  const d = i16(ni), idx = new Uint32Array(ni);
  for (let i = 0, s = 0; i < ni; i++) idx[i] = s += d[i];
  const lon = undelta16(i16(nv)), lat = undelta16(i16(nv));
  const ringLon = undelta16(i16(nrv)), ringLat = undelta16(i16(nrv));
  return { lon, lat, idx, ringLon, ringLat, ringLen, id: u16(nv), ringId: u16(nr) };
}
