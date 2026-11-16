import { generateNeonCityGeometry } from './bloom.js';
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
const SCENE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_color;
uniform mat4 u_viewProjection;
out vec3 v_normal;
out vec4 v_color;
void main() {
  v_normal = a_normal;
  v_color = a_color;
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
}
`;
const SCENE_FS = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec4 v_color;
out vec4 fragColor;
void main() {
  // Simple directional lighting for non-emissive parts
  vec3 lightDir = normalize(vec3(0.5, 0.8, 0.4));
  float diff = max(0.15, dot(normalize(v_normal), lightDir));
  
  // If color > 1.0, it's an emissive beacon -> keep full HDR brightness
  vec3 rgb = v_color.rgb;
  if (rgb.r <= 1.0 && rgb.g <= 1.0 && rgb.b <= 1.0) {
    rgb *= diff;
  }
  fragColor = vec4(rgb, v_color.a);
}
`;
const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_threshold;
out vec4 fragColor;
void main() {
  vec4 col = texture(u_texture, v_uv);
  float lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
  if (lum > u_threshold) {
    float factor = (lum - u_threshold) / max(1e-4, lum);
    fragColor = vec4(col.rgb * factor, 1.0);
  } else {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
}
`;
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_direction; // (1.0/w, 0) or (0, 1.0/h)
out vec4 fragColor;

const float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

void main() {
  vec3 result = texture(u_texture, v_uv).rgb * weights[0];
  for (int i = 1; i < 5; i++) {
    vec2 offset = u_direction * float(i) * 1.5;
    result += texture(u_texture, v_uv + offset).rgb * weights[i];
    result += texture(u_texture, v_uv - offset).rgb * weights[i];
  }
  fragColor = vec4(result, 1.0);
}
`;
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sceneTex;
uniform sampler2D u_bloomTex;
uniform float u_bloomIntensity;
uniform float u_bloomEnabled;
out vec4 fragColor;
void main() {
  vec3 scene = texture(u_sceneTex, v_uv).rgb;
  if (u_bloomEnabled > 0.5) {
    vec3 bloom = texture(u_bloomTex, v_uv).rgb;
    scene += bloom * u_bloomIntensity;
  }
  // Simple Reinhard tone mapping
  vec3 mapped = scene / (scene + vec3(1.0));
  // Gamma correction
  mapped = pow(mapped, vec3(1.0 / 2.2));
  fragColor = vec4(mapped, 1.0);
}
`;
export function createBloomRenderer(canvas) {
    const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL2 not supported');
    const sceneProg = createProgram(gl, SCENE_VS, SCENE_FS);
    const locSceneVP = gl.getUniformLocation(sceneProg, 'u_viewProjection');
    const brightProg = createProgram(gl, QUAD_VS, BRIGHT_FS);
    const locBrightTex = gl.getUniformLocation(brightProg, 'u_texture');
    const locBrightThresh = gl.getUniformLocation(brightProg, 'u_threshold');
    const blurProg = createProgram(gl, QUAD_VS, BLUR_FS);
    const locBlurTex = gl.getUniformLocation(blurProg, 'u_texture');
    const locBlurDir = gl.getUniformLocation(blurProg, 'u_direction');
    const compProg = createProgram(gl, QUAD_VS, COMPOSITE_FS);
    const locCompScene = gl.getUniformLocation(compProg, 'u_sceneTex');
    const locCompBloom = gl.getUniformLocation(compProg, 'u_bloomTex');
    const locCompIntensity = gl.getUniformLocation(compProg, 'u_bloomIntensity');
    const locCompEnabled = gl.getUniformLocation(compProg, 'u_bloomEnabled');
    const cityMesh = generateNeonCityGeometry(16);
    const sceneVao = gl.createVertexArray();
    gl.bindVertexArray(sceneVao);
    const posVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posVbo);
    gl.bufferData(gl.ARRAY_BUFFER, cityMesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const normVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normVbo);
    gl.bufferData(gl.ARRAY_BUFFER, cityMesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const colVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colVbo);
    gl.bufferData(gl.ARRAY_BUFFER, cityMesh.colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cityMesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const quadVao = gl.createVertexArray();
    gl.bindVertexArray(quadVao);
    const quadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    const quadVerts = new Float32Array([
        -1,
        -1,
        1,
        -1,
        1,
        1,
        -1,
        -1,
        1,
        1,
        -1,
        1
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    function createFbo(glCtx, w, h, hasDepth) {
        const fbo = glCtx.createFramebuffer();
        glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, fbo);
        const tex = glCtx.createTexture();
        glCtx.bindTexture(glCtx.TEXTURE_2D, tex);
        glCtx.texImage2D(glCtx.TEXTURE_2D, 0, glCtx.RGBA, w, h, 0, glCtx.RGBA, glCtx.UNSIGNED_BYTE, null);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.LINEAR);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MAG_FILTER, glCtx.LINEAR);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.CLAMP_TO_EDGE);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.CLAMP_TO_EDGE);
        glCtx.framebufferTexture2D(glCtx.FRAMEBUFFER, glCtx.COLOR_ATTACHMENT0, glCtx.TEXTURE_2D, tex, 0);
        let depthRb = null;
        if (hasDepth) {
            depthRb = glCtx.createRenderbuffer();
            glCtx.bindRenderbuffer(glCtx.RENDERBUFFER, depthRb);
            glCtx.renderbufferStorage(glCtx.RENDERBUFFER, glCtx.DEPTH_COMPONENT16, w, h);
            glCtx.framebufferRenderbuffer(glCtx.FRAMEBUFFER, glCtx.DEPTH_ATTACHMENT, glCtx.RENDERBUFFER, depthRb);
        }
        glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null);
        return {
            fbo,
            tex,
            depthRb,
            width: w,
            height: h
        };
    }
    let width = canvas.width;
    let height = canvas.height;
    let sceneFbo = createFbo(gl, width, height, true);
    let brightFbo = createFbo(gl, Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)), false);
    let blurHFbo = createFbo(gl, Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)), false);
    let blurVFbo = createFbo(gl, Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)), false);
    function resizeFbos(glCtx, w, h) {
        glCtx.deleteTexture(sceneFbo.tex);
        if (sceneFbo.depthRb) glCtx.deleteRenderbuffer(sceneFbo.depthRb);
        glCtx.deleteFramebuffer(sceneFbo.fbo);
        glCtx.deleteTexture(brightFbo.tex);
        glCtx.deleteFramebuffer(brightFbo.fbo);
        glCtx.deleteTexture(blurHFbo.tex);
        glCtx.deleteFramebuffer(blurHFbo.fbo);
        glCtx.deleteTexture(blurVFbo.tex);
        glCtx.deleteFramebuffer(blurVFbo.fbo);
        sceneFbo = createFbo(glCtx, w, h, true);
        const halfW = Math.max(1, Math.floor(w / 2));
        const halfH = Math.max(1, Math.floor(h / 2));
        brightFbo = createFbo(glCtx, halfW, halfH, false);
        blurHFbo = createFbo(glCtx, halfW, halfH, false);
        blurVFbo = createFbo(glCtx, halfW, halfH, false);
    }
    let yaw = 0.55;
    let pitch = 0.28;
    let distance = 110.0;
    let bloomIntensity = 1.6;
    let bloomEnabled = true;
    let autoRotate = true;
    const projMat = new Float32Array(16);
    const viewMat = new Float32Array(16);
    const vpMat = new Float32Array(16);
    return {
        gl,
        resize (w, h) {
            width = w;
            height = h;
            canvas.width = w;
            canvas.height = h;
            resizeFbos(gl, w, h);
        },
        setCameraAngles (y, p) {
            yaw = y;
            pitch = Math.max(0.05, Math.min(Math.PI * 0.45, p));
        },
        setCameraDistance (d) {
            distance = Math.max(30.0, Math.min(250.0, d));
        },
        setBloomIntensity (val) {
            bloomIntensity = Math.max(0.0, Math.min(5.0, val));
        },
        toggleBloom (val) {
            bloomEnabled = val;
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
                yaw += dt * 0.15;
            }
            mat4Perspective(projMat, Math.PI / 4, width / Math.max(1, height), 1.0, 500.0);
            const eyeY = Math.sin(pitch) * distance + 5.0;
            const rH = Math.cos(pitch) * distance;
            const eyeX = Math.sin(yaw) * rH;
            const eyeZ = Math.cos(yaw) * rH;
            mat4LookAt(viewMat, [
                eyeX,
                eyeY,
                eyeZ
            ], [
                0,
                8.0,
                0
            ], [
                0,
                1,
                0
            ]);
            mat4Multiply(vpMat, projMat, viewMat);
            gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo.fbo);
            gl.viewport(0, 0, width, height);
            gl.clearColor(0.004, 0.004, 0.008, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.depthMask(true);
            gl.disable(gl.BLEND);
            gl.useProgram(sceneProg);
            gl.uniformMatrix4fv(locSceneVP, false, vpMat);
            gl.bindVertexArray(sceneVao);
            gl.drawElements(gl.TRIANGLES, cityMesh.indices.length, gl.UNSIGNED_SHORT, 0);
            if (bloomEnabled) {
                gl.disable(gl.DEPTH_TEST);
                gl.bindFramebuffer(gl.FRAMEBUFFER, brightFbo.fbo);
                gl.viewport(0, 0, brightFbo.width, brightFbo.height);
                gl.clearColor(0, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.useProgram(brightProg);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, sceneFbo.tex);
                gl.uniform1i(locBrightTex, 0);
                gl.uniform1f(locBrightThresh, 0.65);
                gl.bindVertexArray(quadVao);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                gl.bindFramebuffer(gl.FRAMEBUFFER, blurHFbo.fbo);
                gl.viewport(0, 0, blurHFbo.width, blurHFbo.height);
                gl.useProgram(blurProg);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, brightFbo.tex);
                gl.uniform1i(locBlurTex, 0);
                gl.uniform2f(locBlurDir, 1.0 / blurHFbo.width, 0.0);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                gl.bindFramebuffer(gl.FRAMEBUFFER, blurVFbo.fbo);
                gl.viewport(0, 0, blurVFbo.width, blurVFbo.height);
                gl.bindTexture(gl.TEXTURE_2D, blurHFbo.tex);
                gl.uniform2f(locBlurDir, 0.0, 1.0 / blurVFbo.height);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, width, height);
            gl.useProgram(compProg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sceneFbo.tex);
            gl.uniform1i(locCompScene, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, blurVFbo.tex);
            gl.uniform1i(locCompBloom, 1);
            gl.uniform1f(locCompIntensity, bloomIntensity);
            gl.uniform1f(locCompEnabled, bloomEnabled ? 1.0 : 0.0);
            gl.bindVertexArray(quadVao);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.bindVertexArray(null);
        },
        destroy () {
            gl.deleteBuffer(posVbo);
            gl.deleteBuffer(normVbo);
            gl.deleteBuffer(colVbo);
            gl.deleteBuffer(ibo);
            gl.deleteVertexArray(sceneVao);
            gl.deleteBuffer(quadVbo);
            gl.deleteVertexArray(quadVao);
            gl.deleteTexture(sceneFbo.tex);
            if (sceneFbo.depthRb) gl.deleteRenderbuffer(sceneFbo.depthRb);
            gl.deleteFramebuffer(sceneFbo.fbo);
            gl.deleteTexture(brightFbo.tex);
            gl.deleteFramebuffer(brightFbo.fbo);
            gl.deleteTexture(blurHFbo.tex);
            gl.deleteFramebuffer(blurHFbo.fbo);
            gl.deleteTexture(blurVFbo.tex);
            gl.deleteFramebuffer(blurVFbo.fbo);
            gl.deleteProgram(sceneProg);
            gl.deleteProgram(brightProg);
            gl.deleteProgram(blurProg);
            gl.deleteProgram(compProg);
        }
    };
}
