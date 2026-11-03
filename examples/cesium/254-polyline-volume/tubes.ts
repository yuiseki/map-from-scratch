// From baked lon/lat centrelines to the swept mesh the renderer draws.
import { sweep, type Shape, type Corner, type Mesh } from './sweep.ts';
import { toEcef, LAND_LIFT_KM } from './land.ts';

export const TUBE_RADIUS_KM = 0.8;
export const MIN_PX = 2;            // the tube is never thinner than this radius on screen
export const MITRE_LIMIT = 2;
export const ROUND_STEP_DEG = 15;

// The tube rests on the land: its centre is one radius above it.
export function tubeMesh(lines: Float64Array[], shape: Shape, corner: Corner, origin: number[]): Mesh {
  const xyz = lines.map((l) => {
    const out = new Float64Array((l.length / 2) * 3);
    for (let i = 0; i < l.length / 2; i++) out.set(toEcef(l[2 * i], l[2 * i + 1], LAND_LIFT_KM + TUBE_RADIUS_KM), i * 3);
    return out;
  });
  return sweep(xyz, { radius: TUBE_RADIUS_KM, shape, corner, mitreLimit: MITRE_LIMIT, roundStepDeg: ROUND_STEP_DEG, origin });
}
