export function frameIntervals(callbackTimestamps: readonly number[]): number[] {
  return callbackTimestamps.slice(1).map((timestamp, index) => timestamp - callbackTimestamps[index]!);
}
