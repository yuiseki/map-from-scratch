export function decodeClusterPoints(buffer) {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x31305145) throw new Error('invalid earthquake data');
    const count = view.getUint32(4, true);
    if (buffer.byteLength !== 16 + count * 16) throw new Error('truncated earthquake data');
    const points = new Array(count);
    for(let i = 0; i < count; i++){
        const at = 16 + i * 16;
        points[i] = {
            x: view.getFloat32(at, true),
            y: view.getFloat32(at + 4, true),
            mag: view.getFloat32(at + 8, true),
            tsunami: view.getUint32(at + 12, true) === 1
        };
    }
    return points;
}
export function buildClusterLevels(points, maxZoom = 14) {
    const levels = [];
    for(let z = 0; z <= maxZoom; z++){
        const scale = 512 * 2 ** z / 50;
        const bins = new Map();
        for(let i = 0; i < points.length; i++){
            const p = points[i];
            const key = `${Math.floor(p.x * scale)}:${Math.floor(p.y * scale)}`;
            const cell = bins.get(key);
            if (cell) {
                cell.x += p.x;
                cell.y += p.y;
                cell.count++;
            } else bins.set(key, {
                x: p.x,
                y: p.y,
                count: 1,
                first: i
            });
        }
        levels.push([
            ...bins.values()
        ].map((c)=>({
                ...c,
                x: c.x / c.count,
                y: c.y / c.count
            })));
    }
    levels.push(points.map((p, i)=>({
            x: p.x,
            y: p.y,
            count: 1,
            first: i
        })));
    return levels;
}
export const clusterRadius = (count)=>count === 1 ? 5 : count < 100 ? 20 : count < 750 ? 30 : 40;
