import { computeOrbitPosition, EmitterTrail, packTailParticles } from './tails.js';
const PLANET_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;

uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_model;

out vec3 v_normal;
out vec3 v_worldPos;

void main() {
  vec4 wp = u_model * vec4(a_position, 1.0);
  v_worldPos = wp.xyz;
  v_normal = normalize(mat3(u_model) * a_normal);
  gl_Position = u_proj * u_view * wp;
}
`;
const PLANET_FS = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec3 v_worldPos;

uniform vec3 u_lightDir;
uniform vec3 u_baseColor;

out vec4 fragColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(u_lightDir);
  float diff = max(dot(N, L), 0.0);
  vec3 color = u_baseColor * (0.2 + 0.8 * diff);
  fragColor = vec4(color, 1.0);
}
`;
const TAIL_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in float a_size;
layout(location = 2) in vec3 a_color;
layout(location = 3) in float a_alpha;

uniform mat4 u_proj;
uniform mat4 u_view;

out vec3 v_color;
out float v_alpha;

void main() {
  v_color = a_color;
  v_alpha = a_alpha;

  vec4 viewPos = u_view * vec4(a_position, 1.0);
  gl_Position = u_proj * viewPos;
  gl_PointSize = clamp(a_size * (600.0 / -viewPos.z), 2.0, 64.0);
}
`;
const TAIL_FS = `#version 300 es
precision highp float;

in vec3 v_color;
in float v_alpha;

