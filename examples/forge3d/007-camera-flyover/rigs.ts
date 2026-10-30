// Camera rigs baked into animations, after forge3d's camera_rigs: a rig says
// where the eye and the target are at time t; baking samples it 60 times a
// second and keeps the eye a minimum height above the terrain. Playback then
// only looks a sample up, so a frame never computes a path.

import { groundAt, summitWorld, worldOf, type Relief } from './terrain.ts';

export const RATE = 60; // samples per second, as forge3d's samples_per_second=60
export const ORBIT_M = 14000; // orbit radius, m

export interface Rig {
  name: string;
  label: string;
  duration: number; // s
  clearance: number; // m above the ground the eye never goes below
  at(t: number): { eye: number[]; target: number[] }; // t in 0..1
}

export interface Animation {
  rig: Rig;
  frames: number;
  samples: Float32Array; // eye xyz, target xyz per frame
  raised: number; // frames whose eye the clearance lifted
}

const lerp = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v + (b[i] - v) * t);

// Point along a polyline at fraction t of its length.
function along(path: number[][], t: number): number[] {
  const seg = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
  let d = t * seg.reduce((a, b) => a + b, 0);
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) return lerp(path[i], path[i + 1], Math.min(1, d / seg[i]));
    d -= seg[i];
  }
  return path[path.length - 1];
}

// The three presets of forge3d's terrain_camera_rigs_demo, on Rainier.
export function rigs(r: Relief): Rig[] {
  const summit = summitWorld(r);
  const [W, S, E, N] = r.bounds;
  // Grid position of a longitude and latitude (linear over 20 km is enough here).
  const at = (lon: number, lat: number): number[] => worldOf(r, (lon - W) / (E - W), (N - lat) / (N - S));
  const ground = (p: number[]) => [p[0], p[1], groundAt(r, p[0], p[1])];
  // Paradise (1,650 m) up the Muir snowfield to Camp Muir and the summit.
  const trail = [at(-121.7353, 46.7865), at(-121.7316, 46.8358), summit].map(ground);
  return [
    {
      // Orbit the summit from phi 20 to 320 deg, 40 deg up (forge3d's
      // phi_start/phi_end and theta 50 from the zenith). forge3d's radius is
      // in its own scene units; 14 km frames the mountain as its images do.
      name: 'orbit', label: 'Orbit', duration: 6, clearance: 120,
      at: (t) => {
        const az = ((20 + 300 * t) * Math.PI) / 180, el = (40 * Math.PI) / 180;
        return { eye: [summit[0] + Math.sin(az) * Math.cos(el) * ORBIT_M, summit[1] + Math.cos(az) * Math.cos(el) * ORBIT_M, summit[2] + Math.sin(el) * ORBIT_M], target: summit };
      },
    },
    {
      // Follow a climber up the trail: 1.4 km behind and 350 m above.
      name: 'follow', label: 'Follow', duration: 10, clearance: 120,
      at: (t) => {
        // The climber walks on the ground: between the waypoints a straight
        // line would float above or sink below the slope.
        const target = ground(along(trail, t));
        const ahead = along(trail, Math.min(1, t + 0.02)), back = along(trail, Math.max(0, t - 0.02));
        const dx = ahead[0] - back[0], dy = ahead[1] - back[1], l = Math.hypot(dx, dy) || 1;
        return { eye: [target[0] - (dx / l) * 1400, target[1] - (dy / l) * 1400, target[2] + 350], target };
      },
    },
    {
      // A rail shot: a straight track 7 km north of the summit at 2,000 m,
      // west to east, always looking at the summit. The ridges in between
      // are higher than the track, which is what the clearance is for.
      name: 'rail', label: 'Rail', duration: 8, clearance: 150,
      at: (t) => ({ eye: [summit[0] - 8000 + 16000 * t, summit[1] + 7000, 2000], target: summit }),
    },
  ];
}

export function bake(r: Relief, rig: Rig): Animation {
  const frames = Math.round(rig.duration * RATE) + 1;
  const samples = new Float32Array(frames * 6);
  const planned: number[] = [], lifted: number[] = [];
  for (let i = 0; i < frames; i++) {
    const { eye, target } = rig.at(i / (frames - 1));
    samples.set(eye, i * 6);
    samples.set(target, i * 6 + 3);
    planned.push(eye[2]);
    lifted.push(Math.max(eye[2], groundAt(r, eye[0], eye[1]) + rig.clearance));
  }
  // Lifting frame by frame makes the camera jump over each ridge. A moving
  // maximum then a moving mean of the same width smooths it and still keeps
  // every frame at or above its lifted height: frame i is inside the window
  // of every maximum the mean averages.
  const half = Math.round(RATE / 4);
  const win = (i: number) => [Math.max(0, i - half), Math.min(frames - 1, i + half)];
  const maxed = lifted.map((_, i) => { const [a, b] = win(i); return Math.max(...lifted.slice(a, b + 1)); });
  let raised = 0;
  for (let i = 0; i < frames; i++) {
    const [a, b] = win(i);
    const z = maxed.slice(a, b + 1).reduce((s, v) => s + v, 0) / (b - a + 1);
    if (z > planned[i] + 0.01) raised++;
    samples[i * 6 + 2] = Math.max(planned[i], z);
  }
  return { rig, frames, samples, raised };
}
