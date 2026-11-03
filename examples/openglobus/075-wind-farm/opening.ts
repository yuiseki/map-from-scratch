// The opening camera, as data, chosen from the turbine positions: a low
// oblique shot from 330 m behind the north-east corner turbine of Wind Farm
// Tsugaru (OSM node 7483531471), the eye 140 m up (about blade-tip height),
// looking south-south-west (203 degrees) down its three rows. Mt Iwaki
// stands at the end of the rows and the Sea of Japan opens on the right.
// The corner turbine's rotor is about 360 px across at 1280x800 and its
// tower foot sits in the lower third, so the foreground is not empty field
// (opening.test.ts pins these).
import type { OrbitView } from './camera.ts';

export interface OpeningShot {
  anchor: number;                       // OSM id of the turbine the shot is framed on
  target: [number, number, number];     // orbit target from the anchor's base: east, north (m), metres above the ground there
  heading: number;                      // degrees, the direction the camera looks
  pitch: number;                        // degrees below the horizon
  distance: number;                     // eye to target (m)
}

export const OPENING: OpeningShot = { anchor: 7483531471, target: [-159, -224, 27], heading: 203, pitch: 10, distance: 600 };

interface Placed { id: number; x: number; y: number }

export function openingView(turbines: Placed[], groundAt: (x: number, y: number) => number, shot: OpeningShot = OPENING): OrbitView {
  const a = turbines.find((t) => t.id === shot.anchor);
  if (!a) throw new Error(`opening anchor ${shot.anchor} is not among the turbines`);
  const x = a.x + shot.target[0], y = a.y + shot.target[1];
  return { target: [x, y, groundAt(x, y) + shot.target[2]], heading: shot.heading, pitch: shot.pitch, distance: shot.distance };
}
