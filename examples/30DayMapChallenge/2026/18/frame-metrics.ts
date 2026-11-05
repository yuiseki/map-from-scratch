export function frameIntervals(callbackTimestamps: readonly number[]): number[] {
  const intervals: number[] = [];
  for (let index = 1; index < callbackTimestamps.length; index++) {
    intervals.push(callbackTimestamps[index]! - callbackTimestamps[index - 1]!);
  }
  return intervals;
}
