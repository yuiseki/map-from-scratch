export function parseSubgroupPoints(buffer) {
    if (buffer.byteLength < 40) throw new Error('truncated subgroup points header');
    const view = new DataView(buffer);
    const magic = view.getUint32(0, true);
    if (magic !== 0x47535542) throw new Error(`Invalid magic: 0x${magic.toString(16)}`);
    const count = view.getUint32(4, true);
    if (buffer.byteLength !== 40 + count * 4) throw new Error('truncated subgroup points');
    return {
        count,
        bounds: [
            view.getFloat64(8, true),
            view.getFloat64(16, true),
            view.getFloat64(24, true),
            view.getFloat64(32, true)
        ],
        points: new Uint8Array(buffer, 40, count * 4)
    };
}
