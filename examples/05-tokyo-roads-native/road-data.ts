const CLASS: Record<string, number> = {
  motorway: 0, trunk: 0, motorway_link: 0, trunk_link: 0,
  primary: 1, primary_link: 1,
  secondary: 2, secondary_link: 2, tertiary: 2, tertiary_link: 2,
  residential: 3, unclassified: 3, living_street: 3, service: 3, road: 3,
};

export const classOf = (highway: string): number => CLASS[highway] ?? 4;

const [W, S, E, N] = [139.50, 35.48, 139.98, 35.85];
const k = Math.cos((((S + N) / 2) * Math.PI) / 180);
const span = Math.max((E - W) * k, N - S);
const quantize = (value: number): number => Math.max(0, Math.min(65535, Math.round(value * 65535)));

export function projectRoad(lon: number, lat: number): [number, number] {
  return [quantize(((lon - W) * k) / span), quantize((N - lat) / span)];
}

export const roadClassAt = (index: number, length: number, roadClass: number): number => index === length - 1 ? 255 : roadClass;
