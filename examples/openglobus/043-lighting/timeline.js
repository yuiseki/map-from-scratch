export const PLAY_HOURS_PER_SECOND = 2;
const MAX_STEP_S = 0.25;
export function advance(ms, dtSeconds, hoursPerSecond) {
    return ms + Math.min(MAX_STEP_S, Math.max(0, dtSeconds)) * hoursPerSecond * 3600_000;
}
export function minuteOfDay(ms) {
    return Math.floor((ms % 86400_000 + 86400_000) % 86400_000 / 60_000);
}
export function withMinute(ms, minute) {
    const day = Math.floor(ms / 86400_000) * 86400_000;
    return day + minute * 60_000;
}
export function formatUtc(ms) {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
