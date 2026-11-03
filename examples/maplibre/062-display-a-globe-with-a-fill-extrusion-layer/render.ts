// WebGL2: the ocean grid, the lids and the walls are one index buffer drawn
// in one call (three in the flat view, one per world copy). Per-country
// colour and height sit in an N x 1 RGBA32F texture the vertex shader reads
// by id, so hover is one uniform and the data never changes on the GPU.
// Hover picking draws ids with the same vertex shader into an offscreen
// target, scissored to the pixel under the pointer (deckgl 007: a pick pass
// that shares the vertex shader cannot disagree with the picture).
import { MODEL_POS_GLSL, viewProj, viewMatrix, type Camera } from './camera.ts';
import { OCEAN_ID, type Mesh } from './mesh.ts';

// Colours in 0..255, read by the shader source below and by the bench.
export const BG: [number, number, number] = [9, 12, 24];
// A pale sea: viridis runs dark purple to yellow, and a dark blue sea was
// hard to tell from countries near the 0.25 stop (Russia, 59 82 139).
export const OCEAN: [number, number, number] = [196, 208, 222];
// Light: fixed in view space from the upper left, plus ambient. A lid facing
// the eye gets AMBIENT + (1 - AMBIENT) * LIGHT.z of its ramp colour.
export const AMBIENT = 0.42;
export const LIGHT: [number, number, number] = (() => {
  const v = [-0.45, 0.55, 0.7], n = Math.hypot(...v);
  return v.map((x) => x / n) as [number, number, number];
})();
export const HOVER_MIX = 0.4;

const f = (x: number) => x.toFixed(6);
const rgb = (c: number[]) => `vec3(${c.map((x) => f(x / 255)).join(', ')})`;

const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in ivec4 aV;
uniform mat4 uMVP, uView;
uniform vec2 uCenter;
uniform float uT, uOffset;
uniform highp sampler2D uData;
uniform int uHover;
out vec3 vPos;
out vec3 vColor;
out vec3 vN;
flat out int vId;
flat out int vTop;
${MODEL_POS_GLSL}
void main() {
  int id = aV.z;
  float h = 0.0;
  vec3 c = ${rgb(OCEAN)};
  if (id != ${OCEAN_ID}) {
    vec4 d = texelFetch(uData, ivec2(id, 0), 0);
    h = d.a * float(aV.w);
    c = d.rgb;
    if (id == uHover) c = mix(c, vec3(1.0), ${f(HOVER_MIX)});
  }
  vec3 p = modelPos(float(aV.x) * 0.01, float(aV.y) * 0.01, h);
  vPos = (uView * vec4(p, 1.0)).xyz;
  vColor = c;
  vId = id;
  vTop = aV.w;
  // Smooth lid normal: radial on the globe, up on the plane.
  vec3 q = modelPos(float(aV.x) * 0.01, float(aV.y) * 0.01, 0.0);
  vN = mat3(uView) * mix(normalize(q), vec3(0.0, 0.0, 1.0), uT);
  gl_Position = uMVP * vec4(p, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vPos;
in vec3 vColor;
in vec3 vN;
flat in int vId;
flat in int vTop;
uniform bool uPick;
out vec4 o;
void main() {
  if (uPick) {
    int k = vId + 1;
    o = vec4(float(k & 255), float((k >> 8) & 255), 0.0, 255.0) / 255.0;
    return;
  }
  if (vId == ${OCEAN_ID}) { o = vec4(vColor, 1.0); return; }
  // Lids: the smooth surface normal (a flat facet per 3 degree cell showed
  // the grid). Walls: flat shading from the screen-space derivatives, so
  // no normals are shipped.
  vec3 n = normalize(vN);
  if (vTop == 0) {
    n = normalize(cross(dFdx(vPos), dFdy(vPos)));
    if (dot(n, vPos) > 0.0) n = -n;
  }
  float l = ${f(AMBIENT)} + ${f(1 - AMBIENT)} * max(dot(n, vec3(${LIGHT.map(f).join(', ')})), 0.0);
  o = vec4(vColor * l, 1.0);
}`;

export interface CountryStyle { color: [number, number, number]; height: number }

export class Renderer {
  gl: WebGL2RenderingContext;
  mesh: Mesh;
  hover = -1;
  triangles = 0;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private nIdx: number;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private pickFbo: WebGLFramebuffer | null = null;
  private pickSize = [0, 0];

  constructor(canvas: HTMLCanvasElement, mesh: Mesh, styles: CountryStyle[]) {
    const gl = canvas.getContext('webgl2', { antialias: true })!;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.mesh = mesh;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const n of ['uMVP', 'uView', 'uCenter', 'uT', 'uOffset', 'uData', 'uHover', 'uPick']) this.u[n] = gl.getUniformLocation(p, n);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 4, gl.SHORT, 8, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.nIdx = mesh.idx.length;

    // RGBA32F is not filterable: NEAREST keeps the texture complete
    // (pitfalls.md, "An incomplete texture returns zeros").
    const data = new Float32Array(styles.length * 4);
    styles.forEach((s, i) => data.set([s.color[0] / 255, s.color[1] / 255, s.color[2] / 255, s.height], i * 4));
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, styles.length, 1, 0, gl.RGBA, gl.FLOAT, data);
  }

  // World copies the flat view needs to fill the screen; the globe needs one.
  private offsets(cam: Camera): number[] {
    return cam.t >= 1 ? [-360, 0, 360] : [0];
  }

  private pass(cam: Camera, pick: boolean): void {
    const gl = this.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uMVP, false, viewProj(cam, w, h));
    gl.uniformMatrix4fv(this.u.uView, false, Float32Array.from(viewMatrix(cam)));
    gl.uniform2f(this.u.uCenter, cam.lon, cam.lat);
    gl.uniform1f(this.u.uT, cam.t);
    gl.uniform1i(this.u.uData, 0);
    gl.uniform1i(this.u.uHover, pick ? -2 : this.hover);
    gl.uniform1i(this.u.uPick, pick ? 1 : 0);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.vao);
    const offs = this.offsets(cam);
    for (const o of offs) {
      gl.uniform1f(this.u.uOffset, o);
      gl.drawElements(gl.TRIANGLES, this.nIdx, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    this.triangles = (this.nIdx / 3) * offs.length;
  }

  draw(cam: Camera): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(BG[0] / 255, BG[1] / 255, BG[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.pass(cam, false);
  }

  // Country id under a device pixel (y down), or -1 for sea and space.
  pick(cam: Camera, x: number, y: number): number {
    const gl = this.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (!this.pickFbo || this.pickSize[0] !== w || this.pickSize[1] !== h) {
      this.pickFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
      const c = gl.createRenderbuffer(), d = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, c);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
      gl.bindRenderbuffer(gl.RENDERBUFFER, d);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
      this.pickSize = [w, h];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.viewport(0, 0, w, h);
    const px = Math.max(0, Math.min(w - 1, Math.floor(x))), py = Math.max(0, Math.min(h - 1, h - 1 - Math.floor(y)));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(px, py, 1, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.pass(cam, true);
    gl.disable(gl.SCISSOR_TEST);
    const out = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out[0] + out[1] * 256 - 1;
  }
}
