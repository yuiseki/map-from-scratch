export const quakeMinutes = (timeMs: number, epochMs: number): number => (timeMs - epochMs) / 60000;
export const magnitudeByte = (magnitude: number): number => Math.max(0, Math.min(255, Math.round(magnitude * 10 - 40)));
export const depthByte = (depthKm: number): number => Math.max(0, Math.min(255, Math.round(depthKm / 3)));
