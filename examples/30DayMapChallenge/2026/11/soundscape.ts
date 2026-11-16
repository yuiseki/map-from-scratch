export type SoundKind = 'road' | 'rail';
export interface SoundSource {
  kind: SoundKind;
  class: string;
  x: number;
  y: number;
  strength: number;
}

export interface SoundGrid {
  width: number;
  height: number;
  roads: Uint16Array;
  rails: Uint16Array;
}

const GRID_MAGIC = 0x534e4431; // SND1

export function encodeSoundGrid(grid: SoundGrid): ArrayBuffer {
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 1 || grid.height < 1
    || grid.roads.length !== grid.width * grid.height || grid.rails.length !== grid.roads.length) {
    throw new Error('Invalid sound grid dimensions');
  }
  const buffer = new ArrayBuffer(12 + grid.roads.length * 4), view = new DataView(buffer);
  view.setUint32(0, GRID_MAGIC, true); view.setUint32(4, grid.width, true); view.setUint32(8, grid.height, true);
  for (let i = 0, offset = 12; i < grid.roads.length; i++, offset += 4) {
    view.setUint16(offset, grid.roads[i]!, true); view.setUint16(offset + 2, grid.rails[i]!, true);
  }
  return buffer;
}

export function decodeSoundGrid(buffer: ArrayBuffer): SoundGrid {
  if (buffer.byteLength < 12) throw new Error('Truncated sound grid header');
  const view = new DataView(buffer), width = view.getUint32(4, true), height = view.getUint32(8, true);
  if (view.getUint32(0, true) !== GRID_MAGIC || width < 1 || height < 1 || 12 + width * height * 4 !== buffer.byteLength) {
    throw new Error('Invalid sound grid buffer');
  }
  const roads = new Uint16Array(width * height), rails = new Uint16Array(width * height);
  for (let i = 0, offset = 12; i < roads.length; i++, offset += 4) {
    roads[i] = view.getUint16(offset, true); rails[i] = view.getUint16(offset + 2, true);
  }
  return { width, height, roads, rails };
}

const ROAD_WEIGHTS: Record<string, number> = {
  motorway: 1, trunk: 0.9, primary: 0.78, secondary: 0.62, tertiary: 0.46,
  unclassified: 0.34, residential: 0.3, living_street: 0.2, service: 0.22,
  busway: 0.72, motorway_link: 0.75, trunk_link: 0.7, primary_link: 0.62,
  secondary_link: 0.52, tertiary_link: 0.4,
};
const RAIL_WEIGHTS: Record<string, number> = {
  rail: 0.82, subway: 0.75, light_rail: 0.68, monorail: 0.62, tram: 0.55, funicular: 0.5,
};

export function acousticWeight(source: Pick<SoundSource, 'kind' | 'class'>): number {
  return source.kind === 'rail' ? RAIL_WEIGHTS[source.class] ?? 0 : ROAD_WEIGHTS[source.class] ?? 0;
}

export function mixSoundscape(sources: readonly SoundSource[], x: number, y: number) {
  let traffic = 0, rail = 0;
  for (const source of sources) {
    const distance = Math.hypot(source.x - x, source.y - y);
    const contribution = acousticWeight(source) * Math.max(0, source.strength) / (1 + distance * 18);
    if (source.kind === 'rail') rail += contribution;
    else traffic += contribution;
  }
  traffic = Math.min(1, 1 - Math.exp(-traffic * 1.8));
  rail = Math.min(1, 1 - Math.exp(-rail * 1.8));
  return { traffic, rail, master: Math.min(1, traffic * 0.72 + rail * 0.68) };
}

export function audioParameters(road: number, rail: number) {
  const traffic = Math.max(0, Math.min(1, road)), train = Math.max(0, Math.min(1, rail));
  return {
    trafficGain: 0.001 + traffic * 0.09,
    trafficCutoffHz: 240 + traffic * 1800,
    railGain: 0.001 + train * 0.055,
    railFrequencyHz: 48 + train * 24,
  };
}
