export type XY = { east: number; north: number };
export type Position = [number, number];

export interface WindObservation {
  station: string;
  stationLon: number;
  stationLat: number;
  observedAt: string;
  fromDegrees: number;
  fromLabel: string;
  speedMps: number;
  sourceUrl: string;
}

export interface CandidateSource {
  id: string;
  name: string;
  lon: number;
  lat: number;
  kind: string;
  outline: Position[][];
}

export interface SmellData {
  observation: WindObservation;
  sources: CandidateSource[];
  roads: Position[][];
  waterways: Position[][];
  bounds: { west: number; east: number; south: number; north: number };
  plume: { lengthM: number; spreadRatio: number; sourceHalfWidthM: number };
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPosition = (value: unknown): value is Position => Array.isArray(value) && value.length === 2
  && isNumber(value[0]) && isNumber(value[1])
  && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;

export function windTowardVector(fromDegrees: number, distanceM: number): XY {
  if (!Number.isFinite(fromDegrees) || !Number.isFinite(distanceM) || distanceM < 0) {
    throw new Error('wind bearing and distance must be finite; distance must be non-negative');
  }
  const towardRadians = (fromDegrees + 180) * Math.PI / 180;
  return {
    east: Math.sin(towardRadians) * distanceM,
    north: Math.cos(towardRadians) * distanceM,
  };
}

/** Returns a five-vertex illustrative fan, in local east/north metres.
 * It is a cartographic symbol only; it is not a dispersion calculation.
 */
export function buildIllustrativePlume(
  source: XY,
  towardBearingDegrees: number,
  lengthM: number,
  spreadRatio: number,
  sourceHalfWidthM: number,
): XY[] {
  if (![source.east, source.north, towardBearingDegrees, lengthM, spreadRatio, sourceHalfWidthM].every(Number.isFinite)
      || lengthM <= 0 || spreadRatio < 0 || sourceHalfWidthM < 0) {
    throw new Error('plume length and width inputs must be finite; length must be positive');
  }
  const theta = towardBearingDegrees * Math.PI / 180;
  const forward = { east: Math.sin(theta), north: Math.cos(theta) };
  const side = { east: -Math.cos(theta), north: Math.sin(theta) };
  const point = (distance: number, sideFraction: number): XY => {
    const halfWidth = sourceHalfWidthM + spreadRatio * distance;
    return {
      east: source.east + forward.east * distance + side.east * halfWidth * sideFraction,
      north: source.north + forward.north * distance + side.north * halfWidth * sideFraction,
    };
  };
  return [source, point(lengthM / 2, 1), point(lengthM, 1), point(lengthM, -1), point(lengthM / 2, -1)];
}

export function decodeSmellData(input: unknown): SmellData {
  if (input === null || typeof input !== 'object') throw new Error('smell data must be an object');
  const data = input as Partial<SmellData>;
  const wind = data.observation;
  if (!wind || typeof wind.station !== 'string' || !wind.station.trim()
      || !isNumber(wind.stationLon) || !isNumber(wind.stationLat) || wind.stationLat < -90 || wind.stationLat > 90
      || typeof wind.observedAt !== 'string' || !Number.isFinite(Date.parse(wind.observedAt))
      || !isNumber(wind.fromDegrees) || wind.fromDegrees < 0 || wind.fromDegrees >= 360
      || typeof wind.fromLabel !== 'string' || !wind.fromLabel
      || !isNumber(wind.speedMps) || wind.speedMps < 0
      || typeof wind.sourceUrl !== 'string' || !URL.canParse(wind.sourceUrl)) {
    throw new Error('invalid observation: station, location, time, wind direction, speed and source URL are required');
  }
  if (!Array.isArray(data.sources) || data.sources.length !== 1) throw new Error('exactly one source candidate is required');
  const source = data.sources[0];
  if (!source || typeof source.id !== 'string' || typeof source.name !== 'string'
      || typeof source.kind !== 'string' || !isNumber(source.lon) || !isNumber(source.lat)
      || source.lon < -180 || source.lon > 180 || source.lat < -90 || source.lat > 90
      || !Array.isArray(source.outline) || !source.outline.every((line) => Array.isArray(line) && line.every(isPosition))) {
    throw new Error('invalid source candidate or source latitude/longitude');
  }
  if (!Array.isArray(data.roads) || !data.roads.every((line) => Array.isArray(line) && line.every(isPosition))
      || !Array.isArray(data.waterways) || !data.waterways.every((line) => Array.isArray(line) && line.every(isPosition))) {
    throw new Error('invalid map context geometry');
  }
  const bounds = data.bounds;
  if (!bounds || ![bounds.west, bounds.east, bounds.south, bounds.north].every(isNumber)
      || !(bounds.west < bounds.east && bounds.south < bounds.north)) {
    throw new Error('invalid geographic bounds');
  }
  const plume = data.plume;
  if (!plume || !isNumber(plume.lengthM) || plume.lengthM <= 0
      || !isNumber(plume.spreadRatio) || plume.spreadRatio < 0
      || !isNumber(plume.sourceHalfWidthM) || plume.sourceHalfWidthM < 0) {
    throw new Error('invalid plume display assumptions');
  }
  return data as SmellData;
}
