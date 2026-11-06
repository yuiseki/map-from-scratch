import { splitViewport } from './comparison.js';
const VS = `#version 300 es
in vec2 aPosition;
void main(){ gl_Position=vec4(aPosition,0.0,1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec2 uOrigin;
uniform float uMorph;
uniform int uProjection;
uniform vec4 uQuaternion;
uniform sampler2D uLand;
uniform int uHasRoute;
uniform vec3 uRouteA;
uniform vec3 uRouteB;
out vec4 color;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
vec3 rotateQ(vec3 v, vec4 q){ return v + 2.0*cross(q.yzw, cross(q.yzw,v)+q.x*v); }
void main(){
  vec2 local=(gl_FragCoord.xy-uOrigin)/uResolution*2.0-1.0;
  float minDim=min(uResolution.x,uResolution.y);
  vec2 sphereXY=local*uResolution/minDim;
  float radius2=dot(sphereXY,sphereXY);
  vec2 flatXY=local;
  float morph=clamp(uMorph,0.0,1.0);
  float sphereMask=step(radius2,1.0);
  if(uProjection==0 && morph<0.999 && sphereMask<0.5) {
    float star=step(0.997,hash(floor(gl_FragCoord.xy*0.7)))*0.85;
    float neb=0.08*(1.0+sin(local.x*7.0+local.y*11.0));
    color=vec4(vec3(0.015,0.035,0.08)+neb+star,1.0); return;
  }
  vec3 globe=vec3(sqrt(max(0.0,1.0-radius2)),sphereXY);
  vec3 world=rotateQ(globe,vec4(uQuaternion.x,-uQuaternion.yzw));
  float lon=atan(world.y,world.x);
  float lat=asin(clamp(world.z,-1.0,1.0));
  vec2 globeUv=vec2(lon/6.28318530718+0.5,0.5-lat/3.14159265359);
  vec2 flatUv=vec2(0.5+flatXY.x*0.5,0.5-flatXY.y*0.5);
  vec2 uv=mix(globeUv,flatUv,morph);
  if(uProjection==1){ uv=flatUv; morph=1.0; }
  vec4 mask=texture(uLand,uv);
  float light=max(0.0,dot(normalize(world),normalize(vec3(-0.4,0.3,0.85))));
  vec3 ocean=mix(vec3(0.018,0.09,0.19),vec3(0.05,0.34,0.52),light);
  vec3 land=mix(vec3(0.12,0.55,0.42),vec3(0.85,0.68,0.35),light);
  float grid=0.0;
  if(morph<0.1 && uProjection==0){
    float glon=abs(fract((lon+3.14159265)*6.0/3.14159265+0.5)-0.5);
    float glat=abs(fract((lat+1.5707963)*6.0/3.14159265+0.5)-0.5);
    grid=max(1.0-smoothstep(0.012,0.04,min(glon,glat)),0.0)*0.16;
  }
  vec3 surface=mix(ocean,land,smoothstep(0.35,0.65,mask.r));
  surface=mix(surface,vec3(0.62,0.9,1.0),grid);
  surface*=0.58+0.42*light;
  float rim=pow(1.0-max(0.0,globe.z),3.0);
  surface+=vec3(0.02,0.32,0.62)*rim*0.8;
  if(uHasRoute==1 && morph<0.25){
    vec3 n=normalize(cross(uRouteA,uRouteB));
    float plane=abs(dot(n,world));
    float total=acos(clamp(dot(uRouteA,uRouteB),-1.0,1.0));
    float along=acos(clamp(dot(uRouteA,world),-1.0,1.0))+acos(clamp(dot(world,uRouteB),-1.0,1.0));
    float arc=1.0-smoothstep(0.006,0.022,plane+abs(along-total)*0.35);
    surface=mix(surface,vec3(1.0,0.36,0.12),arc*0.9);
  }
  color=vec4(surface,1.0);
}`;
function shader(gl, type, source) {
    const value = gl.createShader(type);
    if (!value) throw new Error('WebGL shader allocation failed');
    gl.shaderSource(value, source);
    gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value) ?? 'shader compile failed');
    return value;
}
const toVec = (lon, lat)=>{
    const l = lon * Math.PI / 180, p = lat * Math.PI / 180;
    return [
        Math.cos(p) * Math.cos(l),
        Math.cos(p) * Math.sin(l),
        Math.sin(p)
    ];
};
export async function mount(canvas, landUrl, comparison = false) {
    const response = await fetch(landUrl);
    if (!response.ok) throw new Error(`land data ${response.status}`);
    const landBitmap = await createImageBitmap(await response.blob());
    const maybeGl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        depth: false,
        powerPreference: 'high-performance'
    });
    if (!maybeGl) throw new Error('WebGL2 unavailable');
    const gl = maybeGl;
    const program = gl.createProgram();
    if (!program) throw new Error('WebGL program allocation failed');
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1,
        -1,
        1,
        -1,
        -1,
        1,
        -1,
        1,
        1,
        -1,
        1,
        1
    ]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, landBitmap);
    landBitmap.close();
    const loc = (name)=>gl.getUniformLocation(program, name);
    const uniforms = {
        resolution: loc('uResolution'),
        origin: loc('uOrigin'),
        morph: loc('uMorph'),
        projection: loc('uProjection'),
        quaternion: loc('uQuaternion'),
        land: loc('uLand'),
        hasRoute: loc('uHasRoute'),
        routeA: loc('uRouteA'),
        routeB: loc('uRouteB')
    };
    gl.uniform1i(uniforms.land, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    let morph = 0, quaternion = [
        1,
        0,
        0,
        0
    ], route = null;
    let dpr = 1;
    function drawPanel(x, width, projection) {
        gl.viewport(x, 0, width, canvas.height);
        gl.uniform2f(uniforms.resolution, width, canvas.height);
        gl.uniform2f(uniforms.origin, x, 0);
        gl.uniform1i(uniforms.projection, projection);
        gl.uniform1f(uniforms.morph, projection ? 1 : morph);
        gl.uniform4f(uniforms.quaternion, ...quaternion);
        gl.uniform1i(uniforms.hasRoute, route ? 1 : 0);
        const a = route ? toVec(...route[0]) : [
            1,
            0,
            0
        ];
        const b = route ? toVec(...route[1]) : [
            0,
            1,
            0
        ];
        gl.uniform3f(uniforms.routeA, ...a);
        gl.uniform3f(uniforms.routeB, ...b);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    function draw() {
        dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round((canvas.clientWidth || innerWidth) * dpr));
        const height = Math.max(1, Math.round((canvas.clientHeight || innerHeight) * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(0.01, 0.02, 0.05, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (comparison) {
            const [left, right] = splitViewport(width, height, Math.max(1, Math.round(dpr)));
            drawPanel(left[0], left[2], 0);
            drawPanel(right[0], right[2], 1);
        } else drawPanel(0, width, 0);
    }
    window.addEventListener('resize', draw);
    draw();
    return {
        canvas,
        gl,
        draw,
        setMorph (value) {
            morph = Math.max(0, Math.min(1, value));
            draw();
        },
        setQuaternion (value) {
            quaternion = value;
            draw();
        },
        setRoute (a, b) {
            route = [
                a,
                b
            ];
            draw();
        },
        destroy () {
            window.removeEventListener('resize', draw);
            gl.deleteTexture(texture);
            gl.deleteBuffer(buffer);
            gl.deleteProgram(program);
        }
    };
}
