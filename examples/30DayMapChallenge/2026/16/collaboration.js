export const EDIT_KINDS = [
    'creation',
    'geometryChange',
    'tagChange',
    'deletion',
    'other'
];
const EMPTY_COUNTS = ()=>({
        total: 0,
        creation: 0,
        geometryChange: 0,
        tagChange: 0,
        deletion: 0,
        other: 0
    });
function checkBounds(bounds) {
    if (![
        bounds.west,
        bounds.south,
        bounds.east,
        bounds.north
    ].every(Number.isFinite) || bounds.west >= bounds.east || bounds.south >= bounds.north || bounds.west < -180 || bounds.east > 180 || bounds.south < -90 || bounds.north > 90) {
        throw new RangeError('Invalid geographic bounds');
    }
}
function timestampMonth(value) {
    if (typeof value !== 'string') throw new TypeError('Invalid contribution timestamp');
    const match = /^(\d{4})-(0[1-9]|1[0-2])-([0-2]\d|3[01])T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.exec(value);
    const parsed = Date.parse(value);
    if (!match || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value.slice(0, 10)) {
        throw new TypeError('Invalid contribution timestamp');
    }
    if (match[1] !== '2025') return null;
    return Number(match[2]) - 1;
}
function countKinds(properties) {
    const kinds = EDIT_KINDS.filter((kind)=>kind !== 'other' && properties[`@${kind}`] === true);
    return kinds.length ? kinds : [
        'other'
    ];
}
export function aggregateContributions(input, bounds, gridSize) {
    checkBounds(bounds);
    if (!Number.isInteger(gridSize) || gridSize < 2 || gridSize > 128) throw new RangeError('Invalid grid resolution');
    if (!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) throw new TypeError('Invalid contribution collection');
    const cells = new Map();
    const monthlyTotals = Array.from({
        length: 12
    }, EMPTY_COUNTS);
    let mappedFeatures = 0, unmappedNoGeometry = 0, unmappedOutsideYear = 0, unmappedOutsideBounds = 0;
    for (const feature of input.features){
        const properties = feature.properties;
        if (!properties || typeof properties !== 'object') throw new TypeError('Missing contribution properties');
        const month = timestampMonth(properties['@timestamp']);
        if (month === null) {
            unmappedOutsideYear++;
            continue;
        }
        const geometry = feature.geometry;
        if (!geometry || geometry.type !== 'Point') {
            unmappedNoGeometry++;
            continue;
        }
        if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || typeof geometry.coordinates[0] !== 'number' || typeof geometry.coordinates[1] !== 'number' || !Number.isFinite(geometry.coordinates[0]) || !Number.isFinite(geometry.coordinates[1])) {
            throw new TypeError('Invalid contribution coordinate');
        }
        const [lon, lat] = geometry.coordinates;
        if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north) {
            unmappedOutsideBounds++;
            continue;
        }
        const x = Math.min(gridSize - 1, Math.floor((lon - bounds.west) / (bounds.east - bounds.west) * gridSize));
        const y = Math.min(gridSize - 1, Math.floor((bounds.north - lat) / (bounds.north - bounds.south) * gridSize));
        const key = `${x}:${y}`;
        let cell = cells.get(key);
        if (!cell) {
            cell = {
                x,
                y,
                months: Array.from({
                    length: 12
                }, EMPTY_COUNTS)
            };
            cells.set(key, cell);
        }
        const kinds = countKinds(properties);
        const cellMonth = cell.months[month];
        const totalMonth = monthlyTotals[month];
        cellMonth.total++;
        totalMonth.total++;
        for (const kind of kinds){
            cellMonth[kind]++;
            totalMonth[kind]++;
        }
        mappedFeatures++;
    }
    const orderedCells = [
        ...cells.values()
    ].sort((a, b)=>a.y - b.y || a.x - b.x);
    return {
        bounds,
        gridSize,
        cells: orderedCells,
        monthlyTotals,
        inputFeatures: input.features.length,
        mappedFeatures,
        unmappedNoGeometry,
        unmappedOutsideYear,
        unmappedOutsideBounds,
        cumulativeTotal (month) {
            if (!Number.isInteger(month) || month < 0 || month > 11) throw new RangeError('Month must be 0..11');
            return monthlyTotals.slice(0, month + 1).reduce((sum, counts)=>sum + counts.total, 0);
        }
    };
}
export function cellCountsThrough(cell, month, enabledKinds = EDIT_KINDS) {
    if (!Number.isInteger(month) || month < 0 || month > 11) throw new RangeError('Month must be 0..11');
    const result = EMPTY_COUNTS();
    for(let index = 0; index <= month; index++){
        const counts = cell.months[index];
        result.total += counts.total;
        for (const kind of enabledKinds)result[kind] += counts[kind];
    }
    return result;
}
