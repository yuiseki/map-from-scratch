const VERT = `#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D u_temperature;
uniform vec2 u_size;
uniform float u_scale;
uniform float u_step;
out vec4 color;

float xco(float p) {
  float p2=p*p, p4=p2*p2;
  return 0.8707-0.131979*p2+p4*(-0.013791+p4*(0.003971*p2-0.001529*p4));
}
float yy(float p) {
  float p2=p*p, p4=p2*p2;
  return p*(1.007226+p2*(0.015085+p4*(-0.044475+0.028874*p2-0.005916*p4)));
}
float sampleTemp(vec2 uv) {
  ivec2 p=ivec2(mod(floor(uv.x),720.0),clamp(floor(uv.y),0.0,360.0));
  return float(texelFetch(u_temperature,p,0).r)*0.01-100.0;
}
vec3 ramp(float t) {
  t=clamp(t,0.0,1.0);
  vec3 a=vec3(0.08,0.02,0.28), b=vec3(0.35,0.07,0.48);
  vec3 c=vec3(0.68,0.18,0.40), d=vec3(0.91,0.38,0.28);
  vec3 e=vec3(0.99,0.71,0.34), f=vec3(0.99,0.97,0.72);
  if(t<0.2)return mix(a,b,t*5.0);
  if(t<0.4)return mix(b,c,(t-0.2)*5.0);
  if(t<0.6)return mix(c,d,(t-0.4)*5.0);
  if(t<0.8)return mix(d,e,(t-0.6)*5.0);
  return mix(e,f,(t-0.8)*5.0);
}
void main() {
  vec2 xy=(gl_FragCoord.xy-u_size*0.5)/u_scale;
  float p=clamp(xy.y,-1.57,1.57);
  for(int i=0;i<6;i++) {
    float dy=(yy(p+0.0005)-yy(p-0.0005))/0.001;
    p=clamp(p-(yy(p)-xy.y)/max(dy,0.1),-1.57,1.57);
  }
  float lon=xy.x/xco(p);
  if(abs(lon)>3.141593 || abs(p)>1.570797 || abs(yy(p)-xy.y)>0.002) {
    color=vec4(0.07,0.13,0.20,1.0); return;
  }
  vec2 uv=vec2(mod(lon*114.59156+720.0,720.0),(1.5707963-p)*114.59156);
  float v=sampleTemp(uv);
  float band=floor(v/u_step);
  float edge=step(0.001,abs(band-floor(sampleTemp(uv+vec2(1.0,0.0))/u_step)))
            +step(0.001,abs(band-floor(sampleTemp(uv+vec2(0.0,1.0))/u_step)));
  vec3 fill=ramp((band*u_step+75.0)/145.0);
  color=vec4(mix(fill,vec3(0.035,0.04,0.07),min(edge,1.0)*0.72),1.0);
}`;

function shader(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const s = gl.createShader(kind)!;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader failed');
  return s;
}

export class TemperatureMap {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  readonly count: number;
  private readonly program: WebGLProgram;
  private readonly size: WebGLUniformLocation;
  private readonly scale: WebGLUniformLocation;
  private readonly stepUniform: WebGLUniformLocation;
  step = 5;
  constructor(canvas: HTMLCanvasElement, bytes: ArrayBuffer) {
    this.canvas = canvas;
    const view = new DataView(bytes);
    if (String.fromCharCode(...new Uint8Array(bytes, 0, 4)) !== 'GT01') throw new Error('invalid data header');
    const width = view.getUint32(4, true), height = view.getUint32(8, true);
    if (width !== 720 || height !== 361 || bytes.byteLength !== 12 + width * height * 2) throw new Error('invalid raster dimensions');
    this.count = width * height;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, depth: false });
    if (!gl) throw new Error('WebGL2 が必要です');
    this.gl = gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    this.program = program;
    this.size = gl.getUniformLocation(program, 'u_size')!;
    this.scale = gl.getUniformLocation(program, 'u_scale')!;
    this.stepUniform = gl.getUniformLocation(program, 'u_step')!;
    gl.useProgram(program);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT,
      new Uint16Array(bytes, 12));
    if (gl.getError() !== gl.NO_ERROR) throw new Error('temperature texture upload failed');
    gl.bindVertexArray(gl.createVertexArray());
    this.resize();
  }
  resize(): void {
    const width = Math.round(this.canvas.clientWidth * devicePixelRatio);
    const height = Math.round(this.canvas.clientHeight * devicePixelRatio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
    this.draw();
  }
  draw(): void {
    const { gl, canvas } = this;
    gl.useProgram(this.program);
    gl.uniform2f(this.size, canvas.width, canvas.height);
    gl.uniform1f(this.scale, Math.min(canvas.width / 5.5, canvas.height / 2.9));
    gl.uniform1f(this.stepUniform, this.step);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  setStep(step: number): void { this.step = step; this.draw(); }
}
