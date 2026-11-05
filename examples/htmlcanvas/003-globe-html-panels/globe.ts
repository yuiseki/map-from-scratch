// WebGL2 drawing for htmlcanvas-003: a textured globe, a pin per place and
// one textured quad per HTML panel. The panel textures are filled from the
// panel elements with texElementSubImage2D (HTML-in-Canvas); this module only
// owns the GL objects and draws.
import { unitVector, type Mat4 } from './geometry.ts';

const GLOBE_VS = `#version 300 es
in vec3 aPos; in vec2 aUv;
uniform mat4 uM; uniform vec3 uEye;
out vec2 vUv; out float vLight;
void main() {
  gl_Position = uM * vec4(aPos, 1.0);
  vUv = aUv;
  vLight = 0.5 + 0.5 * max(dot(aPos, normalize(uEye - aPos)), 0.0);
}`;
const GLOBE_FS = `#version 300 es
precision highp float;
in vec2 vUv; in float vLight; uniform sampler2D uTex; out vec4 o;
void main() { o = vec4(texture(uTex, vUv).rgb * vLight, 1.0); }`;
// Pins are drawn without the depth test: a point sprite is a flat square at
// the depth of its centre, and near the limb the globe in front of its lower
// half cut it diagonally. The far side is culled here instead.
const PIN_VS = `#version 300 es
in vec3 aPos; uniform mat4 uM; uniform vec3 uEye; uniform float uSize;
void main() {
  gl_Position = dot(aPos, uEye - aPos) > 0.0 ? uM * vec4(aPos, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = uSize;
}`;
const PIN_FS = `#version 300 es
precision mediump float; out vec4 o;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  o = r > 0.62 ? vec4(1.0) : vec4(0.93, 0.27, 0.27, 1.0);
}`;
// The quad covers the element's CSS box; uM maps CSS px of the box to clip.
const PANEL_VS = `#version 300 es
in vec2 aPos; uniform mat4 uM; uniform vec2 uSize; out vec2 vUv;
void main() { vUv = aPos; gl_Position = uM * vec4(aPos * uSize, 0.0, 1.0); }`;
const PANEL_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; out vec4 o;
void main() { o = texture(uTex, vUv); }`;

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

const uniforms = (gl: WebGL2RenderingContext, p: WebGLProgram, names: string[]) =>
  Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)!]));

export interface PanelTexture { tex: WebGLTexture; width: number; height: number }
export interface PanelDraw { matrix: Mat4; cssWidth: number; cssHeight: number; texture: PanelTexture }

export class Globe {
  readonly gl: WebGL2RenderingContext;
  private globe: WebGLProgram; private pin: WebGLProgram; private panel: WebGLProgram;
  private gu: Record<string, WebGLUniformLocation>;
  private pu: Record<string, WebGLUniformLocation>;
  private qu: Record<string, WebGLUniformLocation>;
  private sphereVao: WebGLVertexArrayObject; private pinVao: WebGLVertexArrayObject; private quadVao: WebGLVertexArrayObject;
  private indexCount: number; private pinCount: number;
  private earth: WebGLTexture;
  private m32 = new Float32Array(16);

  constructor(canvas: HTMLCanvasElement, image: HTMLImageElement, places: { lon: number; lat: number }[]) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.globe = program(gl, GLOBE_VS, GLOBE_FS);
    this.pin = program(gl, PIN_VS, PIN_FS);
    this.panel = program(gl, PANEL_VS, PANEL_FS);
    this.gu = uniforms(gl, this.globe, ['uM', 'uEye', 'uTex']);
    this.pu = uniforms(gl, this.pin, ['uM', 'uEye', 'uSize']);
    this.qu = uniforms(gl, this.panel, ['uM', 'uSize', 'uTex']);

    // Sphere: (rows + 1) x (cols + 1) vertices, the seam duplicated for the texture.
    const rows = 64, cols = 128;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      const lon = -180 + 360 * c / cols, lat = 90 - 180 * r / rows;
      pos.push(...unitVector(lon, lat));
      uv.push(c / cols, r / rows);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    this.indexCount = idx.length;
    const attrib = (p: WebGLProgram, name: string, data: Float32Array, size: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(p, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    this.sphereVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.sphereVao);
    attrib(this.globe, 'aPos', new Float32Array(pos), 3);
    attrib(this.globe, 'aUv', new Float32Array(uv), 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

    this.pinVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.pinVao);
    attrib(this.pin, 'aPos', new Float32Array(places.flatMap((p) => unitVector(p.lon, p.lat))), 3);
    this.pinCount = places.length;

    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    attrib(this.panel, 'aPos', new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2);
    gl.bindVertexArray(null);

    this.earth = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.earth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.clearColor(0.02, 0.04, 0.09, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** An immutable texture with a mip chain, sized to the element's snapshot in grid px. */
  createPanelTexture(width: number, height: number): PanelTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(width, height))) + 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, width, height };
  }

  /** Copies the element's last paint into the texture (row 0 = the element's top) and rebuilds the mips. */
  upload(t: PanelTexture, el: Element): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    (gl as unknown as { texElementSubImage2D(target: number, level: number, x: number, y: number, el: Element): void })
      .texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, el);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  deletePanelTexture(t: PanelTexture): void { this.gl.deleteTexture(t.tex); }

  private setMatrix(loc: WebGLUniformLocation, m: Mat4): void {
    this.m32.set(m);
    this.gl.uniformMatrix4fv(loc, false, this.m32);
  }

  /** Panels are drawn in the order given (far first). */
  draw(m: Mat4, eye: number[], panels: PanelDraw[], dpr: number): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.globe);
    this.setMatrix(this.gu.uM, m);
    gl.uniform3f(this.gu.uEye, eye[0], eye[1], eye[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.earth);
    gl.uniform1i(this.gu.uTex, 0);
    gl.bindVertexArray(this.sphereVao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    gl.useProgram(this.panel);
    gl.uniform1i(this.qu.uTex, 0);
    gl.bindVertexArray(this.quadVao);
    // Panels are sorted far to near and never write depth; the pins come
    // after them so they stay visible at the tips of the arrows.
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    for (const p of panels) {
      this.setMatrix(this.qu.uM, p.matrix);
      gl.uniform2f(this.qu.uSize, p.cssWidth, p.cssHeight);
      gl.bindTexture(gl.TEXTURE_2D, p.texture.tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.useProgram(this.pin);
    this.setMatrix(this.pu.uM, m);
    gl.uniform3f(this.pu.uEye, eye[0], eye[1], eye[2]);
    gl.uniform1f(this.pu.uSize, 11 * dpr);
    gl.bindVertexArray(this.pinVao);
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.POINTS, 0, this.pinCount);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }
}
