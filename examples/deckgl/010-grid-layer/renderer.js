const VS = `#version 300 es
precision highp int;
layout(location=0) in vec2 a_position;
layout(location=1) in uint a_bucket;
uniform vec2 u_center;
uniform vec2 u_viewport;
uniform float u_pixels_per_meter;
uniform float u_point_size;
uniform float u_cell_size;
uniform int u_tree;
out float v_bucket;
void main() {
  vec2 position=u_tree==1?a_position:(a_position+0.5)*u_cell_size;
  vec2 pixel=(position-u_center)*u_pixels_per_meter+u_viewport*0.5;
  gl_Position=vec4(pixel/u_viewport*2.0-1.0,0.0,1.0);
  gl_PointSize=u_point_size;
  v_bucket=float(a_bucket);
}`;
const FS = `#version 300 es
precision highp float;
precision highp int;
in float v_bucket;
uniform float u_opacity;
uniform int u_tree;
out vec4 color;
void main() {
  if(u_tree==1) {
    if(length(gl_PointCoord-0.5)>0.5) discard;
    color=vec4(0.68,0.87,0.56,u_opacity);
    return;
  }
  if(abs(gl_PointCoord.x-0.5)>0.45 || abs(gl_PointCoord.y-0.5)>0.45) discard;
  vec3 c=vec3(0.0,0.408,0.216);
  if(v_bucket>4.5)c=vec3(1.0,1.0,0.8);
  else if(v_bucket>3.5)c=vec3(0.851,0.941,0.639);
  else if(v_bucket>2.5)c=vec3(0.678,0.867,0.557);
  else if(v_bucket>1.5)c=vec3(0.471,0.776,0.475);
  else if(v_bucket>0.5)c=vec3(0.192,0.639,0.329);
  color=vec4(c,u_opacity);
}`;
const SIZES = [
    2048,
    1024,
    512,
    256,
    128,
    64,
    32,
    16
];
const CIRCUMFERENCE = 40075016.686;
const LATITUDE = 48.857;
const METERS_PER_PIXEL_0 = CIRCUMFERENCE * Math.cos(LATITUDE * Math.PI / 180) / 512;
const clamp = (x, low, high)=>Math.max(low, Math.min(high, x));
function compile(gl, kind, code) {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
    return shader;
}
export class TreeMap {
    canvas;
    gl;
    treeCount;
    species;
    layers;
    treeBuffer;
    treeVao;
    program;
    uniforms;
    centerX = 0;
    centerY = 0;
    zoom = 11.5;
    cellPixels = 24;
    fadeWidth = 0.5;
    activeBand = 0;
    treeBins = new Map();
    gridMaps = new Map();
    treeX(data, index) {
        return this.read24(data, 8 + index * 10) / 20;
    }
    treeY(data, index) {
        return this.read24(data, 8 + index * 10 + 3) / 20;
    }
    read24(data, at) {
        const value = data.getUint8(at) | data.getUint8(at + 1) << 8 | data.getUint8(at + 2) << 16;
        return value << 8 >> 8;
    }
    constructor(canvas, rawTrees, grids, species){
        this.canvas = canvas;
        this.treeBuffer = rawTrees;
        this.species = species;
        const view = new DataView(rawTrees);
        if (String.fromCharCode(...new Uint8Array(rawTrees, 0, 4)) !== 'TR02') throw new Error('invalid tree header');
        this.treeCount = view.getUint32(4, true);
        if (rawTrees.byteLength !== 8 + this.treeCount * 10) throw new Error('invalid tree data length');
        const gl = canvas.getContext('webgl2', {
            antialias: false,
            preserveDrawingBuffer: true,
            depth: false
        });
        if (!gl) throw new Error('WebGL2 が必要です');
        this.gl = gl;
        const program = gl.createProgram();
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
        this.program = program;
        this.uniforms = Object.fromEntries([
            'u_center',
            'u_viewport',
            'u_pixels_per_meter',
            'u_point_size',
            'u_cell_size',
            'u_opacity',
            'u_tree'
        ].map((name)=>[
                name,
                gl.getUniformLocation(program, name)
            ]));
        const makeVao = (bytes, offset, bucketType, stride, positionType, bucketOffset)=>{
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(bytes, offset), gl.STATIC_DRAW);
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, positionType, false, stride, 0);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribIPointer(1, 1, bucketType, stride, bucketOffset);
            return vao;
        };
        const expanded = new ArrayBuffer(this.treeCount * 12);
        const expandedView = new DataView(expanded);
        for(let i = 0; i < this.treeCount; i++){
            const at = i * 12, compact = 8 + i * 10;
            expandedView.setFloat32(at, this.treeX(view, i), true);
            expandedView.setFloat32(at + 4, this.treeY(view, i), true);
            expandedView.setUint16(at + 8, view.getUint16(compact + 6, true), true);
            expandedView.setUint16(at + 10, view.getUint16(compact + 8, true), true);
        }
        this.treeVao = makeVao(expanded, 0, gl.UNSIGNED_SHORT, 12, gl.FLOAT, 10);
        this.layers = grids.map((bytes, i)=>{
            const data = new DataView(bytes);
            if (String.fromCharCode(...new Uint8Array(bytes, 0, 4)) !== 'GC01') throw new Error('invalid grid header');
            const count = data.getUint32(4, true), size = data.getUint32(8, true);
            if (size !== SIZES[i] || bytes.byteLength !== 12 + count * 8) throw new Error('invalid grid data length');
            return {
                size,
                count,
                buffer: bytes,
                vao: makeVao(bytes, 12, gl.UNSIGNED_BYTE, 8, gl.SHORT, 6)
            };
        });
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        this.resize();
    }
    get pixelsPerMeter() {
        return 2 ** this.zoom / METERS_PER_PIXEL_0 * devicePixelRatio;
    }
    handover(i) {
        return Math.log2(this.cellPixels * METERS_PER_PIXEL_0 / SIZES[i]) + 0.5;
    }
    bandOpacity(i) {
        const half = this.fadeWidth / 2;
        const fadeIn = i === 0 ? 1 : clamp((this.zoom - this.handover(i - 1) + half) / this.fadeWidth, 0, 1);
        const fadeOut = i === SIZES.length ? 1 : clamp((this.handover(i) + half - this.zoom) / this.fadeWidth, 0, 1);
        return Math.min(fadeIn, fadeOut);
    }
    get activeLabel() {
        return this.activeBand === SIZES.length ? '個々の樹木' : `${SIZES[this.activeBand]} m 格子`;
    }
    resize() {
        const width = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio));
        const height = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
        this.draw();
    }
    draw() {
        const { gl } = this;
        gl.clearColor(0.055, 0.095, 0.13, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);
        gl.uniform2f(this.uniforms.u_center, this.centerX, this.centerY);
        gl.uniform2f(this.uniforms.u_viewport, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.u_pixels_per_meter, this.pixelsPerMeter);
        let dominant = 0, dominantOpacity = -1;
        for(let i = 0; i <= SIZES.length; i++){
            const opacity = this.bandOpacity(i);
            if (opacity > dominantOpacity) {
                dominant = i;
                dominantOpacity = opacity;
            }
            if (opacity <= 0) continue;
            gl.uniform1f(this.uniforms.u_opacity, opacity * 0.9);
            gl.uniform1i(this.uniforms.u_tree, i === SIZES.length ? 1 : 0);
            if (i === SIZES.length) {
                gl.uniform1f(this.uniforms.u_cell_size, 0);
                gl.uniform1f(this.uniforms.u_point_size, (2 + clamp((this.zoom - 16) / 4, 0, 1) * 4) * devicePixelRatio);
                gl.bindVertexArray(this.treeVao);
                gl.drawArrays(gl.POINTS, 0, this.treeCount);
            } else {
                const layer = this.layers[i];
                gl.uniform1f(this.uniforms.u_cell_size, layer.size);
                gl.uniform1f(this.uniforms.u_point_size, layer.size * this.pixelsPerMeter);
                gl.bindVertexArray(layer.vao);
                gl.drawArrays(gl.POINTS, 0, layer.count);
            }
        }
        this.activeBand = dominant;
    }
    screenToLocal(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return [
            this.centerX + (clientX - rect.left - rect.width / 2) * devicePixelRatio / this.pixelsPerMeter,
            this.centerY - (clientY - rect.top - rect.height / 2) * devicePixelRatio / this.pixelsPerMeter
        ];
    }
    pan(deltaX, deltaY) {
        this.centerX -= deltaX * devicePixelRatio / this.pixelsPerMeter;
        this.centerY += deltaY * devicePixelRatio / this.pixelsPerMeter;
        this.draw();
    }
    zoomAt(factor, clientX, clientY) {
        const [x0, y0] = this.screenToLocal(clientX, clientY);
        this.zoom = clamp(this.zoom + Math.log2(factor), 9, 20);
        const [x1, y1] = this.screenToLocal(clientX, clientY);
        this.centerX += x0 - x1;
        this.centerY += y0 - y1;
        this.draw();
    }
    hover(clientX, clientY) {
        const [x, y] = this.screenToLocal(clientX, clientY);
        if (this.activeBand < SIZES.length) {
            const layer = this.layers[this.activeBand];
            let index = this.gridMaps.get(layer.size);
            if (!index) {
                index = new Map();
                const data = new DataView(layer.buffer);
                for(let i = 0; i < layer.count; i++){
                    const at = 12 + i * 8;
                    const gx = data.getInt16(at, true);
                    const gy = data.getInt16(at + 2, true);
                    index.set(`${gx},${gy}`, {
                        count: data.getUint16(at + 4, true)
                    });
                }
                this.gridMaps.set(layer.size, index);
            }
            const cell = index.get(`${Math.floor(x / layer.size)},${Math.floor(y / layer.size)}`);
            return cell ? `${cell.count.toLocaleString('ja-JP')} 本 · ${layer.size} m 格子` : null;
        }
        if (!this.treeBins.size) {
            const data = new DataView(this.treeBuffer);
            for(let i = 0; i < this.treeCount; i++){
                const key = `${Math.floor(this.treeX(data, i) / 32)},${Math.floor(this.treeY(data, i) / 32)}`;
                const list = this.treeBins.get(key);
                if (list) list.push(i);
                else this.treeBins.set(key, [
                    i
                ]);
            }
        }
        const data = new DataView(this.treeBuffer);
        let closest = -1, minDist = (7 / this.pixelsPerMeter) ** 2;
        const bx = Math.floor(x / 32), by = Math.floor(y / 32);
        for(let dy = -1; dy <= 1; dy++)for(let dx = -1; dx <= 1; dx++){
            for (const i of this.treeBins.get(`${bx + dx},${by + dy}`) ?? []){
                const dist = (this.treeX(data, i) - x) ** 2 + (this.treeY(data, i) - y) ** 2;
                if (dist < minDist) {
                    minDist = dist;
                    closest = i;
                }
            }
        }
        if (closest < 0) return null;
        const at = 8 + closest * 10;
        const name = this.species[data.getUint16(at + 8, true)] || '樹種不明';
        const circumference = data.getUint16(at + 6, true);
        return circumference ? `${name} · 幹周 ${circumference} cm` : name;
    }
}
export const gridSizes = SIZES;
