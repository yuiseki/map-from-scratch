import { generateShadowSceneGeometry, computeSunDirection, mat4Ortho } from './shadows.js';
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
const SHADOW_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
uniform mat4 u_lightViewProjection;
void main() {
  gl_Position = u_lightViewProjection * vec4(a_position, 1.0);
}
`;
const SHADOW_FS = `#version 300 es
precision highp float;
void main() {
  // Depth written automatically
}
`;
const SCENE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_color;

uniform mat4 u_viewProjection;
uniform mat4 u_lightMatrix;

out vec3 v_worldPos;
out vec3 v_normal;
out vec4 v_color;
out vec4 v_shadowCoord;

void main() {
  v_worldPos = a_position;
  v_normal = a_normal;
  v_color = a_color;
  v_shadowCoord = u_lightMatrix * vec4(a_position, 1.0);
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
}
`;
const SCENE_FS = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec4 v_color;
in vec4 v_shadowCoord;

uniform vec3 u_lightDir;
uniform sampler2D u_shadowMap;
uniform float u_shadowsEnabled;

out vec4 fragColor;

float calculateShadow(vec4 sc, vec3 norm, vec3 lightDir) {
  vec3 proj = sc.xyz / sc.w;
  if (proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0 || proj.z > 1.0) {
    return 0.0;
  }

  // Slope-scale depth bias
  float cosTheta = max(0.0, dot(norm, lightDir));
  float bias = max(0.0015, 0.006 * (1.0 - cosTheta));

  // 3x3 Percentage Closer Filtering (PCF)
  float shadow = 0.0;
  vec2 texelSize = vec2(1.0 / 1024.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float pDepth = texture(u_shadowMap, proj.xy + vec2(x, y) * texelSize).r;
      if (proj.z - bias > pDepth) {
        shadow += 1.0;
      }
    }
  }
  return shadow / 9.0;
}

