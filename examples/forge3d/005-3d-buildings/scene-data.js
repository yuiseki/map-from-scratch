export function parseMesh(buf, buildings) {
    const dv = new DataView(buf);
    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'BAG3') throw new Error('buildings.bin: bad magic');
    const nv = dv.getUint32(8, true), ni = dv.getUint32(12, true);
    const lo = [
        0,
        1,
        2
    ].map((k)=>dv.getFloat64(20 + k * 8, true));
    const step = [
        0,
        1,
        2
    ].map((k)=>dv.getFloat32(44 + k * 4, true));
    const vertices = new Uint16Array(buf, 64, nv * 4);
    const indices = new Uint16Array(buf, 64 + nv * 8, ni);
    const half = [
        step[0] * 32767.5,
        step[1] * 32767.5
    ];
    const grounds = buildings.map((b)=>b.ground).filter((g)=>g !== null).sort((a, b)=>a - b);
    return {
        vertices,
        indices,
        lo,
        step,
        origin: [
            -half[0],
            -half[1],
            lo[2]
        ],
        groundZ: grounds[grounds.length >> 1] - 0.05,
        extent: Math.max(half[0], half[1]) + 80
    };
}
