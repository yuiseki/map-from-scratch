import { sweep } from './sweep.js';
import { toEcef, LAND_LIFT_KM } from './land.js';
export const TUBE_RADIUS_KM = 0.8;
export const MIN_PX = 2;
export const MITRE_LIMIT = 2;
export const ROUND_STEP_DEG = 15;
export function tubeMesh(lines, shape, corner, origin) {
    const xyz = lines.map((l)=>{
        const out = new Float64Array(l.length / 2 * 3);
        for(let i = 0; i < l.length / 2; i++)out.set(toEcef(l[2 * i], l[2 * i + 1], LAND_LIFT_KM + TUBE_RADIUS_KM), i * 3);
        return out;
    });
    return sweep(xyz, {
        radius: TUBE_RADIUS_KM,
        shape,
        corner,
        mitreLimit: MITRE_LIMIT,
        roundStepDeg: ROUND_STEP_DEG,
        origin
    });
}
