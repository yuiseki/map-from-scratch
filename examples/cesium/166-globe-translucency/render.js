import { generateLayeredGlobeMesh, generateSubterraneanFeatures } from './translucency.js';
function createShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const err = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(`Shader compile error: ${err}`);
    }
    return s;
}
function createProgram(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const err = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error(`Program link error: ${err}`);
    }
    return p;
}
function mat4Perspective(out, fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
}
function mat4LookAt(out, eye, center, up) {
    let z0 = eye[0] - center[0];
    let z1 = eye[1] - center[1];
    let z2 = eye[2] - center[2];
    let len = Math.hypot(z0, z1, z2) || 1;
    z0 /= len;
    z1 /= len;
    z2 /= len;
    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    len = Math.hypot(x0, x1, x2) || 1;
    x0 /= len;
    x1 /= len;
    x2 /= len;
    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;
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
}
function mat4Multiply(out, a, b) {
    for(let i = 0; i < 4; i++){
        const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
        out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
        out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
        out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
        out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
    }
}
const INTERIOR_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
uniform mat4 u_viewProjection;
uniform mat4 u_model;
out vec3 v_worldNormal;
out vec3 v_worldPos;
void main() {
  vec4 wp = u_model * vec4(a_position, 1.0);
  v_worldPos = wp.xyz;
  v_worldNormal = normalize((u_model * vec4(a_normal, 0.0)).xyz);
  gl_Position = u_viewProjection * wp;
}
`;
const INTERIOR_FS = `#version 300 es
precision highp float;
in vec3 v_worldNormal;
in vec3 v_worldPos;
uniform vec3 u_baseColor;
uniform vec3 u_lightDir;
uniform float u_emissive;
out vec4 fragColor;
void main() {
  vec3 norm = normalize(v_worldNormal);
  float diff = max(0.1, dot(norm, normalize(u_lightDir)));
  vec3 col = u_baseColor * (diff * (1.0 - u_emissive) + u_emissive);
  fragColor = vec4(col, 1.0);
}
`;
const SUBTERRANEAN_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
uniform mat4 u_viewProjection;
out vec4 v_color;
void main() {
  v_color = a_color;
  vec4 cp = u_viewProjection * vec4(a_position, 1.0);
  gl_Position = cp;
  gl_PointSize = clamp(180.0 / cp.w, 4.0, 32.0);
}
`;
const SUBTERRANEAN_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;
void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  float alpha = smoothstep(0.5, 0.0, dist);
  fragColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;
const CRUST_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
uniform mat4 u_viewProjection;
uniform mat4 u_model;
out vec3 v_worldNormal;
out vec3 v_worldPos;
void main() {
  vec4 wp = u_model * vec4(a_position, 1.0);
  v_worldPos = wp.xyz;
  v_worldNormal = normalize((u_model * vec4(a_normal, 0.0)).xyz);
  gl_Position = u_viewProjection * wp;
}
`;
const CRUST_FS = `#version 300 es
precision highp float;
in vec3 v_worldNormal;
in vec3 v_worldPos;
uniform vec3 u_eyePos;
uniform vec3 u_lightDir;
uniform float u_baseAlpha;
uniform float u_fresnelPower;
out vec4 fragColor;

