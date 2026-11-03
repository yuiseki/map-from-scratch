// The lines drawn, in the order the bake extracts them (a later line drops
// the track it shares with an earlier one), with the colour each tube gets.
// Colours follow the trains' livery where one is well known (Tokaido blue,
// Tohoku E5 green, Komachi red, Toki pink, Kagayaki copper), and are kept
// apart in hue where two lines meet.

// fallbackKmh: used only when OSM maxspeed covers under 20% of the line (the
// Akita mini-shinkansen's Tazawako line section carries almost no maxspeed
// tags in the 2026-08-31 cut). 130 km/h is the limit of the conventional
// lines the mini-shinkansen run on (JR East).
export interface LineStyle { name: string; en: string; colour: string; fallbackKmh?: number }

export const LINES: LineStyle[] = [
  { name: '東海道新幹線', en: 'Tokaido', colour: '#3fa9ff' },
  { name: '山陽新幹線', en: 'Sanyo', colour: '#7c83ff' },
  { name: '東北新幹線', en: 'Tohoku', colour: '#2ee07a' },
  { name: '上越新幹線', en: 'Joetsu', colour: '#ff6fb5' },
  { name: '北陸新幹線', en: 'Hokuriku', colour: '#ffb648' },
  { name: '九州新幹線', en: 'Kyushu', colour: '#ff5a4e' },
  { name: '西九州新幹線', en: 'Nishi-Kyushu', colour: '#ffe066' },
  { name: '北海道新幹線', en: 'Hokkaido', colour: '#c77dff' },
  { name: '秋田新幹線', en: 'Akita', colour: '#ff2e63', fallbackKmh: 130 },
  { name: '山形新幹線', en: 'Yamagata', colour: '#5ee6ff' },
];

// Stations whose OSM node is the reference for the tube-at-station checks:
// the node of that name nearest the line (bake.ts records the distance).
export const STATIONS: { name: string; en: string; line: string }[] = [
  { name: '東京', en: 'Tokyo', line: '東海道新幹線' },
  { name: '新富士', en: 'Shin-Fuji', line: '東海道新幹線' },
  { name: '名古屋', en: 'Nagoya', line: '東海道新幹線' },
  { name: '新大阪', en: 'Shin-Osaka', line: '東海道新幹線' },
  { name: '広島', en: 'Hiroshima', line: '山陽新幹線' },
  { name: '博多', en: 'Hakata', line: '山陽新幹線' },
  { name: '仙台', en: 'Sendai', line: '東北新幹線' },
  { name: '新青森', en: 'Shin-Aomori', line: '東北新幹線' },
  { name: '新潟', en: 'Niigata', line: '上越新幹線' },
  { name: '金沢', en: 'Kanazawa', line: '北陸新幹線' },
  { name: '鹿児島中央', en: 'Kagoshima-Chuo', line: '九州新幹線' },
  { name: '長崎', en: 'Nagasaki', line: '西九州新幹線' },
  { name: '新函館北斗', en: 'Shin-Hakodate-Hokuto', line: '北海道新幹線' },
  { name: '秋田', en: 'Akita', line: '秋田新幹線' },
  { name: '新庄', en: 'Shinjo', line: '山形新幹線' },
];

// Natural Earth 10m land inside this box, 110m outside: [lon0, lat0, lon1, lat1]
export const DETAIL_BOX = [118, 20, 155, 50];

export const hexToRgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
