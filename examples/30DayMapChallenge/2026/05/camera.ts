export interface OrbitCamera { yaw: number; pitch: number; distance: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function orbitByDrag(camera: OrbitCamera, dx: number, dy: number): OrbitCamera {
  return { ...camera, yaw: ((camera.yaw + dx * 0.45) % 360 + 360) % 360, pitch: clamp(camera.pitch - dy * 0.30, 12, 82) };
}

export function zoomCamera(camera: OrbitCamera, deltaY: number): OrbitCamera {
  return { ...camera, distance: clamp(camera.distance * Math.exp(deltaY * 0.001), 1.25, 8.5) };
}

function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
    out[col * 4 + row] = sum;
  }
  return out;
}

function lookAt(eye: number[], target: number[], up: number[]): Float64Array {
  const norm = (v: number[]) => { const length = Math.hypot(...v); return v.map((n) => n / length); };
  const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const forward = norm(target.map((value, i) => value - eye[i]!)), side = norm(cross(forward, up)), vertical = cross(side, forward);
  return Float64Array.of(
    side[0]!, vertical[0]!, -forward[0]!, 0,
    side[1]!, vertical[1]!, -forward[1]!, 0,
    side[2]!, vertical[2]!, -forward[2]!, 0,
    -dot(side, eye), -dot(vertical, eye), dot(forward, eye), 1,
  );
}

function perspective(fovy: number, aspect: number, near: number, far: number): Float64Array {
  const f = 1 / Math.tan(fovy / 2);
  return Float64Array.of(f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0);
}

export function cameraViewProjection(camera: OrbitCamera, aspect: number): Float32Array {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('Camera aspect must be positive');
  const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
  const horizontal = camera.distance * Math.cos(pitch), target = [0, 0, 0.21];
  const eye = [horizontal * Math.sin(yaw), -horizontal * Math.cos(yaw), target[2]! + camera.distance * Math.sin(pitch)];
  const view = lookAt(eye, target, [0, 0, 1]);
  return new Float32Array(multiply(perspective(42 * Math.PI / 180, aspect, 0.05, 30), view));
}