void main() {
  vec3 norm = normalize(v_normal);
  vec3 lightDir = normalize(u_lightDir);

  float diff = max(0.0, dot(norm, lightDir));

  float shadowFactor = 0.0;
  if (u_shadowsEnabled > 0.5) {
    shadowFactor = calculateShadow(v_shadowCoord, norm, lightDir);
  }

  // Ambient lighting 0.25, direct sunlight up to 0.75
  float light = 0.25 + (1.0 - shadowFactor * 0.75) * diff * 0.75;
  vec3 rgb = v_color.rgb * light;

  fragColor = vec4(rgb, 1.0);
}
`;
export function createShadowsRenderer(canvas) {
    const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL2 not supported');
    const shadowProg = createProgram(gl, SHADOW_VS, SHADOW_FS);
    const locShadowVP = gl.getUniformLocation(shadowProg, 'u_lightViewProjection');
    const sceneProg = createProgram(gl, SCENE_VS, SCENE_FS);
    const locSceneVP = gl.getUniformLocation(sceneProg, 'u_viewProjection');
    const locSceneLightMatrix = gl.getUniformLocation(sceneProg, 'u_lightMatrix');
    const locSceneLightDir = gl.getUniformLocation(sceneProg, 'u_lightDir');
    const locSceneShadowMap = gl.getUniformLocation(sceneProg, 'u_shadowMap');
    const locSceneShadowsEnabled = gl.getUniformLocation(sceneProg, 'u_shadowsEnabled');
    const sceneMesh = generateShadowSceneGeometry(10);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posVbo);
    gl.bufferData(gl.ARRAY_BUFFER, sceneMesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const normVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normVbo);
    gl.bufferData(gl.ARRAY_BUFFER, sceneMesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const colVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colVbo);
    gl.bufferData(gl.ARRAY_BUFFER, sceneMesh.colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sceneMesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const shadowSize = 1024;
    const shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    const shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, shadowSize, shadowSize, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let yaw = 0.7;
    let pitch = 0.4;
    let distance = 140.0;
    let sunAzimuth = 0.8;
    let sunElevation = 0.55;
    let autoRotateSun = true;
    let shadowsEnabled = true;
    let width = canvas.width;
    let height = canvas.height;
    const projMat = new Float32Array(16);
    const viewMat = new Float32Array(16);
    const vpMat = new Float32Array(16);
    const lightProj = new Float32Array(16);
    const lightView = new Float32Array(16);
    const lightVP = new Float32Array(16);
    const lightMatrix = new Float32Array(16);
    const biasMat = new Float32Array([
        0.5,
        0.0,
        0.0,
        0.0,
        0.0,
        0.5,
        0.0,
        0.0,
        0.0,
        0.0,
        0.5,
        0.0,
        0.5,
        0.5,
        0.5,
        1.0
    ]);
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
            pitch = Math.max(0.1, Math.min(Math.PI * 0.48, p));
        },
        setCameraDistance (d) {
            distance = Math.max(40.0, Math.min(300.0, d));
        },
        setSunAngles (az, el) {
            sunAzimuth = az;
            sunElevation = Math.max(0.1, Math.min(Math.PI * 0.48, el));
        },
        toggleShadows (enabled) {
            shadowsEnabled = enabled;
        },
        toggleAutoRotate (val) {
            autoRotateSun = val;
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
            if (autoRotateSun) {
                sunAzimuth += dt * 0.2;
            }
            const sunDir = computeSunDirection(sunAzimuth, sunElevation);
            mat4Ortho(lightProj, -75, 75, -75, 75, 1.0, 250.0);
            const lightDist = 120.0;
            const lightEye = [
                sunDir[0] * lightDist,
                sunDir[1] * lightDist,
                sunDir[2] * lightDist
            ];
            mat4LookAt(lightView, lightEye, [
                0,
                5,
                0
            ], [
                0,
                1,
                0
            ]);
            mat4Multiply(lightVP, lightProj, lightView);
            mat4Multiply(lightMatrix, biasMat, lightVP);
            gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
            gl.viewport(0, 0, shadowSize, shadowSize);
            gl.clear(gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.depthMask(true);
            gl.disable(gl.BLEND);
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.FRONT);
            gl.useProgram(shadowProg);
            gl.uniformMatrix4fv(locShadowVP, false, lightVP);
            gl.bindVertexArray(vao);
            gl.drawElements(gl.TRIANGLES, sceneMesh.indices.length, gl.UNSIGNED_SHORT, 0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, width, height);
            gl.clearColor(0.04, 0.06, 0.10, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.cullFace(gl.BACK);
            mat4Perspective(projMat, Math.PI / 4, width / Math.max(1, height), 1.0, 1000.0);
            const eyeY = Math.sin(pitch) * distance + 4.0;
            const rH = Math.cos(pitch) * distance;
            const eyeX = Math.sin(yaw) * rH;
            const eyeZ = Math.cos(yaw) * rH;
            mat4LookAt(viewMat, [
                eyeX,
                eyeY,
                eyeZ
            ], [
                0,
                10.0,
                0
            ], [
                0,
                1,
                0
            ]);
            mat4Multiply(vpMat, projMat, viewMat);
            gl.useProgram(sceneProg);
            gl.uniformMatrix4fv(locSceneVP, false, vpMat);
            gl.uniformMatrix4fv(locSceneLightMatrix, false, lightMatrix);
            gl.uniform3f(locSceneLightDir, sunDir[0], sunDir[1], sunDir[2]);
            gl.uniform1f(locSceneShadowsEnabled, shadowsEnabled ? 1.0 : 0.0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, shadowTex);
            gl.uniform1i(locSceneShadowMap, 0);
            gl.bindVertexArray(vao);
            gl.drawElements(gl.TRIANGLES, sceneMesh.indices.length, gl.UNSIGNED_SHORT, 0);
            gl.bindVertexArray(null);
        },
        destroy () {
            gl.deleteBuffer(posVbo);
            gl.deleteBuffer(normVbo);
            gl.deleteBuffer(colVbo);
            gl.deleteBuffer(ibo);
            gl.deleteVertexArray(vao);
            gl.deleteTexture(shadowTex);
            gl.deleteFramebuffer(shadowFbo);
            gl.deleteProgram(shadowProg);
            gl.deleteProgram(sceneProg);
        }
    };
}
