export function frameIntervals(callbackTimestamps) {
    return callbackTimestamps.slice(1).map((timestamp, index)=>timestamp - callbackTimestamps[index]);
}
