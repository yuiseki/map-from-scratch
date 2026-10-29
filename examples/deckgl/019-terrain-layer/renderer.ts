const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 vertex;
uniform sampler2D dem;
uniform vec2 origin;
uniform float span;
uniform vec3 eye, right, up, forward;
uniform float aspect, fov, nearZ, farZ;
out vec2 v_uv;
out float v_height;
void main() {
  vec2 uv=vertex.xy;
  vec3 rgb = texture(dem, uv).rgb * 255.0;
  float h = rgb.r*256.0 + rgb.g + rgb.b/256.0 - 32768.0;
  vec3 pos = vec3(origin.x + uv.x*span, origin.y - uv.y*span, h-vertex.z);
  vec3 p = pos-eye;
  float depth = dot(p, forward);
  float tanHalf = tan(fov*0.5);
  gl_Position = vec4(dot(p,right)/(tanHalf*aspect), dot(p,up)/tanHalf, depth*(farZ+nearZ)/(farZ-nearZ)-2.0*farZ*nearZ/(farZ-nearZ), depth);
  v_uv=uv; v_height=h;
}`;
const FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
in float v_height;
uniform sampler2D imagery;
uniform int surface;
uniform int wireframe;
out vec4 color;
void main() {
  if(wireframe==1){ color=vec4(0.98,0.73,0.29,1.0); return; }
  if(surface==0) color=texture(imagery,v_uv);
  else {
    vec3 low=vec3(0.10,0.30,0.22), high=vec3(0.83,0.78,0.57);
    color=vec4(mix(low,high,clamp(v_height/2200.0,0.0,1.0)),1.0);
  }
}`;
function shader(gl:WebGL2RenderingContext,kind:number,source:string):WebGLShader {
  const s=gl.createShader(kind)!;gl.shaderSource(s,source);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)??'shader compile failed');
  return s;
}
export interface TerrainTile { z:number; x:number; y:number; dem:WebGLTexture; imagery:WebGLTexture; lastUsed:number }
const C=40075016.68557849;
export class TerrainRenderer {
  readonly canvas:HTMLCanvasElement;
  readonly gl:WebGL2RenderingContext;
  private readonly program:WebGLProgram;
  private readonly fillVao:WebGLVertexArrayObject;
  private readonly lineVao:WebGLVertexArrayObject;
  private readonly fillCount:number;
  private readonly lineCount:number;
  private readonly U:Record<string,WebGLUniformLocation|null>;
  readonly tiles=new Map<string,TerrainTile>();
  lon=-122.18; lat=46.2; zoom=12.5; bearing=120; pitch=60;
  wireframe=false; surface=0;
  constructor(canvas:HTMLCanvasElement) {
    this.canvas=canvas;
    const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    if(!gl)throw new Error('WebGL2 is required');this.gl=gl;
    const program=gl.createProgram()!;
    gl.attachShader(program,shader(gl,gl.VERTEX_SHADER,VS));gl.attachShader(program,shader(gl,gl.FRAGMENT_SHADER,FS));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)??'program link failed');
    this.program=program;
    this.U=Object.fromEntries(['dem','imagery','origin','span','eye','right','up','forward','aspect','fov','nearZ','farZ','surface','wireframe'].map(n=>[n,gl.getUniformLocation(program,n)]));
    const N=64, verts:number[]=[], fills:number[]=[], lines:number[]=[];
    for(let row=0;row<=N;row++)for(let col=0;col<=N;col++){
      verts.push(col/N,row/N,0);
    }
    for(let row=0;row<N;row++)for(let col=0;col<N;col++){
      const a=row*(N+1)+col,b=a+1,c=a+N+1,d=c+1;
      fills.push(a,c,b,b,c,d);
      lines.push(a,b,a,c);
    }
    const edges=[
      Array.from({length:N+1},(_,i)=>i),
      Array.from({length:N+1},(_,i)=>i*(N+1)+N),
      Array.from({length:N+1},(_,i)=>N*(N+1)+i),
      Array.from({length:N+1},(_,i)=>i*(N+1)),
    ];
    for(const edge of edges){
      const start=verts.length/3;
      for(const id of edge)verts.push(verts[id*3],verts[id*3+1],600);
      for(let i=0;i<N;i++){
        const a=edge[i],b=edge[i+1],c=start+i,d=c+1;
        fills.push(a,b,c,b,d,c);
      }
    }
    const vbo=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,vbo);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts),gl.STATIC_DRAW);
    const makeVao=(indices:number[]):WebGLVertexArrayObject=>{
      const vao=gl.createVertexArray()!;gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
      gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
      const ibo=gl.createBuffer()!;gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
      return vao;
    };
    this.fillVao=makeVao(fills);this.lineVao=makeVao(lines);
    this.fillCount=fills.length;this.lineCount=lines.length;
    gl.enable(gl.DEPTH_TEST);
    this.resize();
  }
  texture(image:ImageBitmap,nearest=false):WebGLTexture {
    const gl=this.gl,t=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,t);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,nearest?gl.NEAREST:gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,nearest?gl.NEAREST:gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return t;
  }
  remove(key:string):void {
    const tile=this.tiles.get(key);if(!tile)return;
    this.gl.deleteTexture(tile.dem);this.gl.deleteTexture(tile.imagery);this.tiles.delete(key);
  }
  resize():void {
    const dpr=Math.min(2,devicePixelRatio||1);
    this.canvas.width=Math.max(1,Math.round(this.canvas.clientWidth*dpr));
    this.canvas.height=Math.max(1,Math.round(this.canvas.clientHeight*dpr));
    this.draw();
  }
  draw():void {
    const gl=this.gl;
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clearColor(0.035,0.06,0.09,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const rad=Math.PI/180,phi=this.pitch*rad,b=this.bearing*rad;
    const distance=25000*2**(11.5-this.zoom);
    const eye=[Math.sin(b)*Math.sin(phi)*distance,Math.cos(b)*Math.sin(phi)*distance,Math.cos(phi)*distance];
    const forward=[-eye[0]/distance,-eye[1]/distance,-eye[2]/distance];
    const right=[Math.cos(b),-Math.sin(b),0];
    const up=[right[1]*forward[2],-right[0]*forward[2],right[0]*forward[1]-right[1]*forward[0]];
    gl.uniform3fv(this.U.eye,eye);gl.uniform3fv(this.U.forward,forward);
    gl.uniform3fv(this.U.right,right);gl.uniform3fv(this.U.up,up);
    gl.uniform1f(this.U.aspect,this.canvas.width/this.canvas.height);
    gl.uniform1f(this.U.fov,50*rad);gl.uniform1f(this.U.nearZ,10);gl.uniform1f(this.U.farZ,160000);
    gl.uniform1i(this.U.dem,0);gl.uniform1i(this.U.imagery,1);gl.uniform1i(this.U.surface,this.surface);gl.uniform1i(this.U.wireframe,this.wireframe?1:0);
    gl.bindVertexArray(this.wireframe?this.lineVao:this.fillVao);
    const z=Math.max(9,Math.min(12,Math.floor(this.zoom))),n=2**z;
    const fx=(this.lon+180)/360;
    const fy=(1-Math.asinh(Math.tan(this.lat*rad))/Math.PI)/2;
    const scale=Math.cos(this.lat*rad),span=C/n*scale;
    for(const tile of this.tiles.values()) {
      if(tile.z!==z)continue;
      const ox=(tile.x/n-fx)*C*scale,oy=(fy-tile.y/n)*C*scale;
      if(Math.abs(ox)>100000||Math.abs(oy)>100000)continue;
      tile.lastUsed=performance.now();
      gl.uniform2f(this.U.origin,ox,oy);gl.uniform1f(this.U.span,span);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tile.dem);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,tile.imagery);
      gl.drawElements(this.wireframe?gl.LINES:gl.TRIANGLES,this.wireframe?this.lineCount:this.fillCount,gl.UNSIGNED_SHORT,0);
    }
  }
}
