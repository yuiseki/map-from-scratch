function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function validateEvent(value) {
    if (!isRecord(value)) throw new Error('Invalid earthquake event record');
    if (typeof value.id !== 'string' || !value.id.trim()) throw new Error('Invalid event id');
    const { longitude, latitude, magnitude, depthKm, time } = value;
    if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        throw new Error('Invalid earthquake coordinate');
    }
    if (typeof magnitude !== 'number' || !Number.isFinite(magnitude) || magnitude < 4.5) throw new Error('Invalid earthquake magnitude');
    if (typeof depthKm !== 'number' || !Number.isFinite(depthKm) || depthKm < 0) throw new Error('Invalid earthquake depth');
    if (typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0) throw new Error('Invalid earthquake time');
    return {
        id: value.id,
        longitude,
        latitude,
        magnitude,
        depthKm,
        time
    };
}
export function projectLongitudeLatitude(longitude, latitude, centerLongitude = 0) {
    if (![
        longitude,
        latitude,
        centerLongitude
    ].every(Number.isFinite) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90 || centerLongitude < -180 || centerLongitude > 180) throw new RangeError('Invalid longitude/latitude projection input');
    let delta = longitude - centerLongitude;
    delta = ((delta + 180) % 360 + 360) % 360 - 180;
    if (delta === -180 && longitude - centerLongitude > 0) delta = 180;
    return {
        x: delta / 360,
        y: 0.5 - latitude / 360
    };
}
export function projectToScreen(point, camera) {
    if (![
        point.x,
        point.y,
        camera.centerX,
        camera.centerY,
        camera.scale,
        camera.width,
        camera.height
    ].every(Number.isFinite) || camera.scale <= 0 || camera.width <= 0 || camera.height <= 0) throw new RangeError('Invalid projected screen coordinate or camera');
    return [
        camera.width / 2 + (point.x - camera.centerX) * camera.scale,
        camera.height / 2 + (point.y - camera.centerY) * camera.scale
    ];
}
export function seismicGlyph(magnitude, depthKm) {
    if (!Number.isFinite(magnitude) || magnitude < 4.5 || !Number.isFinite(depthKm) || depthKm < 0) {
        throw new RangeError('Magnitude and depth must be finite non-negative source values');
    }
    const magnitudePosition = Math.max(0, Math.min(1, (magnitude - 4.5) / (8.8 - 4.5)));
    const depthBand = depthKm < 70 ? 'shallow' : depthKm < 300 ? 'intermediate' : 'deep';
    return {
        outerRadius: 2 + magnitudePosition * 9,
        intensity: 0.18 + magnitudePosition * 0.68,
        depthBand,
        ringScale: [
            0.38,
            0.69,
            1
        ]
    };
}
export function sortEventsByTime(events) {
    return [
        ...events
    ].sort((a, b)=>a.time - b.time || a.id.localeCompare(b.id));
}
export function filterEventsThrough(events, epochMs) {
    if (!Number.isSafeInteger(epochMs)) throw new RangeError('Time cutoff must be an epoch-millisecond integer');
    return events.filter((event)=>event.time <= epochMs);
}
export function encodeEvents(events) {
    const checked = events.map(validateEvent);
    const ids = new Set();
    for (const event of checked){
        if (ids.has(event.id)) throw new Error(`Duplicate earthquake event id: ${event.id}`);
        ids.add(event.id);
    }
    return JSON.stringify(checked.map(({ id, longitude, latitude, magnitude, depthKm, time })=>[
            id,
            longitude,
            latitude,
            magnitude,
            depthKm,
            time
        ]));
}
export function decodeEvents(encoded) {
    let value;
    try {
        value = JSON.parse(encoded);
    } catch  {
        throw new Error('Invalid earthquake payload JSON');
    }
    return decodeEventRows(value);
}
export function decodeEventRows(value) {
    if (!Array.isArray(value)) throw new Error('Invalid earthquake payload: expected an array');
    const events = value.map((row, index)=>{
        if (!Array.isArray(row) || row.length !== 6) throw new Error(`Invalid earthquake payload row ${index}`);
        return validateEvent({
            id: row[0],
            longitude: row[1],
            latitude: row[2],
            magnitude: row[3],
            depthKm: row[4],
            time: row[5]
        });
    });
    const ids = new Set(events.map((event)=>event.id));
    if (ids.size !== events.length) throw new Error('Invalid earthquake payload: duplicate event ids');
    return events;
}
export function hitTestEvent(x, y, points, radius) {
    if (![
        x,
        y,
        radius
    ].every(Number.isFinite) || radius < 0) throw new RangeError('Invalid hit-test position or radius');
    let nearest = null, distanceSquared = radius * radius;
    for (const point of points){
        const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
        if (distance <= distanceSquared) {
            nearest = point;
            distanceSquared = distance;
        }
    }
    return nearest;
}
