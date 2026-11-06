import { generateTerrainGrid } from './terrain.js';
const SKY_VS = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.9999, 1.0);
}
`;
const SKY_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec3 zenith = vec3(0.12, 0.34, 0.78);
  vec3 horizon = vec3(0.70, 0.80, 0.90);
  vec3 color = mix(horizon, zenith, clamp(v_uv.y * 1.5 - 0.25, 0.0, 1.0));
  fragColor = vec4(color, 1.0);
}
`;
const TERRAIN_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_proj;
uniform mat4 u_view;
uniform float u_waterLevel;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
out float v_dist;

void main() {
  vec3 pos = a_position;
  // Level water surface if below waterLevel
  if (pos.y < u_waterLevel) {
    pos.y = u_waterLevel;
  }

  vec4 viewPos = u_view * vec4(pos, 1.0);
  v_worldPos = pos;
  v_normal = (a_position.y < u_waterLevel) ? vec3(0.0, 1.0, 0.0) : a_normal;
  v_uv = a_uv;
  v_dist = -viewPos.z;

  gl_Position = u_proj * viewPos;
}
`;
const TERRAIN_FS = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
in float v_dist;

uniform vec3 u_sunDir;
uniform vec3 u_camPos;
uniform float u_waterLevel;
uniform float u_snowLevel;
uniform float u_fogDensity;
uniform bool u_wireframe;

out vec4 fragColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(u_sunDir);
  vec3 V = normalize(u_camPos - v_worldPos);

  float y = v_worldPos.y;
  float slope = 1.0 - N.y;

  // Biome color definitions
  vec3 waterColor = vec3(0.05, 0.22, 0.42);
  vec3 sandColor  = vec3(0.75, 0.68, 0.50);
  vec3 grassColor = vec3(0.24, 0.48, 0.20);
  vec3 rockColor  = vec3(0.44, 0.40, 0.36);
  vec3 snowColor  = vec3(0.95, 0.96, 0.98);

  vec3 surfaceColor;
  float roughness = 0.8;
  float specFactor = 0.05;

  if (y <= u_waterLevel + 0.1) {
    // Water plane
    surfaceColor = waterColor;
    roughness = 0.08;
    specFactor = 0.85;
  } else {
    // Shore sand transition
    float sandFactor = 1.0 - smoothstep(u_waterLevel, u_waterLevel + 6.0, y);
    // Mountain snow transition
    float snowFactor = smoothstep(u_snowLevel, u_snowLevel + 25.0, y) * float(slope < 0.45);
    // Steep rock cliff transition
    float rockFactor = smoothstep(0.25, 0.55, slope) + smoothstep(u_snowLevel * 0.7, u_snowLevel, y) * 0.5;
    rockFactor = clamp(rockFactor, 0.0, 1.0);

    // Blend land biomes
    surfaceColor = mix(grassColor, rockColor, rockFactor);
    surfaceColor = mix(surfaceColor, sandColor, sandFactor);
    surfaceColor = mix(surfaceColor, snowColor, snowFactor);
  }

  // Directional sun lighting
  float NdotL = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 32.0) * specFactor;

  // Ambient sky lighting
  vec3 skyAmbient = vec3(0.55, 0.65, 0.80) * (N.y * 0.35 + 0.45);
  vec3 sunLight = vec3(1.0, 0.96, 0.90) * NdotL;

  vec3 litColor = surfaceColor * (skyAmbient + sunLight) + vec3(spec);

  // Atmospheric distance fog
  vec3 fogColor = vec3(0.70, 0.80, 0.90);
  float fog = 1.0 - exp(-pow(v_dist * u_fogDensity, 1.8));
  fog = clamp(fog, 0.0, 1.0);

  vec3 finalColor = mix(litColor, fogColor, fog);
  fragColor = vec4(finalColor, 1.0);
}
`;
export class ProceduralTerrainRenderer {
    gl;
    skyProg;
    terrainProg;
    skyVao;
    terrainVao;
    terrainIndexCount;
    state = {
        ruggedness: 160,
        waterLevel: -10,
        snowLevel: 95,
        sunAngle: 0.9,
        fogDensity: 0.00045,
        yaw: 0.45,
        pitch: 0.32,
        distance: 1100,
        autoRotate: true
    };
    constructor(canvas){
        const gl = canvas.getContext('webgl2', {
            antialias: true,
            alpha: false
        });
        if (!gl) throw new Error('WebGL2 not supported');
        this.gl = gl;
        this.skyProg = this.createProgram(SKY_VS, SKY_FS);
        this.terrainProg = this.createProgram(TERRAIN_VS, TERRAIN_FS);
        this.skyVao = gl.createVertexArray();
        gl.bindVertexArray(this.skyVao);
        const skyVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, skyVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1,
            -1,
            1,
            -1,
            -1,
            1,
            1,
            1
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        const mesh = generateTerrainGrid(128, 128, 3000, {
            maxAltitude: this.state.ruggedness,
            octaves: 5
        });
        this.terrainIndexCount = mesh.indices.length;
        this.terrainVao = gl.createVertexArray();
        gl.bindVertexArray(this.terrainVao);
        const terrainVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, terrainVbo);
        const vertCount = mesh.positions.length / 3;
        const vertexData = new Float32Array(vertCount * 8);
        for(let i = 0; i < vertCount; i++){
            vertexData[i * 8 + 0] = mesh.positions[i * 3 + 0];
            vertexData[i * 8 + 1] = mesh.positions[i * 3 + 1];
            vertexData[i * 8 + 2] = mesh.positions[i * 3 + 2];
            vertexData[i * 8 + 3] = mesh.normals[i * 3 + 0];
            vertexData[i * 8 + 4] = mesh.normals[i * 3 + 1];
            vertexData[i * 8 + 5] = mesh.normals[i * 3 + 2];
            vertexData[i * 8 + 6] = mesh.uvs[i * 2 + 0];
            vertexData[i * 8 + 7] = mesh.uvs[i * 2 + 1];
        }
        gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
        const terrainIbo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIbo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
        const stride = 8 * 4;
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4);
        gl.bindVertexArray(null);
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
            this.state.pitch = Math.max(0.08, Math.min(1.25, this.state.pitch + dy * 0.005));
            prevX = e.clientX;
            prevY = e.clientY;
        });
        window.addEventListener('mouseup', ()=>{
            dragging = false;
        });
        canvas.addEventListener('wheel', (e)=>{
            e.preventDefault();
            this.state.distance = Math.max(300, Math.min(2500, this.state.distance + e.deltaY * 0.9));
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
        if (this.state.autoRotate) {
            this.state.yaw += dt * 0.07;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const aspect = canvas.width / canvas.height;
        const proj = this.perspective(45 * (Math.PI / 180), aspect, 5.0, 8000.0);
        const camY = 160 + this.state.distance * Math.sin(this.state.pitch);
        const camX = this.state.distance * Math.sin(this.state.yaw) * Math.cos(this.state.pitch);
        const camZ = this.state.distance * Math.cos(this.state.yaw) * Math.cos(this.state.pitch);
        const view = this.lookAt([
            camX,
            camY,
            camZ
        ], [
            0,
            60,
            0
        ], [
            0,
            1,
            0
        ]);
        const sunDir = [
            Math.cos(this.state.sunAngle) * 0.8,
            0.65,
            Math.sin(this.state.sunAngle) * 0.8
        ];
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(this.skyProg);
        gl.bindVertexArray(this.skyVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.useProgram(this.terrainProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainProg, 'u_proj'), false, proj);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainProg, 'u_view'), false, view);
        gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'u_sunDir'), sunDir);
        gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'u_camPos'), [
            camX,
            camY,
            camZ
        ]);
        gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'u_waterLevel'), this.state.waterLevel);
        gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'u_snowLevel'), this.state.snowLevel);
        gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'u_fogDensity'), this.state.fogDensity);
        gl.bindVertexArray(this.terrainVao);
        gl.drawElements(gl.TRIANGLES, this.terrainIndexCount, gl.UNSIGNED_SHORT, 0);
    }
    readPixel(x, y) {
        const pixel = new Uint8Array(4);
        this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
        return pixel;
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
