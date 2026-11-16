export const mercX = (lon)=>(lon + 180) / 360;
export const mercY = (lat)=>{
    const s = Math.sin(lat * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
export const lonOfX = (x)=>x * 360 - 180;
export const latOfY = (y)=>Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
export function tileBounds(z, x, y) {
    const n = 2 ** z;
    return [
        lonOfX(x / n),
        latOfY(y / n),
        lonOfX((x + 1) / n),
        latOfY((y + 1) / n)
    ];
}
export const HEIGHT_STEP = 0.25;
export const HEIGHT_OFFSET = 500;
export function encodeHeight(h) {
    const v = Math.max(0, Math.min(65535, Math.round((h + HEIGHT_OFFSET) / HEIGHT_STEP)));
    return [
        v >> 8,
        v & 255
    ];
}
export const decodeHeight = (r, g)=>(r * 256 + g) * HEIGHT_STEP - HEIGHT_OFFSET;
export const decodeTerrarium = (r, g, b)=>r * 256 + g + b / 256 - 32768;
export function heightsFromRGBA(rgba, w, h) {
    const out = new Float32Array(w * h);
    for(let i = 0; i < w * h; i++)out[i] = decodeHeight(rgba[4 * i], rgba[4 * i + 1]);
    return out;
}
