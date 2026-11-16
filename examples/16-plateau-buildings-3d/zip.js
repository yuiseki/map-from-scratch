export const TAIL = 65536;
const u64 = (dv, o)=>dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 2 ** 32;
export function endRecord(tail, size) {
    const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let i = tail.byteLength - 22;
    while(i >= 0 && dv.getUint32(i, true) !== 0x06054b50)i--;
    if (i < 0) throw new Error('zip: no end of central directory in the tail');
    let end = {
        cdOff: dv.getUint32(i + 16, true),
        cdLen: dv.getUint32(i + 12, true),
        count: dv.getUint16(i + 10, true)
    };
    if (end.cdOff === 0xffffffff || end.cdLen === 0xffffffff || end.count === 0xffff) {
        const loc = i - 20;
        if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) throw new Error('zip: ZIP64 locator missing');
        const at = u64(dv, loc + 8) - (size - tail.byteLength);
        if (at < 0 || dv.getUint32(at, true) !== 0x06064b50) throw new Error('zip: ZIP64 end record outside the tail');
        end = {
            count: u64(dv, at + 32),
            cdLen: u64(dv, at + 40),
            cdOff: u64(dv, at + 48)
        };
    }
    return end;
}
export function entries(cd) {
    const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const dec = new TextDecoder();
    const out = [];
    for(let p = 0; p + 46 <= cd.byteLength && dv.getUint32(p, true) === 0x02014b50;){
        const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
        const e = {
            name: dec.decode(cd.subarray(p + 46, p + 46 + nameLen)),
            method: dv.getUint16(p + 10, true),
            crc: dv.getUint32(p + 16, true),
            compSize: dv.getUint32(p + 20, true),
            size: dv.getUint32(p + 24, true),
            headerOff: dv.getUint32(p + 42, true),
            extraLen
        };
        for(let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen;){
            const id = dv.getUint16(x, true), len = dv.getUint16(x + 2, true);
            if (id === 1) {
                let q = x + 4;
                if (e.size === 0xffffffff) {
                    e.size = u64(dv, q);
                    q += 8;
                }
                if (e.compSize === 0xffffffff) {
                    e.compSize = u64(dv, q);
                    q += 8;
                }
                if (e.headerOff === 0xffffffff) e.headerOff = u64(dv, q);
            }
            x += 4 + len;
        }
        out.push(e);
        p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}
export const SLACK = 1024;
export const memberRange = (e)=>[
        e.headerOff,
        e.headerOff + 30 + e.name.length * 3 + e.extraLen + SLACK + e.compSize
    ];
export function dataStart(local) {
    const dv = new DataView(local.buffer, local.byteOffset, local.byteLength);
    if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('zip: bad local header');
    return 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
}
export const meshOf = (name)=>name.match(/^udx\/bldg\/(\d{8})_bldg_6697(?:_\w+)?_op\.gml$/)?.[1] ?? null;
