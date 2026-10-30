// Small WebGL2 globe renderer: one reusable 64x64 grid and one Terrarium
// texture per cached PMTiles tile. Geometry and shading are our own shaders.
const R = 6371000;
const N = 64;
const VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec3 a_uv;
uniform sampler2D u_dem;
uniform vec3 u_tile;          // z, x, y of the geometry patch
uniform vec3 u_uv;            // source-texture offset x,y and scale
uniform float u_sourceZoom;
uniform float u_exag;
uniform float u_flat;
uniform vec3 u_camera, u_forward, u_right, u_up;
uniform float u_tanX, u_tanY, u_near, u_far;
out vec3 v_normal; out float v_height; out vec3 v_radial;
const float PI = 3.141592653589793;
const float EARTH = 6371000.0;
float heightAt(vec2 uv) {
  ivec2 pixel = ivec2(clamp(floor(uv * 512.0), vec2(0.0), vec2(511.0)));
  vec3 rgb = floor(texelFetch(u_dem, pixel, 0).rgb * 255.0 + 0.5);   // exact bytes: the sea is 0 m
  return rgb.r * 256.0 + rgb.g + rgb.b / 256.0 - 32768.0;
}
void main() {
  float n = exp2(u_tile.x);
  vec2 merc = (u_tile.yz + a_uv.xy) / n;
  float lon = merc.x * 2.0 * PI - PI;
  float lat = 2.0 * atan(exp(PI * (1.0 - 2.0 * merc.y))) - PI * 0.5;
  float cl = cos(lat), sl = sin(lat), co = cos(lon), so = sin(lon);
  vec3 radial = vec3(cl * co, cl * so, sl);
  vec3 east = vec3(-so, co, 0.0);
  vec3 north = vec3(-sl * co, -sl * so, cl);
  vec2 uv = u_uv.xy + a_uv.xy * u_uv.z;
  float h = u_flat > 0.5 ? 0.0 : heightAt(uv);
  float e = u_exag;
  float seaHeight = max(h, 0.0) * e;
  float radius = EARTH + seaHeight + (u_flat > 0.5 ? -40.0 : 10.0) - a_uv.z * 12000.0;
  vec3 pos = radial * radius;
  float stepM = max(1.0, 2.0 * PI * EARTH * cl / (512.0 * exp2(u_sourceZoom)));
  vec2 one = vec2(1.0 / 512.0);
  float slopeE = u_flat > 0.5 ? 0.0 : (heightAt(uv + vec2(one.x, 0.0)) - heightAt(uv - vec2(one.x, 0.0))) * e / (2.0 * stepM);
  float slopeN = u_flat > 0.5 ? 0.0 : (heightAt(uv - vec2(0.0, one.y)) - heightAt(uv + vec2(0.0, one.y))) * e / (2.0 * stepM);
  v_normal = normalize(radial - east * slopeE - north * slopeN);
  v_height = u_flat > 0.5 ? -9999.0 : h;
  v_radial = radial;
  vec3 relative = pos - u_camera;
  float depth = dot(relative, u_forward);
  float px = dot(relative, u_right), py = dot(relative, u_up);
  float clipZ = (u_far + u_near) / (u_far - u_near) * depth - 2.0 * u_far * u_near / (u_far - u_near);
  gl_Position = vec4(px / u_tanX, py / u_tanY, clipZ, depth);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 v_normal; in float v_height; in vec3 v_radial;
uniform vec3 u_sun;
out vec4 color;
void main() {
  float h = v_height;
  vec3 c;
  // Mapterhorn has no bathymetry: the sea is exactly 0 m.
  if (h <= 0.0) c = vec3(0.09, 0.28, 0.39);
  else {
    c = mix(vec3(0.22, 0.43, 0.29), vec3(0.53, 0.58, 0.34), smoothstep(0.0, 900.0, h));
    c = mix(c, vec3(0.55, 0.47, 0.35), smoothstep(900.0, 2500.0, h));
    c = mix(c, vec3(0.87, 0.86, 0.80), smoothstep(2800.0, 4500.0, h));
    c = mix(c, vec3(0.97), smoothstep(5000.0, 7000.0, h));
  }
  float light = 0.46 + 0.54 * max(dot(normalize(v_normal), u_sun), 0.0);
  float rim = pow(1.0 - max(dot(v_radial, u_sun), 0.0), 3.0);
  color = vec4(c * light + vec3(0.07, 0.12, 0.16) * rim, 1.0);
}`;

export interface Camera { lon: number; lat: number; altitude: number; focusHeight: number; pitch: number; exaggeration: number; width: number; height: number }
export interface Patch { z: number; x: number; y: number; sourceZ: number; sourceX: number; sourceY: number; texture: WebGLTexture | null }

export function createGlobe(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance' });
  if (!context) throw new Error('WebGL2 が使えません');
  const gl: WebGL2RenderingContext = context;
  const program = gl.createProgram()!;
  for (const [kind, code] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
  const loc = (name: string) => gl.getUniformLocation(program, name);
  const U = {
    dem: loc('u_dem'), tile: loc('u_tile'), uv: loc('u_uv'), sourceZoom: loc('u_sourceZoom'), exag: loc('u_exag'), flat: loc('u_flat'),
    camera: loc('u_camera'), forward: loc('u_forward'), right: loc('u_right'), up: loc('u_up'), tanX: loc('u_tanX'), tanY: loc('u_tanY'),
    near: loc('u_near'), far: loc('u_far'), sun: loc('u_sun'),
  };
  const verts: number[] = [], indices: number[] = [];
  for (let row = 0; row <= N; row++) for (let col = 0; col <= N; col++) verts.push(col / N, row / N, 0);
  for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
    const a = row * (N + 1) + col;
    indices.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
  }
  const edges: ((t: number) => [number, number])[] = [t => [t, 0], t => [1, t], t => [1 - t, 1], t => [0, 1 - t]];
  for (const edge of edges) {
    const start = verts.length / 3;
    for (let i = 0; i <= N; i++) { const [u, v] = edge(i / N); verts.push(u, v, 1); }
    for (let i = 0; i < N; i++) {
      const [u0, v0] = edge(i / N), [u1, v1] = edge((i + 1) / N);
      const top = (u: number, v: number) => Math.round(v * N) * (N + 1) + Math.round(u * N);
      const a = top(u0, v0), b = top(u1, v1), c = start + i, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const empty = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, empty);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 128, 0, 255]));
  function texture(pixels: Uint8ClampedArray): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  function draw(camera: Camera, patches: Patch[]) {
    const dpr = devicePixelRatio || 1;
    const w = Math.max(1, Math.round(camera.width * dpr)), h = Math.max(1, Math.round(camera.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.035, 0.075, 0.12, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program); gl.bindVertexArray(vao);
    const lon = camera.lon * Math.PI / 180, lat = camera.lat * Math.PI / 180;
    const center = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    const east = [-Math.sin(lon), Math.cos(lon), 0];
    const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
    const pitch = camera.pitch * Math.PI / 180;
    const forward = center.map((v, i) => -v * Math.cos(pitch) + north[i] * Math.sin(pitch));
    const up = north.map((v, i) => v * Math.cos(pitch) + center[i] * Math.sin(pitch));
    const eye = center.map((v, i) => v * (R + camera.focusHeight + camera.altitude) - north[i] * camera.altitude * Math.tan(pitch));
    const sun = center.map((v, i) => v + east[i] * 0.5 + north[i] * 0.8);
    const length = Math.hypot(...sun);
    gl.uniform3fv(U.camera, eye); gl.uniform3fv(U.forward, forward); gl.uniform3fv(U.right, east); gl.uniform3fv(U.up, up);
    gl.uniform3fv(U.sun, sun.map(v => v / length));
    gl.uniform1f(U.tanY, Math.tan(Math.PI / 8));
    gl.uniform1f(U.tanX, Math.tan(Math.PI / 8) * w / h);
    gl.uniform1f(U.near, Math.max(10, camera.altitude / 100));
    gl.uniform1f(U.far, Math.hypot(...eye) + R + 200000);
    gl.uniform1f(U.exag, camera.exaggeration);
    gl.uniform1i(U.dem, 0);
    gl.activeTexture(gl.TEXTURE0);
    const drawPatch = (patch: Patch | null) => {
      if (patch) {
        gl.uniform3f(U.tile, patch.z, patch.x, patch.y);
        const ratio = 2 ** (patch.z - patch.sourceZ);
        gl.uniform3f(U.uv, (patch.x - patch.sourceX * ratio) / ratio, (patch.y - patch.sourceY * ratio) / ratio, 1 / ratio);
        gl.uniform1f(U.sourceZoom, patch.sourceZ);
        gl.uniform1f(U.flat, patch.texture ? 0 : 1);
        gl.bindTexture(gl.TEXTURE_2D, patch.texture ?? empty);
      } else {
        gl.uniform3f(U.tile, 0, 0, 0); gl.uniform3f(U.uv, 0, 0, 1);
        gl.uniform1f(U.sourceZoom, 0); gl.uniform1f(U.flat, 1);
        gl.bindTexture(gl.TEXTURE_2D, empty);
      }
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    };
    drawPatch(null); // ocean globe under still-loading tiles and the poles
    for (const patch of patches) drawPatch(patch);
    gl.bindVertexArray(null);
  }
  return { draw, texture, remove: (texture: WebGLTexture) => gl.deleteTexture(texture) };
}
