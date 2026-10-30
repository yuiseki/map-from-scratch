// One draw call for the whole country. The vertex shader turns gl_VertexID
// into a grid address, reads the 16-bit height there and at its four
// neighbours (for the normal) and displaces the vertex; the fragment shader
// looks the cell's land-cover class up in a palette, shades it with a fixed
// north-west sun and drops the fragments outside the border. No vertex
// buffers: the geometry is one 32-bit index buffer built once.

import { Z_SCALE, type Relief, type View } from './terrain.ts';

// forge3d's sun for this scene: azimuth 315 deg, elevation 17 deg.
const SUN_AZ = 315, SUN_EL = 17;
const SUN = [
  Math.sin((SUN_AZ * Math.PI) / 180) * Math.cos((SUN_EL * Math.PI) / 180),
  Math.cos((SUN_AZ * Math.PI) / 180) * Math.cos((SUN_EL * Math.PI) / 180),
  Math.sin((SUN_EL * Math.PI) / 180),
];

const VS = `#version 300 es
precision highp float; precision highp int; precision highp usampler2D;
uniform usampler2D u_h;
uniform mat4 u_vp;
uniform ivec2 u_dim;
uniform float u_cell, u_z;
out vec2 v_uv; out vec3 v_n;
float h(ivec2 p) { return float(texelFetch(u_h, clamp(p, ivec2(0), u_dim - 1), 0).r) * u_z; }
void main() {
  int id = gl_VertexID, W = u_dim.x;
  ivec2 p = ivec2(id % W, id / W);
  vec2 c = vec2(u_dim - 1) * 0.5;
  vec3 pos = vec3((float(p.x) - c.x) * u_cell, (c.y - float(p.y)) * u_cell, h(p));
  // Image y grows south, so the north neighbour is p.y - 1.
  v_n = normalize(vec3(h(p - ivec2(1, 0)) - h(p + ivec2(1, 0)), h(p + ivec2(0, 1)) - h(p - ivec2(0, 1)), 2.0 * u_cell));
  v_uv = (vec2(p) + 0.5) / vec2(u_dim);
  gl_Position = u_vp * vec4(pos, 1.0);
}`;

const FS = `#version 300 es
precision highp float; precision highp usampler2D;
in vec2 v_uv; in vec3 v_n;
uniform usampler2D u_cls;
uniform vec3 u_pal[16];
uniform vec3 u_sun;
out vec4 outColor;
void main() {
  uint k = texture(u_cls, v_uv).r;
  if (k == 0u) discard; // outside Switzerland
  // A bright relief shade: never darker than 0.45 so the classes stay readable.
  float shade = 0.45 + 0.75 * max(dot(normalize(v_n), u_sun), 0.0);
  outColor = vec4(min(u_pal[k] * shade, vec3(1.0)), 1.0);
}`;

export interface Renderer { draw(view: View): void; triangles: number }

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export function createRenderer(gl: WebGL2RenderingContext, r: Relief, palette: string[]): Renderer {
  const program = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(program, s);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
  const u = (name: string) => gl.getUniformLocation(program, name);

  const texture = (unit: number, format: number, type: number, data: ArrayBufferView): void => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, r.width, r.height, 0, gl.RED_INTEGER, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  texture(0, gl.R16UI, gl.UNSIGNED_SHORT, r.heights);
  texture(1, gl.R8UI, gl.UNSIGNED_BYTE, r.classes);

  const pal = new Float32Array(16 * 3);
  palette.forEach((hex, i) => pal.set(rgb(hex), i * 3));

  const W = r.width, H = r.height;
  const idx = new Uint32Array((W - 1) * (H - 1) * 6);
  let k = 0;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = y * W + x;
      idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + W;
      idx[k++] = a + 1; idx[k++] = a + W + 1; idx[k++] = a + W;
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  gl.useProgram(program);
  gl.uniform1i(u('u_h'), 0);
  gl.uniform1i(u('u_cls'), 1);
  gl.uniform2i(u('u_dim'), W, H);
  gl.uniform1f(u('u_cell'), r.cellM);
  gl.uniform1f(u('u_z'), Z_SCALE);
  gl.uniform3fv(u('u_pal'), pal);
  gl.uniform3fv(u('u_sun'), SUN);
  const uVp = u('u_vp');

  function draw(view: View): void {
    gl.viewport(0, 0, view.w, view.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);
    gl.uniformMatrix4fv(uVp, false, view.m);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }
  return { draw, triangles: idx.length / 3 };
}
