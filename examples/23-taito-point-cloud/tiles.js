function neighborhood(z, mercatorX, mercatorY, radius) {
    const centerX = Math.floor(mercatorX * 2 ** z), centerY = Math.floor(mercatorY * 2 ** z);
    const list = [];
    for(let dy = -radius; dy <= radius; dy++)for(let dx = -radius; dx <= radius; dx++){
        list.push({
            z,
            x: centerX + dx,
            y: centerY + dy
        });
    }
    list.sort((a, b)=>Math.hypot(a.x - centerX, a.y - centerY) - Math.hypot(b.x - centerX, b.y - centerY));
    return list;
}
export function planTiles(z, mercatorX, mercatorY, zoomIn) {
    const visible = neighborhood(z, mercatorX, mercatorY, 2);
    const neighbors = zoomIn ? [
        z + 1,
        z - 1
    ] : [
        z - 1,
        z + 1
    ];
    const prefetch = neighbors.filter((level)=>level >= 14 && level <= 20).flatMap((level)=>neighborhood(level, mercatorX, mercatorY, 1));
    return {
        visible,
        prefetch
    };
}
export function fallbackTiles(missing, available) {
    const result = [], seen = new Set();
    const add = (z, x, y)=>{
        const key = `${z}/${x}/${y}`;
        if (!seen.has(key) && available(z, x, y)) {
            seen.add(key);
            result.push({
                z,
                x,
                y
            });
            return true;
        }
        return seen.has(key);
    };
    for (const { z, x, y } of missing){
        if (z > 14 && add(z - 1, Math.floor(x / 2), Math.floor(y / 2))) continue;
        if (z < 20) for(let dy = 0; dy < 2; dy++)for(let dx = 0; dx < 2; dx++)add(z + 1, x * 2 + dx, y * 2 + dy);
    }
    return result;
}
