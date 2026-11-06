export function decode(buffer) {
    const data = new DataView(buffer);
    if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'GED1') throw new Error('GED data version mismatch');
    const count = data.getUint32(4, true);
    if (buffer.byteLength !== 8 + count * 18) throw new Error('GED data size mismatch');
    const rows = [];
    for(let i = 0, at = 8; i < count; i++, at += 18)rows.push({
        x: data.getUint16(at, true),
        y: data.getUint16(at + 2, true),
        deaths: data.getUint32(at + 4, true),
        id: data.getUint32(at + 8, true),
        day: data.getUint16(at + 12, true),
        type: data.getUint8(at + 14),
        precision: data.getUint8(at + 15),
        country: data.getUint16(at + 16, true)
    });
    return rows;
}
