const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 a_xy;
layout(location=1) in float a_z;
layout(location=2) in uint a_color;
layout(location=3) in float a_light;
layout(location=4) in uint a_id;
uniform vec2 u_center, u_size;
uniform float u_scale, u_pitch, u_yaw, u_height;
flat out uint v_color, v_id;
out float v_light;
void main() {
  vec2 d=a_xy*0.5-u_center;
  float c=cos(u_yaw), s=sin(u_yaw);
  vec2 r=vec2(c*d.x-s*d.y,s*d.x+c*d.y);
  float z=a_z*0.2*u_height;
  vec2 screen=vec2(r.x,r.y*sin(u_pitch)-z*cos(u_pitch))*u_scale;
  float depth=(-r.y*cos(u_pitch)-z*sin(u_pitch))/50000.0;
  gl_Position=vec4(screen/u_size*2.0,depth,1.0);
  v_color=a_color; v_light=a_light; v_id=a_id;
}`;
const FS = `#version 300 es
precision highp float;
precision highp int;
flat in uint v_color, v_id;
in float v_light;
uniform int u_pick;
out vec4 outColor;
vec3 palette(uint n) {
  if(n==0u)return vec3(65,182,196)/255.0;
  if(n==1u)return vec3(127,205,187)/255.0;
  if(n==2u)return vec3(199,233,180)/255.0;
  if(n==3u)return vec3(237,248,177)/255.0;
  if(n==4u)return vec3(255,255,204)/255.0;
  if(n==5u)return vec3(255,237,160)/255.0;
  if(n==6u)return vec3(254,217,118)/255.0;
  if(n==7u)return vec3(254,178,76)/255.0;
  if(n==8u)return vec3(253,141,60)/255.0;
  if(n==9u)return vec3(252,78,42)/255.0;
  if(n==10u)return vec3(227,26,28)/255.0;
  if(n==11u)return vec3(189,0,38)/255.0;
  return vec3(128,0,38)/255.0;
}
void main() {
  if(u_pick==1) {
    outColor=vec4(float(v_id & 255u)/255.0,float((v_id >> 8u)&255u)/255.0,0.0,1.0);
  } else {
    outColor=vec4(palette(v_color)*(0.48+0.52*v_light),1.0);
  }
}`;

function shader(gl: WebGL2RenderingContext, type: number, code: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, code); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
  return s;
}

export class VancouverMap {
  readonly gl: WebGL2RenderingContext;
  readonly blockCount: number;
  readonly vertexCount: number;
  readonly values: number[][];
  readonly canvas: HTMLCanvasElement;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly pickFb: WebGLFramebuffer;
  private readonly pickTexture: WebGLTexture;
  private readonly pickDepth: WebGLRenderbuffer;
  centerX = 0;
  centerY = 0;
  zoom = 11;
  pitch = 45;
  yaw = 0;
  heightScale = 1;

  constructor(canvas: HTMLCanvasElement, mesh: ArrayBuffer, values: number[][]) {
    this.canvas = canvas;
    this.values = values;
    const header = new DataView(mesh);
    if (String.fromCharCode(...new Uint8Array(mesh,0,4)) !== 'VP01') throw new Error('invalid Vancouver mesh');
    this.vertexCount = header.getUint32(4,true);
    this.blockCount = header.getUint32(8,true);
    if (mesh.byteLength !== 12 + this.vertexCount*10 || values.length !== this.blockCount) throw new Error('mesh size mismatch');
    const gl = canvas.getContext('webgl2', { antialias: true, depth: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 が必要です');
    this.gl = gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program link failed');
    this.program = p;
    this.uniforms = Object.fromEntries(['u_center','u_size','u_scale','u_pitch','u_yaw','u_height','u_pick'].map(
      (name) => [name,gl.getUniformLocation(p,name)!]));
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(mesh,12),gl.STATIC_DRAW);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.SHORT,false,10,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,1,gl.UNSIGNED_SHORT,false,10,4);
    gl.enableVertexAttribArray(2); gl.vertexAttribIPointer(2,1,gl.UNSIGNED_BYTE,10,6);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,1,gl.UNSIGNED_BYTE,true,10,7);
    gl.enableVertexAttribArray(4); gl.vertexAttribIPointer(4,1,gl.UNSIGNED_SHORT,10,8);
    this.vao = vao;
    this.pickFb = gl.createFramebuffer()!;
    this.pickTexture = gl.createTexture()!;
    this.pickDepth = gl.createRenderbuffer()!;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    this.resize();
  }
  get pixelsPerMeter(): number { return 512 * 2 ** this.zoom / (40075016.686 * Math.cos(49.254 * Math.PI/180)) * devicePixelRatio; }
  resize(): void {
    const width = Math.max(1,Math.round(this.canvas.clientWidth*devicePixelRatio));
    const height = Math.max(1,Math.round(this.canvas.clientHeight*devicePixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width=width; this.canvas.height=height;
      const gl=this.gl;
      gl.bindTexture(gl.TEXTURE_2D,this.pickTexture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindRenderbuffer(gl.RENDERBUFFER,this.pickDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,width,height);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.pickFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.pickTexture,0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.pickDepth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('pick framebuffer incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
    this.draw();
  }
  private render(pick: boolean): void {
    const {gl,canvas}=this;
    gl.bindFramebuffer(gl.FRAMEBUFFER,pick?this.pickFb:null);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(pick?0:0.75,pick?0:0.83,pick?0:0.88,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.u_center,this.centerX,this.centerY);
    gl.uniform2f(this.uniforms.u_size,canvas.width,canvas.height);
    gl.uniform1f(this.uniforms.u_scale,this.pixelsPerMeter);
    gl.uniform1f(this.uniforms.u_pitch,this.pitch*Math.PI/180);
    gl.uniform1f(this.uniforms.u_yaw,this.yaw*Math.PI/180);
    gl.uniform1f(this.uniforms.u_height,this.heightScale);
    gl.uniform1i(this.uniforms.u_pick,pick?1:0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES,0,this.vertexCount);
  }
  draw(): void { this.render(false); }
  pick(clientX: number, clientY: number): { id: number; valuePerSqm: number; growth: number } | null {
    const rect=this.canvas.getBoundingClientRect();
    const x=Math.floor((clientX-rect.left)*devicePixelRatio);
    const y=Math.floor((rect.bottom-clientY)*devicePixelRatio);
    if(x<0||y<0||x>=this.canvas.width||y>=this.canvas.height)return null;
    this.render(true);
    const pixel=new Uint8Array(4);
    this.gl.readPixels(x,y,1,1,this.gl.RGBA,this.gl.UNSIGNED_BYTE,pixel);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null);
    const id=pixel[0]+pixel[1]*256;
    if(!id||id>this.blockCount)return null;
    const [valuePerSqm,growth]=this.values[id-1];
    return {id,valuePerSqm,growth};
  }
  pan(dx: number, dy: number): void {
    const c=Math.cos(this.yaw*Math.PI/180),s=Math.sin(this.yaw*Math.PI/180);
    const ux=-dx*devicePixelRatio/this.pixelsPerMeter;
    const uy=dy*devicePixelRatio/(this.pixelsPerMeter*Math.max(0.1,Math.sin(this.pitch*Math.PI/180)));
    this.centerX += c*ux+s*uy;
    this.centerY += -s*ux+c*uy;
    this.draw();
  }
  rotate(dx: number,dy: number): void {
    this.yaw += dx*0.25;
    this.pitch = Math.max(15,Math.min(80,this.pitch+dy*0.2));
    this.draw();
  }
  zoomBy(factor: number): void { this.zoom=Math.max(9,Math.min(16,this.zoom+Math.log2(factor))); this.draw(); }
}
