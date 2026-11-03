import {
  type CityMesh,
  buildBlockCityGeometry,
  generateSampleKernel,
  generateNoiseTexture,
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
} from './ssao.ts';

function createShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile error: ${err}`);
  }
  return s;
}

function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const p = gl.createProgram()!;
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

// 1. Geometry Pass Shaders
const VS_GEOM = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_color;

uniform mat4 u_view;
uniform mat4 u_proj;

out vec3 v_viewPos;
out vec3 v_viewNormal;
out vec4 v_color;

void main() {
  vec4 viewP = u_view * vec4(a_position, 1.0);
  v_viewPos = viewP.xyz;
  // Normal matrix = upper 3x3 of view matrix for rigid camera transforms
  v_viewNormal = mat3(u_view) * a_normal;
  v_color = a_color;
  gl_Position = u_proj * viewP;
}
`;

const FS_GEOM = `#version 300 es
precision highp float;

in vec3 v_viewPos;
in vec3 v_viewNormal;
in vec4 v_color;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outNormalDepth;

void main() {
  // Simple directional lighting for base albedo
  vec3 lightDir = normalize(vec3(0.5, 0.8, 0.6));
  vec3 n = normalize(v_viewNormal);
  float diff = max(0.0, dot(n, lightDir));
  float amb = 0.35;
  vec3 lit = v_color.rgb * (diff * 0.65 + amb);

  outColor = vec4(lit, 1.0);
  // Store view normal in rgb, linear view-space depth in a (viewPos.z is negative in front of camera)
  outNormalDepth = vec4(n, -v_viewPos.z);
}
`;

// 2. Fullscreen Quad
const VS_QUAD = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;

void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// 3. SSAO Generation Shader
const FS_SSAO = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_normalDepthTex;
uniform sampler2D u_noiseTex;
uniform vec3 u_samples[16];
uniform mat4 u_proj;
uniform mat4 u_invProj;
uniform vec2 u_screenSize;
uniform float u_radius;
uniform float u_bias;

vec3 reconstructViewPos(vec2 uv, float linearDepth) {
  vec2 ndc = uv * 2.0 - 1.0;
  // Eye ray in view space
  vec4 clip = vec4(ndc, -1.0, 1.0);
  vec4 viewRay = u_invProj * clip;
  viewRay /= viewRay.w;
  // Scale along ray direction by linear depth
  return viewRay.xyz * (linearDepth / -viewRay.z);
}

void main() {
  vec4 normDepth = texture(u_normalDepthTex, v_uv);
  float depth = normDepth.w;
  vec3 normal = normDepth.xyz;

  // Background sky (no occlusion)
  if (depth > 400.0 || length(normal) < 0.1) {
    fragColor = vec4(1.0);
    return;
  }

  vec3 fragPos = reconstructViewPos(v_uv, depth);

  // Tile 4x4 noise texture across screen
  vec2 noiseScale = u_screenSize / 4.0;
  vec3 randomVec = texture(u_noiseTex, v_uv * noiseScale).xyz;

  // Create orthogonal tangent-bitangent-normal (TBN) basis
  vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
  vec3 bitangent = cross(normal, tangent);
  mat3 TBN = mat3(tangent, bitangent, normal);

  float occlusion = 0.0;
  for (int i = 0; i < 16; i++) {
    // Re-orient hemisphere sample from tangent space to view space
    vec3 samplePos = fragPos + TBN * u_samples[i] * u_radius;

    // Project sample position to screen UV
    vec4 offset = u_proj * vec4(samplePos, 1.0);
    offset.xyz /= offset.w;
    offset.xy = offset.xy * 0.5 + 0.5;

    // Read depth of geometry at projected sample UV
    float occluderDepth = texture(u_normalDepthTex, offset.xy).w;

    // Check if occluder is in front of sample position and within radius
    float sampleLinearDepth = -samplePos.z;
    float rangeCheck = smoothstep(0.0, 1.0, u_radius / abs(depth - occluderDepth));
    occlusion += (occluderDepth <= sampleLinearDepth - u_bias ? 1.0 : 0.0) * rangeCheck;
  }

  float ao = 1.0 - (occlusion / 16.0);
  fragColor = vec4(ao, ao, ao, 1.0);
}
`;

// 4. Edge-Preserving Blur Shader (4x4 box)
const FS_BLUR = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_ssaoTex;
uniform vec2 u_texelSize;

void main() {
  float result = 0.0;
  for (int x = -2; x < 2; x++) {
    for (int y = -2; y < 2; y++) {
      vec2 offset = vec2(float(x), float(y)) * u_texelSize;
      result += texture(u_ssaoTex, v_uv + offset).r;
    }
  }
  float blurred = result / 16.0;
  fragColor = vec4(blurred, blurred, blurred, 1.0);
}
`;

// 5. Composite Pass Shader
const FS_COMPOSITE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_colorTex;
uniform sampler2D u_ssaoTex;
uniform float u_intensity;
uniform bool u_ssaoEnabled;

