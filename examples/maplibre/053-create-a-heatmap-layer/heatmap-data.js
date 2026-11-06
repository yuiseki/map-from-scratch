export function decodeHeatmapData(buffer) {
    const count = new Uint32Array(buffer, 4, 1)[0];
    return {
        count,
        points: new Float32Array(buffer, 8, count * 3)
    };
}
