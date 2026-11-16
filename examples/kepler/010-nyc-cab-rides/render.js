function mat4Identity() {
    const m = new Float32Array(16);
    m[0] = 1;
    m[5] = 1;
    m[10] = 1;
    m[15] = 1;
    return m;
}
function mat4Multiply(out, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[4];
    b1 = b[5];
    b2 = b[6];
    b3 = b[7];
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[8];
    b1 = b[9];
    b2 = b[10];
    b3 = b[11];
    out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[12];
    b1 = b[13];
    b2 = b[14];
    b3 = b[15];
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return out;
}
function mat4Perspective(fovyRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovyRad / 2);
    const nf = 1 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
}
const BASE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_color;

uniform mat4 u_mvp;
out vec3 v_color;

void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_color = a_color;
}
`;
const BASE_FS = `#version 300 es
precision highp float;
in vec3 v_color;
out vec4 fragColor;

void main() {
  fragColor = vec4(v_color, 1.0);
}
`;
const TRIPS_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in float a_timestamp;
layout(location = 2) in vec3 a_color;

uniform mat4 u_mvp;
out float v_timestamp;
out vec3 v_color;

void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_timestamp = a_timestamp;
  v_color = a_color;
}
`;
const TRIPS_FS = `#version 300 es
precision highp float;

in float v_timestamp;
in vec3 v_color;

uniform float u_currentTime;
uniform float u_trailLength;

out vec4 fragColor;

void main() {
  float age = u_currentTime - v_timestamp;
  if (age < 0.0 || age > u_trailLength) {
    discard;
  }

  // Fading trail intensity (head = 1.0, tail = 0.0)
  float t = 1.0 - (age / u_trailLength);
  float intensity = pow(t, 1.4);

  // Intense glowing head
  vec3 headGlow = vec3(1.2, 1.15, 1.0);
  vec3 rgb = v_color * headGlow * intensity;
  fragColor = vec4(rgb, intensity);
}
`;
export class CabTripsRenderer {
    gl;
    baseProg;
    tripsProg;
    uBaseMvp;
    uTripsMvp;
    uCurrentTime;
    uTrailLength;
    baseVao;
    tripsVao;
    tripSegmentCount;
    constructor(canvas, mesh){
        const gl = canvas.getContext('webgl2', {
            antialias: true,
            alpha: false
        });
        if (!gl) throw new Error('WebGL2 not supported');
        this.gl = gl;
        const bvs = this.compileShader(gl.VERTEX_SHADER, BASE_VS);
        const bfs = this.compileShader(gl.FRAGMENT_SHADER, BASE_FS);
        this.baseProg = this.linkProgram(bvs, bfs);
        this.uBaseMvp = gl.getUniformLocation(this.baseProg, 'u_mvp');
        const tvs = this.compileShader(gl.VERTEX_SHADER, TRIPS_VS);
        const tfs = this.compileShader(gl.FRAGMENT_SHADER, TRIPS_FS);
        this.tripsProg = this.linkProgram(tvs, tfs);
        this.uTripsMvp = gl.getUniformLocation(this.tripsProg, 'u_mvp');
        this.uCurrentTime = gl.getUniformLocation(this.tripsProg, 'u_currentTime');
        this.uTrailLength = gl.getUniformLocation(this.tripsProg, 'u_trailLength');
        this.baseVao = gl.createVertexArray();
        gl.bindVertexArray(this.baseVao);
        const R = 9000;
        const gPos = new Float32Array([
            -R,
            -R,
            0,
            R,
            -R,
            0,
            R,
            R,
            0,
            -R,
            -R,
            0,
            R,
            R,
            0,
            -R,
            R,
            0
        ]);
        const gCol = new Float32Array([
            0.06,
            0.08,
            0.11,
            0.06,
            0.08,
            0.11,
            0.06,
            0.08,
            0.11,
            0.06,
            0.08,
            0.11,
            0.06,
            0.08,
            0.11,
            0.06,
            0.08,
            0.11
        ]);
        const bpBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bpBuf);
        gl.bufferData(gl.ARRAY_BUFFER, gPos, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        const bcBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bcBuf);
        gl.bufferData(gl.ARRAY_BUFFER, gCol, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        this.tripsVao = gl.createVertexArray();
        gl.bindVertexArray(this.tripsVao);
        const tpBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tpBuf);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        const ttBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, ttBuf);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.timestamps, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
        const tcBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tcBuf);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.colors, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
        this.tripSegmentCount = mesh.count;
        gl.bindVertexArray(null);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.lineWidth(3.0);
    }
    compileShader(type, src) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Shader error');
        return s;
    }
    linkProgram(vs, fs) {
        const gl = this.gl;
        const p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'Link error');
        return p;
    }
    render(pitchDeg, bearingDeg, distance, currentTime) {
        const gl = this.gl;
        const w = gl.canvas.width;
        const h = gl.canvas.height;
        gl.viewport(0, 0, w, h);
        gl.clearColor(0.04, 0.05, 0.08, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const aspect = w / h;
        const proj = mat4Perspective(48 * Math.PI / 180, aspect, 10, 25000);
        const pitchRad = pitchDeg * Math.PI / 180;
        const bearingRad = bearingDeg * Math.PI / 180;
        const cx = distance * Math.sin(bearingRad) * Math.sin(pitchRad);
        const cy = -distance * Math.cos(bearingRad) * Math.sin(pitchRad);
        const cz = distance * Math.cos(pitchRad);
        const target = [
            0,
            0,
            0
        ];
        const eye = [
            cx + target[0],
            cy + target[1],
            cz + target[2]
        ];
        const up = [
            0,
            0,
            1
        ];
        const view = this.lookAt(eye, target, up);
        const mvp = mat4Identity();
        mat4Multiply(mvp, proj, view);
        gl.useProgram(this.baseProg);
        gl.uniformMatrix4fv(this.uBaseMvp, false, mvp);
        gl.bindVertexArray(this.baseVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.useProgram(this.tripsProg);
        gl.uniformMatrix4fv(this.uTripsMvp, false, mvp);
        gl.uniform1f(this.uCurrentTime, currentTime);
        gl.uniform1f(this.uTrailLength, 90.0);
        gl.bindVertexArray(this.tripsVao);
        gl.drawArrays(gl.LINES, 0, this.tripSegmentCount);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
    }
    lookAt(eye, center, up) {
        let z0 = eye[0] - center[0];
        let z1 = eye[1] - center[1];
        let z2 = eye[2] - center[2];
        let len = 1 / Math.hypot(z0, z1, z2);
        z0 *= len;
        z1 *= len;
        z2 *= len;
        let x0 = up[1] * z2 - up[2] * z1;
        let x1 = up[2] * z0 - up[0] * z2;
        let x2 = up[0] * z1 - up[1] * z0;
        len = 1 / Math.hypot(x0, x1, x2);
        x0 *= len;
        x1 *= len;
        x2 *= len;
        const y0 = z1 * x2 - z2 * x1;
        const y1 = z2 * x0 - z0 * x2;
        const y2 = z0 * x1 - z1 * x0;
        const out = mat4Identity();
        out[0] = x0;
        out[1] = y0;
        out[2] = z0;
        out[3] = 0;
        out[4] = x1;
        out[5] = y1;
        out[6] = z1;
        out[7] = 0;
        out[8] = x2;
        out[9] = y2;
        out[10] = z2;
        out[11] = 0;
        out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
        out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
        out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
        out[15] = 1;
        return out;
    }
    readPixel(x, y) {
        const gl = this.gl;
        const pixels = new Uint8Array(4);
        gl.readPixels(x, gl.canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
    }
}
