export function frameIntervals(callbackTimestamps) {
    const intervals = [];
    for(let index = 1; index < callbackTimestamps.length; index++){
        intervals.push(callbackTimestamps[index] - callbackTimestamps[index - 1]);
    }
    return intervals;
}
