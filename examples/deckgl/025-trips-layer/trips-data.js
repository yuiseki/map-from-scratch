export function parseTripsBuffer(buffer, magic, stride) {
    if (buffer.byteLength < 32) throw new Error('truncated trips data');
    const head = new DataView(buffer);
    if (head.getUint32(0, true) !== magic) throw new Error('invalid trips data');
    const count = head.getUint32(4, true), objects = head.getUint32(8, true);
    if (buffer.byteLength !== 32 + count * stride) throw new Error('truncated trips data');
    return {
        buffer,
        count,
        objects,
        segments: head.getUint32(28, true),
        bounds: [
            12,
            16,
            20,
            24
        ].map((offset)=>head.getFloat32(offset, true))
    };
}
export function parseBuildingBuffer(buffer) {
    if (buffer.byteLength < 32) throw new Error('truncated building data');
    const head = new DataView(buffer);
    if (head.getUint32(0, true) !== 0x33304442) throw new Error('invalid building data');
    const count = head.getUint32(4, true), indexCount = head.getUint32(8, true);
    if (buffer.byteLength < 32 + count * 8) throw new Error('truncated building data');
    const packed = new Uint8Array(buffer, 32 + count * 8);
    const indices = new Uint16Array(indexCount);
    let offset = 0, previous = 0;
    for(let i = 0; i < indexCount; i++){
        let code = 0, shift = 0, byte = 0;
        do {
            if (offset >= packed.length || shift > 21) throw new Error('truncated building indices');
            byte = packed[offset++];
            code += (byte & 127) * 2 ** shift;
            shift += 7;
        }while (byte & 128)
        previous += code >>> 1 ^ -(code & 1);
        if (previous < 0 || previous >= count) throw new Error('invalid building index');
        indices[i] = previous;
    }
    if (offset !== packed.length) throw new Error('unexpected building index bytes');
    return {
        buffer,
        count,
        indices,
        objects: head.getUint32(28, true),
        bounds: [
            12,
            16,
            20,
            24
        ].map((offset)=>head.getFloat32(offset, true))
    };
}
