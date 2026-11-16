export const TOKYO_NETWORK_BOUNDS = {
    minX: 139.55,
    minY: 35.52,
    maxX: 139.95,
    maxY: 35.82
};
export const NETWORK_CREDITS = {
    n07: {
        id: 'hf:ksj-n07-bus-route-greater-tokyo',
        name: '国土数値情報（バスルートデータ）',
        url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-v2_0.html',
        license: 'CC BY 4.0',
        attribution: '出典：「国土数値情報（バスルートデータ）」（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-v2_0.html）を加工して作成',
        edition: '2022'
    },
    p11: {
        id: 'hf:ksj-p11-bus-stop-jp',
        name: '国土数値情報（バス停留所データ）',
        url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-v3_0.html',
        license: 'CC BY 4.0',
        attribution: '出典：「国土数値情報（バス停留所データ）」（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-v3_0.html）を加工して作成',
        edition: '2022'
    }
};
const MERCATOR_RADIUS = 6_378_137;
const MAX_MERCATOR_LATITUDE = 85.0511287798066;
export function projectJgd2011([longitude, latitude]) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -MAX_MERCATOR_LATITUDE || latitude > MAX_MERCATOR_LATITUDE) {
        throw new RangeError('EPSG:6668 longitude/latitude coordinate is outside the Web Mercator range');
    }
    const longitudeRadians = longitude * Math.PI / 180;
    const latitudeRadians = latitude * Math.PI / 180;
    return [
        MERCATOR_RADIUS * longitudeRadians,
        MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2))
    ];
}
export function fitNetworkCamera(bounds, width, height, padding = 24) {
    if (![
        bounds.minX,
        bounds.minY,
        bounds.maxX,
        bounds.maxY
    ].every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) throw new RangeError('Invalid camera extent');
    if (![
        width,
        height,
        padding
    ].every(Number.isFinite) || width <= 0 || height <= 0 || padding < 0 || width <= padding * 2 || height <= padding * 2) throw new RangeError('Invalid camera viewport');
    const scale = Math.min((width - padding * 2) / (bounds.maxX - bounds.minX), (height - padding * 2) / (bounds.maxY - bounds.minY));
    return {
        centerX: (bounds.minX + bounds.maxX) / 2,
        centerY: (bounds.minY + bounds.maxY) / 2,
        scale,
        width,
        height
    };
}
export function projectNetworkPoint(point, camera) {
    if (!validXY(point) || ![
        camera.centerX,
        camera.centerY,
        camera.scale,
        camera.width,
        camera.height
    ].every(Number.isFinite) || camera.scale <= 0 || camera.width <= 0 || camera.height <= 0) throw new RangeError('Invalid camera point or state');
    return [
        (point[0] - camera.centerX) * camera.scale + camera.width / 2,
        (camera.centerY - point[1]) * camera.scale + camera.height / 2
    ];
}
export function hitNetworkStop(x, y, points, radius) {
    if (![
        x,
        y,
        radius
    ].every(Number.isFinite) || radius < 0) throw new RangeError('Invalid hit-test position or radius');
    let selected = null, nearest = radius * radius;
    for (const point of points){
        const dx = point.screenX - x, dy = point.screenY - y, distance = dx * dx + dy * dy;
        if (distance <= nearest) {
            selected = point;
            nearest = distance;
        }
    }
    return selected;
}
function clipSegment(a, b, bounds) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const p = [
        -dx,
        dx,
        -dy,
        dy
    ];
    const q = [
        a[0] - bounds.minX,
        bounds.maxX - a[0],
        a[1] - bounds.minY,
        bounds.maxY - a[1]
    ];
    let start = 0, end = 1;
    for(let i = 0; i < 4; i++){
        const pi = p[i], qi = q[i];
        if (pi === 0) {
            if (qi < 0) return null;
            continue;
        }
        const ratio = qi / pi;
        if (pi < 0) {
            if (ratio > end) return null;
            start = Math.max(start, ratio);
        } else {
            if (ratio < start) return null;
            end = Math.min(end, ratio);
        }
    }
    return [
        [
            a[0] + start * dx,
            a[1] + start * dy
        ],
        [
            a[0] + end * dx,
            a[1] + end * dy
        ]
    ];
}
export function clipPolylineToBounds(points, bounds) {
    if (![
        bounds.minX,
        bounds.minY,
        bounds.maxX,
        bounds.maxY
    ].every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) throw new RangeError('Invalid clipping extent');
    if (points.some(([x, y])=>!Number.isFinite(x) || !Number.isFinite(y))) throw new RangeError('Invalid line coordinate');
    const parts = [];
    let part = null;
    for(let i = 1; i < points.length; i++){
        const segment = clipSegment(points[i - 1], points[i], bounds);
        if (!segment) {
            part = null;
            continue;
        }
        if (part && part.at(-1)[0] === segment[0][0] && part.at(-1)[1] === segment[0][1]) {
            part.push(segment[1]);
        } else {
            part = [
                segment[0],
                segment[1]
            ];
            parts.push(part);
        }
    }
    return parts;
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validXY(value) {
    return Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && Number.isFinite(value[0]) && typeof value[1] === 'number' && Number.isFinite(value[1]);
}
function requireText(value, field) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`);
    return value;
}
function parseRoute(value, index) {
    if (!isRecord(value)) throw new Error(`Invalid N07 line at ${index}`);
    const id = requireText(value.id, `N07 line id at ${index}`);
    const operator = requireText(value.operator, `N07 operator at ${index}`);
    const prefCode = requireText(value.prefCode, `N07 prefecture code at ${index}`);
    if (!Array.isArray(value.coordinates) || value.coordinates.length < 1 || !value.coordinates.every((part)=>Array.isArray(part) && part.length >= 2 && part.every(validXY))) {
        throw new Error(`N07 line ${id} must have clipped parts with at least two valid coordinates each`);
    }
    value.coordinates.forEach((part)=>part.forEach((coordinate)=>projectJgd2011(coordinate)));
    return {
        id,
        operator,
        prefCode,
        coordinates: value.coordinates.map((part)=>part.map(([x, y])=>[
                    x,
                    y
                ]))
    };
}
function parseGeoJSON(value, context) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch  {
        throw new Error(`Invalid GeoJSON in ${context}`);
    }
}
function parseSourceId(value, context) {
    return requireText(value, context);
}
function parseSourceOperator(value, context) {
    return requireText(value, context);
}
function parseSourcePrefecture(value, context) {
    const code = requireText(value, context);
    if (code !== '13') throw new Error(`${context} must be Tokyo prefecture 13, got ${code}`);
    return code;
}
function parseGeoJSONLine(value, context) {
    const geometry = parseGeoJSON(value, context);
    if (!isRecord(geometry) || geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || !geometry.coordinates.every(validXY)) {
        throw new Error(`${context} must contain a GeoJSON LineString with at least two coordinates`);
    }
    geometry.coordinates.forEach((point)=>projectJgd2011(point));
    return geometry.coordinates.map(([x, y])=>[
            x,
            y
        ]);
}
function parseGeoJSONPoint(value, context) {
    const geometry = parseGeoJSON(value, context);
    if (!isRecord(geometry) || geometry.type !== 'Point' || !validXY(geometry.coordinates)) {
        throw new Error(`${context} must contain a GeoJSON Point`);
    }
    projectJgd2011(geometry.coordinates);
    return [
        geometry.coordinates[0],
        geometry.coordinates[1]
    ];
}
export function extractNetwork(routeRows, stopRows, bounds) {
    const routes = [];
    for (const row of routeRows){
        if (!isRecord(row)) throw new Error('Invalid N07 source row');
        const id = parseSourceId(row.id, 'N07 id');
        const prefCode = parseSourcePrefecture(row.pref_code, `N07 ${id} pref_code`);
        const operator = parseSourceOperator(row.operator, `N07 ${id} operator`);
        const sourceCoordinates = parseGeoJSONLine(row.geometry, `N07 ${id} geometry`);
        const clipped = clipPolylineToBounds(sourceCoordinates, bounds);
        if (clipped.length) routes.push({
            id,
            operator,
            prefCode,
            coordinates: clipped
        });
    }
    const stops = [];
    for (const row of stopRows){
        if (!isRecord(row)) throw new Error('Invalid P11 source row');
        const id = parseSourceId(row.id, 'P11 id');
        const prefCode = parseSourcePrefecture(row.pref_code, `P11 ${id} pref_code`);
        const operator = parseSourceOperator(row.operator, `P11 ${id} operator`);
        const coordinates = parseGeoJSONPoint(row.geometry, `P11 ${id} geometry`);
        if (coordinates[0] < bounds.minX || coordinates[0] > bounds.maxX || coordinates[1] < bounds.minY || coordinates[1] > bounds.maxY) continue;
        stops.push(parseStop({
            id,
            operator,
            name: row.name,
            prefCode,
            coordinates,
            routes: row.routes,
            kinds: row.kinds,
            nRoutes: row.n_routes
        }, stops.length));
    }
    return {
        routes: deduplicateRoutes(routes),
        stops: deduplicateStops(stops)
    };
}
function parseStop(value, index) {
    if (!isRecord(value)) throw new Error(`Invalid P11 stop at ${index}`);
    const id = requireText(value.id, `P11 stop id at ${index}`);
    const operator = requireText(value.operator, `P11 operator at ${index}`);
    const name = requireText(value.name, `P11 stop name at ${index}`);
    const prefCode = requireText(value.prefCode, `P11 prefecture code at ${index}`);
    if (!validXY(value.coordinates)) throw new Error(`Invalid P11 stop coordinate at ${index}`);
    projectJgd2011(value.coordinates);
    if (!Array.isArray(value.routes) || !value.routes.every((route)=>typeof route === 'string' && route.trim())) {
        throw new Error(`Invalid P11 route labels at ${index}`);
    }
    if (!Array.isArray(value.kinds) || !value.kinds.every((kind)=>Number.isInteger(kind) && kind >= 1 && kind <= 5)) {
        throw new Error(`Invalid P11 bus kinds at ${index}`);
    }
    if (value.routes.length !== value.kinds.length) throw new Error(`P11 route/kind list lengths differ at ${index}`);
    if (!Number.isInteger(value.nRoutes) || value.nRoutes !== value.routes.length) {
        throw new Error(`P11 nRoutes does not equal route-list length at ${index}`);
    }
    return {
        id,
        operator,
        name,
        prefCode,
        coordinates: [
            value.coordinates[0],
            value.coordinates[1]
        ],
        routes: [
            ...value.routes
        ],
        kinds: [
            ...value.kinds
        ],
        nRoutes: value.nRoutes
    };
}
export function parseNetwork(value) {
    if (!isRecord(value) || !Array.isArray(value.routes) || !Array.isArray(value.stops)) {
        throw new Error('Network payload must contain separate routes and stops arrays');
    }
    return {
        routes: value.routes.map(parseRoute),
        stops: value.stops.map(parseStop)
    };
}
export function deduplicateRoutes(routes) {
    const byId = new Map();
    for (const route of routes){
        const previous = byId.get(route.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(route)) {
            throw new Error(`Conflicting N07 line records share source id ${route.id}`);
        }
        if (!previous) byId.set(route.id, route);
    }
    return [
        ...byId.values()
    ];
}
export function deduplicateStops(stops) {
    const byId = new Map();
    for (const stop of stops){
        const previous = byId.get(stop.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(stop)) {
            throw new Error(`Conflicting P11 stop records share source id ${stop.id}`);
        }
        if (!previous) byId.set(stop.id, stop);
    }
    return [
        ...byId.values()
    ];
}
export function buildMembershipNetwork(stops) {
    const nodes = new Map();
    const memberships = [];
    for (const stop of stops){
        for (const label of stop.routes){
            const key = JSON.stringify([
                stop.operator,
                label
            ]);
            let node = nodes.get(key);
            if (!node) {
                node = {
                    operator: stop.operator,
                    label,
                    stopIds: []
                };
                nodes.set(key, node);
            }
            if (!node.stopIds.includes(stop.id)) node.stopIds.push(stop.id);
            memberships.push({
                stopId: stop.id,
                operator: stop.operator,
                label
            });
        }
    }
    return {
        routeNodes: [
            ...nodes.values()
        ],
        memberships
    };
}
export function encodeNetwork(data) {
    return JSON.stringify(parseNetwork(data));
}
export function buildNetworkStats(data, sourceRows, bounds, payloadBytes) {
    if (!Number.isSafeInteger(sourceRows.n07Rows) || sourceRows.n07Rows < data.routes.length || !Number.isSafeInteger(sourceRows.p11Rows) || sourceRows.p11Rows < data.stops.length || !Number.isSafeInteger(payloadBytes) || payloadBytes < 0) throw new RangeError('Invalid source counts or payload size');
    if (![
        bounds.minX,
        bounds.minY,
        bounds.maxX,
        bounds.maxY
    ].every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) throw new RangeError('Invalid statistics extent');
    const memberships = buildMembershipNetwork(data.stops);
    return {
        snapshot: '2022',
        bounds: {
            ...bounds
        },
        coordinateReferenceSystem: 'EPSG:6668 geographic longitude/latitude; projected to EPSG:3857 for display',
        modification: 'N07 Tokyo records whose LineString intersects the fixed bbox were retained and clipped into LineString fragments; P11 Tokyo Points inside the same bbox were retained with original name, operator, routes, kinds and n_routes. No N07-to-P11 join was performed.',
        sources: {
            n07: {
                ...NETWORK_CREDITS.n07,
                sourceRows: sourceRows.n07Rows,
                selectedRows: data.routes.length
            },
            p11: {
                ...NETWORK_CREDITS.p11,
                sourceRows: sourceRows.p11Rows,
                selectedRows: data.stops.length
            }
        },
        counts: {
            routeLines: data.routes.length,
            stops: data.stops.length,
            n07Operators: new Set(data.routes.map((route)=>route.operator)).size,
            p11Operators: new Set(data.stops.map((stop)=>stop.operator)).size,
            stopRouteMemberships: memberships.memberships.length,
            exactOperatorRouteLabelGroups: memberships.routeNodes.length,
            stopsWithMultipleRouteLabels: data.stops.filter((stop)=>stop.nRoutes >= 2).length,
            maxRecordedRouteLabels: data.stops.reduce((maximum, stop)=>Math.max(maximum, stop.nRoutes), 0),
            n07ClippedVertices: data.routes.reduce((sum, route)=>sum + route.coordinates.reduce((vertices, part)=>vertices + part.length, 0), 0)
        },
        payloadBytes
    };
}
export function encodeNetworkStats(stats) {
    return `${JSON.stringify(stats, null, 2)}\n`;
}
export function decodeNetwork(text) {
    let value;
    try {
        value = JSON.parse(text);
    } catch  {
        throw new Error('Network payload is not valid JSON');
    }
    return parseNetwork(value);
}
export function inspectStop(stops, id) {
    const stop = stops.find((candidate)=>candidate.id === id);
    if (!stop) return null;
    return {
        id: stop.id,
        name: stop.name,
        operator: stop.operator,
        nRoutes: stop.nRoutes,
        routes: [
            ...stop.routes
        ],
        kinds: [
            ...stop.kinds
        ],
        prefCode: stop.prefCode
    };
}
