export interface ProfileEvent { lon: number; depthKm: number; magnitude: number; id: string }
export interface ProfileData { west: number; east: number; latitude: number; elevations: number[]; events: ProfileEvent[] }

export function flipReliefY(elevationM: number, seaLevelY: number, pixelsPerMeter: number): number {
  return seaLevelY + elevationM * pixelsPerMeter;
}

export function depthSectionY(depthKm: number, seaLevelY: number, pixelsPerKm: number): number {
  if (!Number.isFinite(depthKm) || depthKm < 0) throw new RangeError('Hypocenter depth must be non-negative');
  return seaLevelY + depthKm * pixelsPerKm;
}

export function sampleIndex(index: number, inputCount: number, outputCount: number): number {
  if (inputCount < 2 || outputCount < 2 || index < 0 || index >= outputCount) throw new RangeError('Invalid sample index or count');
  return Math.round(index * (inputCount - 1) / (outputCount - 1));
}

export function sectionDistanceKm(west: number, east: number, latitude: number): number {
  return (east - west) * 111.32 * Math.cos(latitude * Math.PI / 180);
}

export function validateProfile(data: ProfileData): void {
  if (!(data.west < data.east) || data.elevations.length < 2 || !Number.isFinite(data.latitude)) throw new Error('Invalid GEBCO section metadata');
  if (!data.elevations.every(Number.isFinite)) throw new Error('Invalid GEBCO elevations');
  for (const event of data.events) {
    if (event.lon < data.west || event.lon > data.east || event.depthKm < 0 || !Number.isFinite(event.magnitude)) throw new Error('Invalid USGS hypocenter');
  }
}
