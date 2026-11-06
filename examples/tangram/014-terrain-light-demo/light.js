import { sunColor } from './look.js';
export const lightDir = (az, alt)=>[
        Math.sin(az) * Math.cos(alt),
        Math.cos(az) * Math.cos(alt),
        Math.sin(alt)
    ];
export const SUN_DAY_MS = 20000, SUN_MAX_ALT = 55 * Math.PI / 180;
export function sunAt(phase) {
    const alt = Math.max(Math.PI / 180, SUN_MAX_ALT * Math.sin(Math.PI * phase));
    return {
        az: Math.PI / 2 + Math.PI * phase,
        alt,
        color: sunColor(alt)
    };
}
export const sunPhase = (now, start, startPhase, day = SUN_DAY_MS)=>((startPhase + (now - start) / day) % 1 + 1) % 1;
export const SHADOW_STEPS = 96;
export const marchGrowth = (steps, maxDist)=>maxDist ** (1 / (steps - 1));
