const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec4 a_q;
layout(location=1) in uint a_id;
uniform vec2 u_min,u_quant,u_center,u_size;
uniform float u_pxm,u_mix;
uniform highp usampler2D u_a,u_b;
flat out uint v_id;
out float v_side;
out vec3 v_color;
vec3 palette(uint n){
  if(n==0u)return vec3(26,152,80)/255.0;
  if(n==1u)return vec3(102,189,99)/255.0;
  if(n==2u)return vec3(166,217,106)/255.0;
  if(n==3u)return vec3(217,239,139)/255.0;
  if(n==4u)return vec3(255,255,191)/255.0;
  if(n==5u)return vec3(254,224,139)/255.0;
  if(n==6u)return vec3(253,174,97)/255.0;
  if(n==7u)return vec3(244,109,67)/255.0;
  if(n==8u)return vec3(215,48,39)/255.0;
  return vec3(168,0,0)/255.0;
}
void main(){
  ivec2 texel=ivec2(int(a_id)%256,int(a_id)/256);
  uvec4 oldStyle=texelFetch(u_a,texel,0),newStyle=texelFetch(u_b,texel,0);
  vec2 start=(u_min+a_q.xy*u_quant-u_center)*u_pxm+u_size*0.5;
  vec2 end=(u_min+a_q.zw*u_quant-u_center)*u_pxm+u_size*0.5;
  vec2 tangent=normalize(end-start);
  vec2 normal=vec2(-tangent.y,tangent.x);
  float oldWidth=10.0+float(oldStyle.g)*(1990.0/255.0);
  float newWidth=10.0+float(newStyle.g)*(1990.0/255.0);
  float widthPx=max(0.5,mix(oldWidth,newWidth,u_mix)*u_pxm/0.79);
  bool atStart=(gl_VertexID==0||gl_VertexID==1||gl_VertexID==3);
  float side=(gl_VertexID==0||gl_VertexID==3||gl_VertexID==5)?-1.0:1.0;
  vec2 pixel=(atStart?start:end)+normal*side*widthPx*0.5;
  gl_Position=vec4(pixel/u_size*2.0-1.0,0.0,1.0);
  v_id=a_id+1u;
  v_side=side;
  v_color=mix(palette(oldStyle.r),palette(newStyle.r),u_mix);
}`;
const FS = `#version 300 es
precision highp float;
precision highp int;
flat in uint v_id;
in float v_side;
in vec3 v_color;
uniform int u_pick;
out vec4 color;
void main(){
  if(u_pick==1){color=vec4(float(v_id&255u)/255.0,float((v_id>>8u)&255u)/255.0,0.0,1.0);return;}
  color=vec4(v_color,1.0-smoothstep(0.78,1.0,abs(v_side)));
}`;
function shader(gl, kind, code) {
    const s = gl.createShader(kind);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
    return s;
}
const THRESHOLDS = [
    0,
    4,
    8,
    12,
    20,
    32,
    52,
    84,
    136,
    220
];
export class HighwayMap {
    gl;
    canvas;
    segmentCount;
    roadCount;
    routes;
    stats;
    sampleX;
    sampleY;
    minX;
    minY;
    quantX;
    quantY;
    program;
    uniforms;
    vao;
    styleTextures;
    pickFb;
    pickTexture;
    pickDepth;
    animationStart = 0;
    animationPending = false;
    year = 1990;
    previousYear = 1990;
    centerX;
    centerY;
    zoom = 4;
    constructor(canvas, roads, stats, routes){
        this.canvas = canvas;
        this.routes = routes;
        this.stats = new DataView(stats);
        const header = new DataView(roads);
        if (String.fromCharCode(...new Uint8Array(roads, 0, 4)) !== 'HW01') throw new Error('invalid road mesh');
        if (String.fromCharCode(...new Uint8Array(stats, 0, 4)) !== 'HS01') throw new Error('invalid stats');
        this.segmentCount = header.getUint32(4, true);
        this.roadCount = header.getUint32(8, true);
        if (this.roadCount !== routes.length || this.roadCount !== this.stats.getUint32(4, true) || roads.byteLength !== 28 + this.segmentCount * 10 || stats.byteLength !== 8 + 26 * this.roadCount * 2) throw new Error('road data length mismatch');
        this.minX = header.getFloat32(12, true);
        this.minY = header.getFloat32(16, true);
        this.quantX = header.getFloat32(20, true);
        this.quantY = header.getFloat32(24, true);
        this.sampleX = this.minX + (header.getUint16(28, true) + header.getUint16(32, true)) * 0.5 * this.quantX;
        this.sampleY = this.minY + (header.getUint16(30, true) + header.getUint16(34, true)) * 0.5 * this.quantY;
        const R = 6378137;
        this.centerX = R * -100 * Math.PI / 180;
        this.centerY = R * Math.log(Math.tan(Math.PI / 4 + 38 * Math.PI / 360));
        const gl = canvas.getContext('webgl2', {
            antialias: false,
            depth: false,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance'
        });
        if (!gl) throw new Error('WebGL2 が必要です');
        this.gl = gl;
        const program = gl.createProgram();
        gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
        this.program = program;
        this.uniforms = Object.fromEntries([
            'u_min',
            'u_quant',
            'u_center',
            'u_size',
            'u_pxm',
            'u_mix',
            'u_a',
            'u_b',
            'u_pick'
        ].map((name)=>[
                name,
                gl.getUniformLocation(program, name)
            ]));
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(roads, 28), gl.STATIC_DRAW);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.UNSIGNED_SHORT, false, 10, 0);
        gl.vertexAttribDivisor(0, 1);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 10, 8);
        gl.vertexAttribDivisor(1, 1);
        this.vao = vao;
        this.styleTextures = [
            gl.createTexture(),
            gl.createTexture()
        ];
        for (const [unit, texture] of this.styleTextures.entries()){
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this.uploadStyle(unit, 1990);
        }
        this.pickFb = gl.createFramebuffer();
        this.pickTexture = gl.createTexture();
        this.pickDepth = gl.createRenderbuffer();
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        this.resize();
    }
    get pxm() {
        return 512 * 2 ** this.zoom / 40075016.686 * devicePixelRatio;
    }
    styleOf(year) {
        const height = Math.ceil(this.roadCount / 256), data = new Uint8Array(256 * height * 4);
        for(let i = 0; i < this.roadCount; i++){
            const at = 8 + ((year - 1990) * this.roadCount + i) * 2;
            const incidents = this.stats.getUint8(at), fatalities = this.stats.getUint8(at + 1), length = this.routes[i][4];
            const deaths = fatalities / length * 1000, crashes = incidents / length * 1000;
            let bucket = 0;
            for (const threshold of THRESHOLDS)if (deaths >= threshold) bucket++;
            const width = Math.min(200, crashes) / 200 * 255;
            data[i * 4] = Math.min(9, bucket);
            data[i * 4 + 1] = Math.round(width);
            data[i * 4 + 2] = incidents;
            data[i * 4 + 3] = fatalities;
        }
        return data;
    }
    uploadStyle(unit, year) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this.styleTextures[unit]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, 256, Math.ceil(this.roadCount / 256), 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, this.styleOf(year));
    }
    setYear(year, animate = true) {
        if (year < 1990 || year > 2015) throw new Error('year out of range');
        const started = performance.now();
        this.previousYear = this.year;
        this.year = year;
        this.uploadStyle(0, this.previousYear);
        this.uploadStyle(1, year);
        this.animationStart = animate ? performance.now() : 0;
        this.draw();
        if (animate && !this.animationPending) {
            this.animationPending = true;
            const step = ()=>{
                this.draw();
                if (performance.now() - this.animationStart < 1000) requestAnimationFrame(step);
                else this.animationPending = false;
            };
            requestAnimationFrame(step);
        }
        return performance.now() - started;
    }
    resize() {
        const width = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio)), height = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio));
        if (width !== this.canvas.width || height !== this.canvas.height) {
            const gl = this.gl;
            this.canvas.width = width;
            this.canvas.height = height;
            gl.bindTexture(gl.TEXTURE_2D, this.pickTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTexture, 0);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('pick buffer incomplete');
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        this.draw();
    }
    render(pick) {
        const { gl, canvas } = this;
        gl.bindFramebuffer(gl.FRAMEBUFFER, pick ? this.pickFb : null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(pick ? 0 : 0.05, pick ? 0 : 0.09, pick ? 0 : 0.14, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);
        gl.uniform2f(this.uniforms.u_min, this.minX, this.minY);
        gl.uniform2f(this.uniforms.u_quant, this.quantX, this.quantY);
        gl.uniform2f(this.uniforms.u_center, this.centerX, this.centerY);
        gl.uniform2f(this.uniforms.u_size, canvas.width, canvas.height);
        gl.uniform1f(this.uniforms.u_pxm, this.pxm);
        gl.uniform1f(this.uniforms.u_mix, this.animationStart ? Math.min(1, (performance.now() - this.animationStart) / 1000) : 1);
        gl.uniform1i(this.uniforms.u_a, 0);
        gl.uniform1i(this.uniforms.u_b, 1);
        gl.uniform1i(this.uniforms.u_pick, pick ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.styleTextures[0]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.styleTextures[1]);
        gl.bindVertexArray(this.vao);
        if (pick) gl.disable(gl.BLEND);
        else gl.enable(gl.BLEND);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.segmentCount);
    }
    draw() {
        this.render(false);
    }
    pan(dx, dy) {
        this.centerX -= dx * devicePixelRatio / this.pxm;
        this.centerY += dy * devicePixelRatio / this.pxm;
        this.draw();
    }
    zoomBy(factor) {
        this.zoom = Math.max(2, Math.min(8, this.zoom + Math.log2(factor)));
        this.draw();
    }
    zoomAt(factor, clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const dx = (clientX - rect.left - rect.width / 2) * devicePixelRatio;
        const dy = (clientY - rect.top - rect.height / 2) * devicePixelRatio;
        const beforeX = this.centerX + dx / this.pxm, beforeY = this.centerY - dy / this.pxm;
        this.zoom = Math.max(2, Math.min(8, this.zoom + Math.log2(factor)));
        this.centerX = beforeX - dx / this.pxm;
        this.centerY = beforeY + dy / this.pxm;
        this.draw();
    }
    pick(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((clientX - rect.left) * devicePixelRatio), y = Math.floor((rect.bottom - clientY) * devicePixelRatio);
        if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return null;
        this.render(true);
        const left = Math.max(0, x - 5), bottom = Math.max(0, y - 5);
        const width = Math.min(this.canvas.width - left, 11), height = Math.min(this.canvas.height - bottom, 11);
        const pixels = new Uint8Array(width * height * 4);
        this.gl.readPixels(left, bottom, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        let id = 0, nearest = Infinity;
        for(let py = 0; py < height; py++)for(let px = 0; px < width; px++){
            const at = (py * width + px) * 4, found = pixels[at] + pixels[at + 1] * 256;
            if (!found) continue;
            const distance = (left + px - x) ** 2 + (bottom + py - y) ** 2;
            if (distance < nearest) {
                nearest = distance;
                id = found;
            }
        }
        if (!id || id > this.roadCount) return null;
        const road = id - 1, at = 8 + ((this.year - 1990) * this.roadCount + road) * 2;
        return {
            road,
            route: this.routes[road],
            incidents: this.stats.getUint8(at),
            fatalities: this.stats.getUint8(at + 1)
        };
    }
}
