import { seismicGlyph, type EarthquakeEvent } from './field.ts';

const RINGS = [0.38, 0.69, 1] as const;
const DEPTH_COLORS = {
  shallow: [46 / 255, 245 / 255, 202 / 255],
  intermediate: [1, 190 / 255, 87 / 255],
  deep: [205 / 255, 116 / 255, 1],
} as const;
const STRIDE = 9;

/** Pack source locations once; each earthquake becomes three GPU ring instances. */
export function buildRingInstances(events: readonly EarthquakeEvent[]): Float32Array {
  const rows = new Float32Array(events.length * RINGS.length * STRIDE);
  let offset = 0;
  events.forEach((event, eventIndex) => {
    const glyph = seismicGlyph(event.magnitude, event.depthKm);
    const color = DEPTH_COLORS[glyph.depthBand];
    for (const ringScale of RINGS) {
      rows.set([
        event.longitude / 360,
        0.5 - event.latitude / 360,
        glyph.outerRadius,
        glyph.intensity,
        color[0], color[1], color[2],
        ringScale,
        eventIndex,
      ], offset);
      offset += STRIDE;
    }
  });
  return rows;
}

export interface WebGLView {
  centerX: number;
  centerY: number;
  zoom: number;
  scale: number;
}

export interface WebGLRings {
  resize(): void;
  draw(view: WebGLView, cutoffIndex: number, selectedIndex: number): void;
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_unit;
in vec2 a_center;
in float a_radius;
in float a_intensity;
in vec3 a_color;
in float a_ring;
in float a_event_index;
uniform vec2 u_size;
uniform vec2 u_center;
uniform float u_scale;
uniform float u_zoom;
uniform float u_dpr;
uniform float u_cutoff;
out vec4 v_color;
flat out float v_event_index;
void main() {
  vec2 pixel = vec2(u_size.x * 0.5 + (a_center.x - u_center.x) * u_scale,
                    u_size.y * 0.5 + (a_center.y - u_center.y) * u_scale);
  float radius = a_radius * a_ring * sqrt(u_zoom) * u_dpr;
  vec2 clip = vec2(pixel.x * 2.0 / u_size.x - 1.0, 1.0 - pixel.y * 2.0 / u_size.y);
  vec2 offset = a_unit * vec2(2.0 * radius / u_size.x, 2.0 * radius / u_size.y);
  gl_Position = vec4(clip + offset, 0.0, 1.0);
  if (a_event_index > u_cutoff + 0.5) gl_Position = vec4(3.0, 3.0, 0.0, 1.0);
  float ring_opacity = a_ring < 0.5 ? 0.54 : (a_ring < 0.8 ? 0.77 : 1.0);
  v_color = vec4(a_color, a_intensity * ring_opacity);
  v_event_index = a_event_index;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec4 v_color;
flat in float v_event_index;
uniform float u_selected;
out vec4 out_color;
void main() {
  if (v_color.a < 0.01) discard;
  vec3 color = abs(v_event_index - u_selected) < 0.5 ? vec3(1.0, 0.97, 0.82) : v_color.rgb;
  float alpha = abs(v_event_index - u_selected) < 0.5 ? 0.95 : v_color.a;
  out_color = vec4(color, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'WebGL shader compile failed');
  return shader;
}

export function createWebGLRings(canvas: HTMLCanvasElement, events: readonly EarthquakeEvent[]): WebGLRings {
  const maybeGl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false });
  if (!maybeGl) throw new Error('WebGL2 is not available for earthquake rings');
  const gl: WebGL2RenderingContext = maybeGl;
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to allocate WebGL program');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL program link failed');

  const unitVertices = new Float32Array(64 * 2);
  for (let i = 0; i < 64; i++) {
    const angle = (i / 64) * Math.PI * 2;
    unitVertices[i * 2] = Math.cos(angle);
    unitVertices[i * 2 + 1] = Math.sin(angle);
  }
  const unitBuffer = gl.createBuffer();
  const instanceBuffer = gl.createBuffer();
  if (!unitBuffer || !instanceBuffer) throw new Error('Unable to allocate WebGL ring buffers');
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, unitBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, unitVertices, gl.STATIC_DRAW);
  const unit = gl.getAttribLocation(program, 'a_unit');
  gl.enableVertexAttribArray(unit);
  gl.vertexAttribPointer(unit, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(unit, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, buildRingInstances(events), gl.STATIC_DRAW);
  const attributes: [string, number, number][] = [
    ['a_center', 2, 0], ['a_radius', 1, 2], ['a_intensity', 1, 3],
    ['a_color', 3, 4], ['a_ring', 1, 7], ['a_event_index', 1, 8],
  ];
  for (const [name, size, componentOffset] of attributes) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, componentOffset * 4);
    gl.vertexAttribDivisor(location, 1);
  }

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    size: uniform('u_size'), center: uniform('u_center'), scale: uniform('u_scale'),
    zoom: uniform('u_zoom'), dpr: uniform('u_dpr'), cutoff: uniform('u_cutoff'), selected: uniform('u_selected'),
  };
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  function draw(view: WebGLView, cutoffIndex: number, selectedIndex: number) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(uniforms.size, canvas.width, canvas.height);
    gl.uniform2f(uniforms.center, view.centerX, view.centerY);
    gl.uniform1f(uniforms.scale, view.scale);
    gl.uniform1f(uniforms.zoom, view.zoom);
    gl.uniform1f(uniforms.dpr, window.devicePixelRatio || 1);
    gl.uniform1f(uniforms.cutoff, cutoffIndex);
    gl.uniform1f(uniforms.selected, selectedIndex);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArraysInstanced(gl.LINE_LOOP, 0, 64, events.length * RINGS.length);
  }
  resize();
  return { resize, draw };
}
