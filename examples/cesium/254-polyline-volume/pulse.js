export const TIME_SCALE = 360;
export const PULSE_GAP_KM = 40;
export const PULSE_SIGMA_KM = 5;
export function pulseHead(tSec, speedKmh, lengthKm) {
    const km = tSec * speedKmh * TIME_SCALE / 3600;
    return km % (lengthKm + 2 * PULSE_GAP_KM) - PULSE_GAP_KM;
}
export function pulseGlow(along, head) {
    const d = (along - head) / PULSE_SIGMA_KM;
    return Math.exp(-0.5 * d * d);
}
