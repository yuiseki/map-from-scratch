export function flipReliefY(elevationM, seaLevelY, pixelsPerMeter) {
    return seaLevelY + elevationM * pixelsPerMeter;
}
export function depthSectionY(depthKm, seaLevelY, pixelsPerKm) {
    if (!Number.isFinite(depthKm) || depthKm < 0) throw new RangeError('Hypocenter depth must be non-negative');
    return seaLevelY + depthKm * pixelsPerKm;
}
export function sampleIndex(index, inputCount, outputCount) {
    if (inputCount < 2 || outputCount < 2 || index < 0 || index >= outputCount) throw new RangeError('Invalid sample index or count');
    return Math.round(index * (inputCount - 1) / (outputCount - 1));
}
export function sectionDistanceKm(west, east, latitude) {
    return (east - west) * 111.32 * Math.cos(latitude * Math.PI / 180);
}
export function validateProfile(data) {
    if (!(data.west < data.east) || data.elevations.length < 2 || !Number.isFinite(data.latitude)) throw new Error('Invalid GEBCO section metadata');
    if (!data.elevations.every(Number.isFinite)) throw new Error('Invalid GEBCO elevations');
    for (const event of data.events){
        if (event.lon < data.west || event.lon > data.east || event.depthKm < 0 || !Number.isFinite(event.magnitude)) throw new Error('Invalid USGS hypocenter');
    }
}