out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord) * 2.0;
  if (dist > 1.0) discard;

  float glow = pow(1.0 - dist, 1.6);
  fragColor = vec4(v_color * 1.5, glow * v_alpha);
}
`;
export class TailsRenderer {
    gl;
    planetProg;
    tailProg;
    sphereVao;
    sphereIndexCount;
    tailVao;
    tailVbo;
    cometTrail = new EmitterTrail([
        1.0,
        0.65,
        0.15
    ], 1500);
    probeTrail = new EmitterTrail([
        0.15,
        0.85,
        1.0
    ], 1200);
    cometTheta = 0.0;
    probeTheta = 2.0;
    prevCometPos = [
        0,
        0,
        0
    ];
    prevProbePos = [
        0,
        0,
        0
    ];
    state = {
        orbitSpeed: 1.2,
        emissionRate: 15,
        yaw: 0.6,
        pitch: 0.35,
        distance: 850,
        autoRotate: true
    };
    constructor(canvas){
        const gl = canvas.getContext('webgl2', {
            antialias: true,
            alpha: false
        });
        if (!gl) throw new Error('WebGL2 not supported');
        this.gl = gl;
        this.planetProg = this.createProgram(PLANET_VS, PLANET_FS);
        this.tailProg = this.createProgram(TAIL_VS, TAIL_FS);
        const { positions, normals, indices } = this.generateSphere(24, 32, 1.0);
        this.sphereIndexCount = indices.length;
        this.sphereVao = gl.createVertexArray();
        gl.bindVertexArray(this.sphereVao);
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        const vertCount = positions.length / 3;
        const vertexData = new Float32Array(vertCount * 6);
        for(let i = 0; i < vertCount; i++){
            vertexData[i * 6 + 0] = positions[i * 3 + 0];
            vertexData[i * 6 + 1] = positions[i * 3 + 1];
            vertexData[i * 6 + 2] = positions[i * 3 + 2];
            vertexData[i * 6 + 3] = normals[i * 3 + 0];
            vertexData[i * 6 + 4] = normals[i * 3 + 1];
            vertexData[i * 6 + 5] = normals[i * 3 + 2];
        }
        gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
        const ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        const stride = 6 * 4;
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
        this.tailVao = gl.createVertexArray();
        gl.bindVertexArray(this.tailVao);
        this.tailVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tailVbo);
        const tailStride = 8 * 4;
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, tailStride, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 1, gl.FLOAT, false, tailStride, 3 * 4);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 3, gl.FLOAT, false, tailStride, 4 * 4);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, tailStride, 7 * 4);
        gl.bindVertexArray(null);
        this.prevCometPos = computeOrbitPosition(this.cometTheta, 380, 260, 0.45);
        this.prevProbePos = computeOrbitPosition(this.probeTheta, 230, 220, -0.75);
        this.setupInteraction(canvas);
    }
    createProgram(vsSource, fsSource) {
        const gl = this.gl;
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            throw new Error(`VS: ${gl.getShaderInfoLog(vs)}`);
        }
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            throw new Error(`FS: ${gl.getShaderInfoLog(fs)}`);
        }
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error(`Link: ${gl.getProgramInfoLog(prog)}`);
        }
        return prog;
    }
    generateSphere(latBands, lonBands, radius) {
        const positions = [];
        const normals = [];
        const indices = [];
        for(let lat = 0; lat <= latBands; lat++){
            const theta = lat * Math.PI / latBands;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            for(let lon = 0; lon <= lonBands; lon++){
                const phi = lon * 2 * Math.PI / lonBands;
                const x = Math.cos(phi) * sinTheta;
                const y = cosTheta;
                const z = Math.sin(phi) * sinTheta;
                normals.push(x, y, z);
                positions.push(radius * x, radius * y, radius * z);
            }
        }
        for(let lat = 0; lat < latBands; lat++){
            for(let lon = 0; lon < lonBands; lon++){
                const first = lat * (lonBands + 1) + lon;
                const second = first + lonBands + 1;
                indices.push(first, second, first + 1);
                indices.push(second, second + 1, first + 1);
            }
        }
        return {
            positions: new Float32Array(positions),
            normals: new Float32Array(normals),
            indices: new Uint16Array(indices)
        };
    }
    setupInteraction(canvas) {
        let dragging = false;
        let prevX = 0;
        let prevY = 0;
        canvas.addEventListener('mousedown', (e)=>{
            dragging = true;
            this.state.autoRotate = false;
            prevX = e.clientX;
            prevY = e.clientY;
        });
        window.addEventListener('mousemove', (e)=>{
            if (!dragging) return;
            const dx = e.clientX - prevX;
            const dy = e.clientY - prevY;
            this.state.yaw += dx * 0.005;
            this.state.pitch = Math.max(-1.4, Math.min(1.4, this.state.pitch + dy * 0.005));
            prevX = e.clientX;
            prevY = e.clientY;
        });
        window.addEventListener('mouseup', ()=>{
            dragging = false;
        });
        canvas.addEventListener('wheel', (e)=>{
            e.preventDefault();
            this.state.distance = Math.max(250, Math.min(1800, this.state.distance + e.deltaY * 0.8));
        }, {
            passive: false
        });
    }
    render(dt = 0.016) {
        const gl = this.gl;
        const canvas = gl.canvas;
        if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
        }
        this.cometTheta += this.state.orbitSpeed * 0.8 * dt;
        this.probeTheta += this.state.orbitSpeed * 1.4 * dt;
        const cometPos = computeOrbitPosition(this.cometTheta, 380, 260, 0.45);
        const probePos = computeOrbitPosition(this.probeTheta, 230, 220, -0.75);
        const cometVel = [
            (cometPos[0] - this.prevCometPos[0]) / Math.max(dt, 0.001),
            (cometPos[1] - this.prevCometPos[1]) / Math.max(dt, 0.001),
            (cometPos[2] - this.prevCometPos[2]) / Math.max(dt, 0.001)
        ];
        const probeVel = [
            (probePos[0] - this.prevProbePos[0]) / Math.max(dt, 0.001),
            (probePos[1] - this.prevProbePos[1]) / Math.max(dt, 0.001),
            (probePos[2] - this.prevProbePos[2]) / Math.max(dt, 0.001)
        ];
        this.prevCometPos = cometPos;
        this.prevProbePos = probePos;
        this.cometTrail.emit(cometPos, cometVel, this.state.emissionRate);
        this.probeTrail.emit(probePos, probeVel, Math.floor(this.state.emissionRate * 0.8));
        this.cometTrail.update(dt);
        this.probeTrail.update(dt);
        if (this.state.autoRotate) {
            this.state.yaw += dt * 0.1;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.015, 0.02, 0.035, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const aspect = canvas.width / canvas.height;
        const proj = this.perspective(50 * (Math.PI / 180), aspect, 5.0, 5000.0);
        const camX = this.state.distance * Math.sin(this.state.yaw) * Math.cos(this.state.pitch);
        const camY = this.state.distance * Math.sin(this.state.pitch);
        const camZ = this.state.distance * Math.cos(this.state.yaw) * Math.cos(this.state.pitch);
        const view = this.lookAt([
            camX,
            camY,
            camZ
        ], [
            0,
            0,
            0
        ], [
            0,
            1,
            0
        ]);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.useProgram(this.planetProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.planetProg, 'u_proj'), false, proj);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.planetProg, 'u_view'), false, view);
        gl.uniform3fv(gl.getUniformLocation(this.planetProg, 'u_lightDir'), [
            0.8,
            0.5,
            0.3
        ]);
        gl.bindVertexArray(this.sphereVao);
        const earthModel = this.scaleMatrix(100);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.planetProg, 'u_model'), false, earthModel);
        gl.uniform3fv(gl.getUniformLocation(this.planetProg, 'u_baseColor'), [
            0.12,
            0.35,
            0.65
        ]);
        gl.drawElements(gl.TRIANGLES, this.sphereIndexCount, gl.UNSIGNED_SHORT, 0);
        const cometModel = this.translationScaleMatrix(cometPos, 10);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.planetProg, 'u_model'), false, cometModel);
        gl.uniform3fv(gl.getUniformLocation(this.planetProg, 'u_baseColor'), [
            1.0,
            0.8,
            0.3
        ]);
        gl.drawElements(gl.TRIANGLES, this.sphereIndexCount, gl.UNSIGNED_SHORT, 0);
        const probeModel = this.translationScaleMatrix(probePos, 6);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.planetProg, 'u_model'), false, probeModel);
        gl.uniform3fv(gl.getUniformLocation(this.planetProg, 'u_baseColor'), [
            0.3,
            0.9,
            1.0
        ]);
        gl.drawElements(gl.TRIANGLES, this.sphereIndexCount, gl.UNSIGNED_SHORT, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.depthMask(false);
        const allParticles = [
            ...this.cometTrail.getParticles(),
            ...this.probeTrail.getParticles()
        ];
        const tailBuffer = packTailParticles(allParticles);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tailVbo);
        gl.bufferData(gl.ARRAY_BUFFER, tailBuffer, gl.DYNAMIC_DRAW);
        gl.useProgram(this.tailProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.tailProg, 'u_proj'), false, proj);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.tailProg, 'u_view'), false, view);
        gl.bindVertexArray(this.tailVao);
        gl.drawArrays(gl.POINTS, 0, allParticles.length);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
    }
    getTotalParticles() {
        return this.cometTrail.getParticles().length + this.probeTrail.getParticles().length;
    }
    readPixel(x, y) {
        const pixel = new Uint8Array(4);
        this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
        return pixel;
    }
    scaleMatrix(s) {
        return new Float32Array([
            s,
            0,
            0,
            0,
            0,
            s,
            0,
            0,
            0,
            0,
            s,
            0,
            0,
            0,
            0,
            1
        ]);
    }
    translationScaleMatrix(pos, s) {
        return new Float32Array([
            s,
            0,
            0,
            0,
            0,
            s,
            0,
            0,
            0,
            0,
            s,
            0,
            pos[0],
            pos[1],
            pos[2],
            1
        ]);
    }
    perspective(fov, aspect, near, far) {
        const f = 1.0 / Math.tan(fov / 2);
        const nf = 1.0 / (near - far);
        return new Float32Array([
            f / aspect,
            0,
            0,
            0,
            0,
            f,
            0,
            0,
            0,
            0,
            (far + near) * nf,
            -1,
            0,
            0,
            2 * far * near * nf,
            0
        ]);
    }
    lookAt(eye, target, up) {
        let z0 = eye[0] - target[0];
        let z1 = eye[1] - target[1];
        let z2 = eye[2] - target[2];
        const lenZ = Math.hypot(z0, z1, z2);
        z0 /= lenZ;
        z1 /= lenZ;
        z2 /= lenZ;
        let x0 = up[1] * z2 - up[2] * z1;
        let x1 = up[2] * z0 - up[0] * z2;
        let x2 = up[0] * z1 - up[1] * z0;
        const lenX = Math.hypot(x0, x1, x2);
        x0 /= lenX;
        x1 /= lenX;
        x2 /= lenX;
        const y0 = z1 * x2 - z2 * x1;
        const y1 = z2 * x0 - z0 * x2;
        const y2 = z0 * x1 - z1 * x0;
        return new Float32Array([
            x0,
            y0,
            z0,
            0,
            x1,
            y1,
            z1,
            0,
            x2,
            y2,
            z2,
            0,
            -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
            -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
            -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
            1
        ]);
    }
}
