import { decodeDensityData } from '../../04-osm-node-density/decode.js';
export function decodePackedDensity(buffer, stride = 128) {
    const { count, bbox, positions } = decodeDensityData(buffer, stride);
    const points = new Uint32Array(count);
    for(let i = 0; i < count; i++)points[i] = positions[i * 2] | positions[i * 2 + 1] << 16;
    return {
        count,
        bbox,
        points
    };
}