void main() {
  vec3 norm = normalize(v_worldNormal);
  vec3 viewDir = normalize(u_eyePos - v_worldPos);
  float cosTheta = max(0.0, dot(norm, viewDir));

  // Fresnel opacity: high at grazing limb, low at direct facing
  float limb = pow(1.0 - cosTheta, u_fresnelPower);
  float alpha = clamp(u_baseAlpha * 0.25 + (1.0 - u_baseAlpha * 0.25) * limb, 0.05, 0.95);

  // Oceanic/continental surface coloring
  float latFactor = sin(norm.y * 8.0) * cos(norm.x * 6.0);
  vec3 surfaceColor = mix(vec3(0.08, 0.22, 0.55), vec3(0.15, 0.45, 0.28), smoothstep(0.0, 0.3, latFactor));

  // Lighting
  float diff = max(0.2, dot(norm, normalize(u_lightDir)));
  surfaceColor *= diff;

  // Atmosphere edge glow
  vec3 rimColor = vec3(0.3, 0.7, 1.0) * limb * 0.8;
  surfaceColor += rimColor;

  fragColor = vec4(surfaceColor, alpha);
}
`;
export function createTranslucencyRenderer(canvas) {
    const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL2 not supported');
    const interiorProg = createProgram(gl, INTERIOR_VS, INTERIOR_FS);
    const locIntVP = gl.getUniformLocation(interiorProg, 'u_viewProjection');
    const locIntModel = gl.getUniformLocation(interiorProg, 'u_model');
    const locIntColor = gl.getUniformLocation(interiorProg, 'u_baseColor');
    const locIntLight = gl.getUniformLocation(interiorProg, 'u_lightDir');
    const locIntEmissive = gl.getUniformLocation(interiorProg, 'u_emissive');
    const subProg = createProgram(gl, SUBTERRANEAN_VS, SUBTERRANEAN_FS);
    const locSubVP = gl.getUniformLocation(subProg, 'u_viewProjection');
    const crustProg = createProgram(gl, CRUST_VS, CRUST_FS);
    const locCrustVP = gl.getUniformLocation(crustProg, 'u_viewProjection');
    const locCrustModel = gl.getUniformLocation(crustProg, 'u_model');
    const locCrustEye = gl.getUniformLocation(crustProg, 'u_eyePos');
    const locCrustLight = gl.getUniformLocation(crustProg, 'u_lightDir');
    const locCrustAlpha = gl.getUniformLocation(crustProg, 'u_baseAlpha');
    const locCrustPower = gl.getUniformLocation(crustProg, 'u_fresnelPower');
    const globeMesh = generateLayeredGlobeMesh(36, 72, 80.0);
    const subFeatures = generateSubterraneanFeatures(80.0, 48);
    function buildSphereVAO(glCtx, positions, normals, indices) {
        const vao = glCtx.createVertexArray();
        glCtx.bindVertexArray(vao);
        const posVbo = glCtx.createBuffer();
        glCtx.bindBuffer(glCtx.ARRAY_BUFFER, posVbo);
        glCtx.bufferData(glCtx.ARRAY_BUFFER, positions, glCtx.STATIC_DRAW);
        glCtx.enableVertexAttribArray(0);
        glCtx.vertexAttribPointer(0, 3, glCtx.FLOAT, false, 0, 0);
        const normVbo = glCtx.createBuffer();
        glCtx.bindBuffer(glCtx.ARRAY_BUFFER, normVbo);
        glCtx.bufferData(glCtx.ARRAY_BUFFER, normals, glCtx.STATIC_DRAW);
        glCtx.enableVertexAttribArray(1);
        glCtx.vertexAttribPointer(1, 3, glCtx.FLOAT, false, 0, 0);
        const ibo = glCtx.createBuffer();
        glCtx.bindBuffer(glCtx.ELEMENT_ARRAY_BUFFER, ibo);
        glCtx.bufferData(glCtx.ELEMENT_ARRAY_BUFFER, indices, glCtx.STATIC_DRAW);
        glCtx.bindVertexArray(null);
        return {
            vao,
            count: indices.length,
            posVbo,
            normVbo,
            ibo
        };
    }
    const crustBuffers = buildSphereVAO(gl, globeMesh.crustPositions, globeMesh.crustNormals, globeMesh.crustIndices);
    const mantleBuffers = buildSphereVAO(gl, globeMesh.mantlePositions, globeMesh.mantleNormals, globeMesh.mantleIndices);
    const coreBuffers = buildSphereVAO(gl, globeMesh.corePositions, globeMesh.coreNormals, globeMesh.coreIndices);
    const subVao = gl.createVertexArray();
    gl.bindVertexArray(subVao);
    const subBufferData = new Float32Array(subFeatures.length * 7);
    for(let i = 0; i < subFeatures.length; i++){
        const f = subFeatures[i];
        const off = i * 7;
        subBufferData[off + 0] = f.pos[0];
        subBufferData[off + 1] = f.pos[1];
        subBufferData[off + 2] = f.pos[2];
        if (f.type === 'magma_chamber') {
            subBufferData[off + 3] = 1.0;
            subBufferData[off + 4] = 0.3;
            subBufferData[off + 5] = 0.05;
            subBufferData[off + 6] = 1.0;
        } else if (f.type === 'seismic_fault') {
            subBufferData[off + 3] = 0.2;
            subBufferData[off + 4] = 0.8;
            subBufferData[off + 5] = 1.0;
            subBufferData[off + 6] = 1.0;
        } else {
            subBufferData[off + 3] = 1.0;
            subBufferData[off + 4] = 0.85;
            subBufferData[off + 5] = 0.2;
            subBufferData[off + 6] = 1.0;
        }
    }
    const subVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, subVbo);
    gl.bufferData(gl.ARRAY_BUFFER, subBufferData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 7 * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 7 * 4, 3 * 4);
    gl.bindVertexArray(null);
    let yaw = 0.4;
    let pitch = 0.25;
    let distance = 210.0;
    let baseAlpha = 0.35;
    let showSubterranean = true;
    let autoRotate = true;
    let rotation = 0.0;
    let width = canvas.width;
    let height = canvas.height;
    const projMat = new Float32Array(16);
    const viewMat = new Float32Array(16);
    const vpMat = new Float32Array(16);
    const modelMat = new Float32Array(16);
    function updateModelMatrix() {
        const c = Math.cos(rotation);
        const s = Math.sin(rotation);
        modelMat.fill(0);
        modelMat[0] = c;
        modelMat[2] = s;
        modelMat[5] = 1;
        modelMat[8] = -s;
        modelMat[10] = c;
        modelMat[15] = 1;
    }
    return {
        gl,
        resize (w, h) {
            width = w;
            height = h;
            canvas.width = w;
            canvas.height = h;
            gl.viewport(0, 0, w, h);
        },
        setCameraAngles (y, p) {
            yaw = y;
            pitch = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, p));
        },
        setCameraDistance (d) {
            distance = Math.max(90.0, Math.min(500.0, d));
        },
        setBaseAlpha (a) {
            baseAlpha = Math.max(0.05, Math.min(0.95, a));
        },
        toggleSubterranean (val) {
            showSubterranean = val;
        },
        toggleAutoRotate (val) {
            autoRotate = val;
        },
        getCanvas () {
            return canvas;
        },
        readPixel (x, y) {
            const pixel = new Uint8Array(4);
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            return [
                pixel[0],
                pixel[1],
                pixel[2],
                pixel[3]
            ];
        },
        render (dt) {
            if (autoRotate) {
                rotation += dt * 0.2;
            }
            updateModelMatrix();
            mat4Perspective(projMat, Math.PI / 4, width / Math.max(1, height), 1.0, 1000.0);
            const eyeY = Math.sin(pitch) * distance;
            const rH = Math.cos(pitch) * distance;
            const eyeX = Math.sin(yaw) * rH;
            const eyeZ = Math.cos(yaw) * rH;
            mat4LookAt(viewMat, [
                eyeX,
                eyeY,
                eyeZ
            ], [
                0,
                0,
                0
            ], [
                0,
                1,
                0
            ]);
            mat4Multiply(vpMat, projMat, viewMat);
            gl.viewport(0, 0, width, height);
            gl.clearColor(0.02, 0.03, 0.05, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.depthMask(true);
            gl.disable(gl.BLEND);
            gl.useProgram(interiorProg);
            gl.uniformMatrix4fv(locIntVP, false, vpMat);
            gl.uniformMatrix4fv(locIntModel, false, modelMat);
            gl.uniform3f(locIntLight, 0.8, 0.6, 0.5);
            gl.uniform3f(locIntColor, 1.0, 0.88, 0.4);
            gl.uniform1f(locIntEmissive, 0.85);
            gl.bindVertexArray(coreBuffers.vao);
            gl.drawElements(gl.TRIANGLES, coreBuffers.count, gl.UNSIGNED_SHORT, 0);
            gl.uniform3f(locIntColor, 0.85, 0.35, 0.08);
            gl.uniform1f(locIntEmissive, 0.4);
            gl.bindVertexArray(mantleBuffers.vao);
            gl.drawElements(gl.TRIANGLES, mantleBuffers.count, gl.UNSIGNED_SHORT, 0);
            if (showSubterranean) {
                gl.depthMask(false);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
                gl.useProgram(subProg);
                gl.uniformMatrix4fv(locSubVP, false, vpMat);
                gl.bindVertexArray(subVao);
                gl.drawArrays(gl.POINTS, 0, subFeatures.length);
            }
            gl.depthMask(false);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.useProgram(crustProg);
            gl.uniformMatrix4fv(locCrustVP, false, vpMat);
            gl.uniformMatrix4fv(locCrustModel, false, modelMat);
            gl.uniform3f(locCrustEye, eyeX, eyeY, eyeZ);
            gl.uniform3f(locCrustLight, 0.8, 0.6, 0.5);
            gl.uniform1f(locCrustAlpha, baseAlpha);
            gl.uniform1f(locCrustPower, 2.5);
            gl.bindVertexArray(crustBuffers.vao);
            gl.drawElements(gl.TRIANGLES, crustBuffers.count, gl.UNSIGNED_SHORT, 0);
            gl.bindVertexArray(null);
        },
        destroy () {
            gl.deleteBuffer(crustBuffers.posVbo);
            gl.deleteBuffer(crustBuffers.normVbo);
            gl.deleteBuffer(crustBuffers.ibo);
            gl.deleteVertexArray(crustBuffers.vao);
            gl.deleteBuffer(mantleBuffers.posVbo);
            gl.deleteBuffer(mantleBuffers.normVbo);
            gl.deleteBuffer(mantleBuffers.ibo);
            gl.deleteVertexArray(mantleBuffers.vao);
            gl.deleteBuffer(coreBuffers.posVbo);
            gl.deleteBuffer(coreBuffers.normVbo);
            gl.deleteBuffer(coreBuffers.ibo);
            gl.deleteVertexArray(coreBuffers.vao);
            gl.deleteBuffer(subVbo);
            gl.deleteVertexArray(subVao);
            gl.deleteProgram(interiorProg);
            gl.deleteProgram(subProg);
            gl.deleteProgram(crustProg);
        }
    };
}
