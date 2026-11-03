// Simulated time for the sun: a UTC instant in milliseconds, a slider for
// the minute of the day, and a play button that advances it.

/** Play speed: one day in 12 s. */
export const PLAY_HOURS_PER_SECOND = 2;
const MAX_STEP_S = 0.25;

export function advance(ms: number, dtSeconds: number, hoursPerSecond: number): number {
  return ms + Math.min(MAX_STEP_S, Math.max(0, dtSeconds)) * hoursPerSecond * 3600_000;
}

export function minuteOfDay(ms: number): number {
  return Math.floor((((ms % 86400_000) + 86400_000) % 86400_000) / 60_000);
}

export function withMinute(ms: number, minute: number): number {
  const day = Math.floor(ms / 86400_000) * 86400_000;
  return day + minute * 60_000;
}

export function formatUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
