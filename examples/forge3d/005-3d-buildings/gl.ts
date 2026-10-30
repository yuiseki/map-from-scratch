// Two draws per frame: the ground plane with a 100 m grid, and every
// building in one indexed draw. A vertex is four uint16: the quantized
// position and the index of its building. Normals are not stored: the
// fragment shader takes the face normal from the screen-space derivatives
// of the world position, which also tells roofs (facing up) from walls.
// The same mesh drawn with the building index as colour answers clicks.

import type { View } from './camera.ts';

export interface Mesh {
  vertices: Uint16Array; // x, y, z, building per vertex
  indices: Uint16Array;
  origin: number[]; // world position of quantized (0, 0, 0), relative to the scene centre
  step: number[]; // metres per quantization step
  groundZ: number;
  extent: number; // half-size of the ground plane, m
}

const SUN = [-0.5, 0.62, 0.6]; // from the north-west, high
const BUILDING_VS = `#version 300 es
precision highp float; precision highp int;
layout(location = 0) in uvec4 a;
uniform mat4 u_vp; uniform vec3 u_origin, u_step;
out vec3 v_w; flat out uint v_b;
void main() {
  v_w = u_origin + vec3(a.xyz) * u_step;
  v_b = a.w;
  gl_Position = u_vp * vec4(v_w, 1.0);
}`;
const BUILDING_FS = `#version 300 es
precision highp float; precision highp int;
in vec3 v_w; flat in uint v_b;
uniform vec3 u_sun, u_eye; uniform uint u_sel; uniform bool u_pick;
out vec4 o;
void main() {
  if (u_pick) { o = vec4(float(v_b & 255u), float(v_b >> 8u), 0.0, 255.0) / 255.0; return; }
  vec3 n = normalize(cross(dFdx(v_w), dFdy(v_w)));
  if (dot(n, u_eye - v_w) < 0.0) n = -n; // face the eye whatever the winding
  bool roof = abs(n.z) > 0.5;
  vec3 c = roof ? vec3(0.71, 0.47, 0.36) : vec3(0.62, 0.55, 0.50);
  if (v_b == u_sel) c = vec3(0.96, 0.62, 0.04);
  float light = 0.55 + 0.5 * max(dot(n, normalize(u_sun)), 0.0);
  o = vec4(c * light, 1.0);
}`;
const GROUND_VS = `#version 300 es
precision highp float;
uniform mat4 u_vp; uniform float u_ext, u_z;
out vec2 v_xy;
void main() {
  vec2 c = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  v_xy = c * u_ext;
  gl_Position = u_vp * vec4(v_xy, u_z, 1.0);
}`;
const GROUND_FS = `#version 300 es
precision highp float;
in vec2 v_xy; uniform bool u_pick;
out vec4 o;
void main() {
  if (u_pick) { o = vec4(0.0); return; }
  // A 100 m grid, one pixel wide at any zoom.
  vec2 g = abs(fract(v_xy / 100.0 + 0.5) - 0.5) / fwidth(v_xy / 100.0);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  o = vec4(mix(vec3(0.78, 0.81, 0.77), vec3(0.42, 0.46, 0.43), line * 0.8), 1.0);
}`;

export interface Renderer {
  draw(view: View, selected: number): void;
  pick(view: View, x: number, y: number): number; // building index under device px (x, y down), 0 for none
  triangles: number;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

export function createRenderer(gl: WebGL2RenderingContext, mesh: Mesh): Renderer {
  const bp = program(gl, BUILDING_VS, BUILDING_FS);
  const gp = program(gl, GROUND_VS, GROUND_FS);
  const bu = (n: string) => gl.getUniformLocation(bp, n);
  const gu = (n: string) => gl.getUniformLocation(gp, n);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_SHORT, 8, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const emptyVao = gl.createVertexArray();

  gl.useProgram(bp);
  gl.uniform3fv(bu('u_origin'), mesh.origin);
  gl.uniform3fv(bu('u_step'), mesh.step);
  gl.uniform3fv(bu('u_sun'), SUN);
  gl.useProgram(gp);
  gl.uniform1f(gu('u_ext'), mesh.extent);
  gl.uniform1f(gu('u_z'), mesh.groundZ);

  // Offscreen target for picking, resized on demand.
  const fbo = gl.createFramebuffer();
  const colour = gl.createRenderbuffer(), depth = gl.createRenderbuffer();
  let fw = 0, fh = 0;

  function pass(view: View, selected: number, pick: boolean): void {
    gl.viewport(0, 0, view.w, view.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(gp);
    gl.uniformMatrix4fv(gu('u_vp'), false, view.m);
    gl.uniform1i(gu('u_pick'), pick ? 1 : 0);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.useProgram(bp);
    gl.uniformMatrix4fv(bu('u_vp'), false, view.m);
    gl.uniform3fv(bu('u_eye'), view.eye);
    gl.uniform1ui(bu('u_sel'), selected);
    gl.uniform1i(bu('u_pick'), pick ? 1 : 0);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  return {
    triangles: mesh.indices.length / 3,
    draw: (view, selected) => pass(view, selected, false),
    pick(view, x, y) {
      if (fw !== view.w || fh !== view.h) {
        fw = view.w; fh = view.h;
        gl.bindRenderbuffer(gl.RENDERBUFFER, colour);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, fw, fh);
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, fw, fh);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colour);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.disable(gl.BLEND);
      pass(view, 0, true);
      const px = new Uint8Array(4);
      gl.readPixels(Math.round(x), Math.round(view.h - 1 - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return px[3] ? px[0] + px[1] * 256 : 0;
    },
  };
}