void main() {
  vec3 baseColor = texture(u_colorTex, v_uv).rgb;
  float ao = texture(u_ssaoTex, v_uv).r;

  if (u_ssaoEnabled) {
    // Apply adjustable intensity to occlusion
    float occFactor = pow(ao, u_intensity);
    baseColor *= occFactor;
  }

  // Gamma correction
  vec3 mapped = pow(baseColor, vec3(1.0 / 2.2));
  fragColor = vec4(mapped, 1.0);
}
`;

export interface SSAORenderer {
  gl: WebGL2RenderingContext;
  render(dt: number): void;
  resize(w: number, h: number): void;
  getCanvas(): HTMLCanvasElement;
  setCameraAngles(yaw: number, pitch: number): void;
  setCameraDistance(dist: number): void;
  toggleSSAO(enabled: boolean): void;
  setIntensity(val: number): void;
  setRadius(val: number): void;
  toggleAutoRotate(val: boolean): void;
  readPixel(x: number, y: number): [number, number, number, number];
  destroy(): void;
}

export function createSSAORenderer(canvas: HTMLCanvasElement): SSAORenderer {
  const rawGl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
  });
  if (!rawGl) {
    throw new Error('WebGL2 is not supported');
  }
  const gl: WebGL2RenderingContext = rawGl;

  // Ensure EXT_color_buffer_float is enabled for float render targets
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) {
    console.warn('EXT_color_buffer_float not supported, fallbacks may apply');
  }

  // Compile programs
  const geomProg = createProgram(gl, VS_GEOM, FS_GEOM);
  const ssaoProg = createProgram(gl, VS_QUAD, FS_SSAO);
  const blurProg = createProgram(gl, VS_QUAD, FS_BLUR);
  const compositeProg = createProgram(gl, VS_QUAD, FS_COMPOSITE);

  // Mesh setup
  const cityMesh = buildBlockCityGeometry(5, 5);

  const geomVao = gl.createVertexArray()!;
  gl.bindVertexArray(geomVao);

  const posVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, posVbo);
  gl.bufferData(gl.ARRAY_BUFFER, cityMesh.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const normVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, normVbo);
  gl.bufferData(gl.ARRAY_BUFFER, cityMesh.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const colVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, colVbo);
  gl.bufferData(gl.ARRAY_BUFFER, cityMesh.colors, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);

  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cityMesh.indices, gl.STATIC_DRAW);

  // Fullscreen Quad VAO
  const quadVao = gl.createVertexArray()!;
  gl.bindVertexArray(quadVao);
  const quadVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  const quadVertices = new Float32Array([
    -1.0, -1.0,
     1.0, -1.0,
    -1.0,  1.0,
    -1.0,  1.0,
     1.0, -1.0,
     1.0,  1.0,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // SSAO Samples Kernel & 4x4 Noise Texture
  const kernelSamples = generateSampleKernel(16);
  const noiseData = generateNoiseTexture(4);

  const noiseTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, 4, 4, 0, gl.RGB, gl.FLOAT, noiseData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  let width = canvas.width;
  let height = canvas.height;

  // Framebuffers and textures
  let gFbo: WebGLFramebuffer;
  let colorTex: WebGLTexture;
  let normalDepthTex: WebGLTexture;
  let depthRb: WebGLRenderbuffer;

  let ssaoFbo: WebGLFramebuffer;
  let ssaoTex: WebGLTexture;

  let blurFbo: WebGLFramebuffer;
  let blurTex: WebGLTexture;

  function initBuffers(w: number, h: number) {
    // 1. G-Buffer FBO
    gFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gFbo);

    colorTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);

    normalDepthTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, normalDepthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, normalDepthTex, 0);

    depthRb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);

    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    // 2. SSAO FBO
    ssaoFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoFbo);

    ssaoTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, ssaoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ssaoTex, 0);

    // 3. Blur FBO
    blurFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFbo);

    blurTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, blurTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  initBuffers(width, height);

  // Camera & SSAO Settings
  let yaw = 0.75;
  let pitch = 0.42;
  let distance = 75.0;

  let ssaoEnabled = true;
  let ssaoIntensity = 2.0;
  let ssaoRadius = 2.5;
  let autoRotate = true;

  const projMat = new Float32Array(16);
  const invProjMat = new Float32Array(16);
  const viewMat = new Float32Array(16);

  function mat4InvertProj(out: Float32Array, m: Float32Array): void {
    const a = m[0], b = m[5], c = m[10], d = m[14], e = m[11];
    out.fill(0);
    out[0] = 1.0 / a;
    out[5] = 1.0 / b;
    out[11] = 1.0 / d;
    out[14] = 1.0 / e;
    out[15] = -c / (d * e);
  }

  return {
    gl,
    resize(w: number, h: number) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;

      gl.deleteFramebuffer(gFbo);
      gl.deleteTexture(colorTex);
      gl.deleteTexture(normalDepthTex);
      gl.deleteRenderbuffer(depthRb);

      gl.deleteFramebuffer(ssaoFbo);
      gl.deleteTexture(ssaoTex);

      gl.deleteFramebuffer(blurFbo);
      gl.deleteTexture(blurTex);

      initBuffers(w, h);
    },

    setCameraAngles(y: number, p: number) {
      yaw = y;
      pitch = Math.max(0.1, Math.min(Math.PI * 0.48, p));
    },

    setCameraDistance(d: number) {
      distance = Math.max(25.0, Math.min(180.0, d));
    },

    toggleSSAO(val: boolean) {
      ssaoEnabled = val;
    },

    setIntensity(val: number) {
      ssaoIntensity = Math.max(0.5, Math.min(5.0, val));
    },

    setRadius(val: number) {
      ssaoRadius = Math.max(0.5, Math.min(6.0, val));
    },

    toggleAutoRotate(val: boolean) {
      autoRotate = val;
    },

    getCanvas() {
      return canvas;
    },

    readPixel(x: number, y: number): [number, number, number, number] {
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [pixel[0], pixel[1], pixel[2], pixel[3]];
    },

    render(dt: number) {
      if (autoRotate) {
        yaw += dt * 0.12;
      }

      const eyeY = Math.sin(pitch) * distance + 8.0;
      const rH = Math.cos(pitch) * distance;
      const eyeX = Math.sin(yaw) * rH;
      const eyeZ = Math.cos(yaw) * rH;

      mat4Perspective(projMat, Math.PI / 4, width / Math.max(1, height), 0.5, 450.0);
      mat4InvertProj(invProjMat, projMat);
      mat4LookAt(viewMat, [eyeX, eyeY, eyeZ], [0, 8.0, 0], [0, 1, 0]);

      // 1. Geometry Pass: Render Scene to G-Buffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, gFbo);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0.05, 0.08, 0.14, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);

      gl.useProgram(geomProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(geomProg, 'u_view'), false, viewMat);
      gl.uniformMatrix4fv(gl.getUniformLocation(geomProg, 'u_proj'), false, projMat);

      gl.bindVertexArray(geomVao);
      gl.drawElements(gl.TRIANGLES, cityMesh.indices.length, gl.UNSIGNED_SHORT, 0);

      // 2. SSAO Pass: Compute Ambient Occlusion
      gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoFbo);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);

      gl.useProgram(ssaoProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(ssaoProg, 'u_proj'), false, projMat);
      gl.uniformMatrix4fv(gl.getUniformLocation(ssaoProg, 'u_invProj'), false, invProjMat);
      gl.uniform2f(gl.getUniformLocation(ssaoProg, 'u_screenSize'), width, height);
      gl.uniform1f(gl.getUniformLocation(ssaoProg, 'u_radius'), ssaoRadius);
      gl.uniform1f(gl.getUniformLocation(ssaoProg, 'u_bias'), 0.025);

      for (let i = 0; i < 16; i++) {
        gl.uniform3f(
          gl.getUniformLocation(ssaoProg, `u_samples[${i}]`),
          kernelSamples[i * 3 + 0],
          kernelSamples[i * 3 + 1],
          kernelSamples[i * 3 + 2],
        );
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, normalDepthTex);
      gl.uniform1i(gl.getUniformLocation(ssaoProg, 'u_normalDepthTex'), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, noiseTex);
      gl.uniform1i(gl.getUniformLocation(ssaoProg, 'u_noiseTex'), 1);

      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // 3. Blur Pass: Edge-preserving filter
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurFbo);
      gl.useProgram(blurProg);
      gl.uniform2f(gl.getUniformLocation(blurProg, 'u_texelSize'), 1.0 / width, 1.0 / height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ssaoTex);
      gl.uniform1i(gl.getUniformLocation(blurProg, 'u_ssaoTex'), 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // 4. Composite Pass: Final shaded scene to canvas
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);

      gl.useProgram(compositeProg);
      gl.uniform1f(gl.getUniformLocation(compositeProg, 'u_intensity'), ssaoIntensity);
      gl.uniform1i(gl.getUniformLocation(compositeProg, 'u_ssaoEnabled'), ssaoEnabled ? 1 : 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, colorTex);
      gl.uniform1i(gl.getUniformLocation(compositeProg, 'u_colorTex'), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurTex);
      gl.uniform1i(gl.getUniformLocation(compositeProg, 'u_ssaoTex'), 1);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    },

    destroy() {
      gl.deleteBuffer(posVbo);
      gl.deleteBuffer(normVbo);
      gl.deleteBuffer(colVbo);
      gl.deleteBuffer(ibo);
      gl.deleteVertexArray(geomVao);

      gl.deleteBuffer(quadVbo);
      gl.deleteVertexArray(quadVao);

      gl.deleteTexture(noiseTex);

      gl.deleteFramebuffer(gFbo);
      gl.deleteTexture(colorTex);
      gl.deleteTexture(normalDepthTex);
      gl.deleteRenderbuffer(depthRb);

      gl.deleteFramebuffer(ssaoFbo);
      gl.deleteTexture(ssaoTex);

      gl.deleteFramebuffer(blurFbo);
      gl.deleteTexture(blurTex);

      gl.deleteProgram(geomProg);
      gl.deleteProgram(ssaoProg);
      gl.deleteProgram(blurProg);
      gl.deleteProgram(compositeProg);
    },
  };
}
