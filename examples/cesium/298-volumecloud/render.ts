import {
  type Vec3,
  computeSunDirection,
  mat4Invert,
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
} from './cloud.ts';

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

const VS_QUAD = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;

void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FS_VOLUME_CLOUD = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform mat4 u_invVP;
uniform vec3 u_camPos;
uniform vec3 u_sunDir;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_coverage;
uniform float u_innerRadius;
uniform float u_outerRadius;

#define PI 3.14159265359

// Fast 3D hash
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Fast analytical 3D noise for real-time volumetric atmospheric clouds
float fastFbm(vec3 p) {
  float n1 = sin(p.x * 1.6 + cos(p.y * 2.2 + p.z * 1.7)) * 0.5 + 0.5;
  float n2 = sin(p.x * 3.5 - p.z * 2.9 + cos(p.y * 3.3)) * 0.5 + 0.5;
  float n3 = cos(p.x * 7.1 + p.y * 6.2 - p.z * 5.8) * 0.5 + 0.5;
  return n1 * 0.55 + n2 * 0.30 + n3 * 0.15;
}

vec2 raySphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  float sd = sqrt(d);
  return vec2(-b - sd, -b + sd);
}

float sampleCloudDensity(vec3 p, float normAlt, float t) {
  if (normAlt < 0.0 || normAlt > 1.0) return 0.0;
  float heightProfile = 4.0 * normAlt * (1.0 - normAlt);

  vec3 wind = vec3(t * 0.15, 0.0, t * 0.10);
  vec3 pSample = p * 0.38 + wind;

  float n = fastFbm(pSample);
  float threshold = 1.0 - u_coverage * 0.65;
  float d = max(0.0, (n - threshold) / (1.0 - threshold + 0.001));
  return d * heightProfile * 2.2;
}

float henyeyGreenstein(float cosTheta, float g) {
  float g2 = g * g;
  float denom = 4.0 * PI * pow(max(0.001, 1.0 + g2 - 2.0 * g * cosTheta), 1.5);
  return (1.0 - g2) / denom;
}

vec3 getEarthColor(vec3 p, vec3 n, vec3 sunDir) {
  // Spherical coordinates
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float lon = atan(n.z, n.x);

  // Continent vs ocean mask from multi-frequency harmonics
  float landShape = sin(lon * 3.0 + cos(lat * 4.0)) * 0.5 +
                    cos(lon * 5.0 - lat * 2.0) * 0.3 +
                    sin(lat * 8.0) * 0.2;

  bool isLand = landShape > 0.08;
  vec3 baseColor = isLand ? vec3(0.18, 0.38, 0.16) : vec3(0.05, 0.18, 0.42);

  // Polar ice caps
  if (abs(lat) > 1.15) {
    baseColor = vec3(0.85, 0.90, 0.96);
  }

  float diff = max(0.0, dot(n, sunDir));
  float ambient = 0.06;
  return baseColor * (diff + ambient);
}

void main() {
  vec2 ndc = (v_uv * 2.0 - 1.0);
  vec4 nearPlane = u_invVP * vec4(ndc, -1.0, 1.0);
  vec4 farPlane = u_invVP * vec4(ndc, 1.0, 1.0);
  vec3 rayOrigin = u_camPos;
  vec3 rayDir = normalize(farPlane.xyz / farPlane.w - nearPlane.xyz / nearPlane.w);

  vec3 sunDir = normalize(u_sunDir);

  vec2 hitOuter = raySphere(rayOrigin, rayDir, u_outerRadius);
  vec2 hitInner = raySphere(rayOrigin, rayDir, u_innerRadius);

  // Background cosmos / stars
  vec3 bg = vec3(0.015, 0.02, 0.035);
  float star = step(0.998, hash13(floor(rayDir * 400.0))) * 0.8;
  bg += vec3(star);

  vec3 finalColor = bg;
  float hitDist = 1e6;
  vec3 earthNorm = vec3(0.0);

  if (hitInner.x > 0.0) {
    hitDist = hitInner.x;
    vec3 pEarth = rayOrigin + rayDir * hitInner.x;
    earthNorm = normalize(pEarth);
    finalColor = getEarthColor(pEarth, earthNorm, sunDir);
  }

  // Atmospheric limb glow
  if (hitOuter.y > 0.0) {
    float limb = dot(normalize(rayOrigin), rayDir);
    float glow = pow(max(0.0, 1.0 - abs(limb)), 8.0) * 0.35;
    finalColor += vec3(0.15, 0.4, 0.9) * glow;
  }

  // Cloud raymarching in shell [u_innerRadius, u_outerRadius]
  if (hitOuter.y > 0.0) {
    float tStart = max(0.0, hitOuter.x);
    float tEnd = hitOuter.y;
    if (hitInner.x > 0.0) {
      tEnd = min(tEnd, hitInner.x);
    }

    if (tEnd > tStart) {
      int steps = 18;
      float stepSize = (tEnd - tStart) / float(steps);
      float t = tStart + stepSize * hash13(vec3(v_uv, fract(u_time))) * 0.5;

      vec3 cloudColorAccum = vec3(0.0);
      float transmittance = 1.0;

      float cosTheta = dot(rayDir, sunDir);
      float phase = henyeyGreenstein(cosTheta, 0.45) * 0.7 + 0.3;

      for (int i = 0; i < 18; i++) {
        if (transmittance < 0.02) break;

        vec3 p = rayOrigin + rayDir * t;
        float r = length(p);
        float normAlt = (r - u_innerRadius) / (u_outerRadius - u_innerRadius);

        float density = sampleCloudDensity(p, normAlt, u_time);

        if (density > 0.01) {
          // Analytical shadow approximation
          float sunTransmittance = exp(-density * 1.5);

          vec3 sunLight = vec3(1.0, 0.95, 0.85) * (sunTransmittance * phase * 1.4);
          vec3 ambient = vec3(0.2, 0.35, 0.5) * (0.4 + 0.6 * normAlt);
          vec3 scatteredLight = (sunLight + ambient) * density;

          float stepTransmittance = exp(-density * 1.4 * stepSize);
          cloudColorAccum += scatteredLight * (transmittance * (1.0 - stepTransmittance));
          transmittance *= stepTransmittance;
        }

        t += stepSize;
      }

      finalColor = finalColor * transmittance + cloudColorAccum;
    }
  }

  // Tone-mapping and gamma
  finalColor = finalColor / (finalColor + vec3(1.0));
  finalColor = pow(finalColor, vec3(1.0 / 2.2));

  fragColor = vec4(finalColor, 1.0);
}
`;

export interface VolumeCloudRenderer {
  gl: WebGL2RenderingContext;
  render(dt: number): void;
  resize(w: number, h: number): void;
  getCanvas(): HTMLCanvasElement;
  setCameraAngles(yaw: number, pitch: number): void;
  setCameraDistance(dist: number): void;
  setSunAngles(azimuth: number, elevation: number): void;
  setCloudCoverage(coverage: number): void;
  toggleAutoRotate(val: boolean): void;
  readPixel(x: number, y: number): [number, number, number, number];
  destroy(): void;
}

export function createVolumeCloudRenderer(canvas: HTMLCanvasElement): VolumeCloudRenderer {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
  });
  if (!gl) {
    throw new Error('WebGL2 is not supported');
  }

  const prog = createProgram(gl, VS_QUAD, FS_VOLUME_CLOUD);

  const locInvVP = gl.getUniformLocation(prog, 'u_invVP');
  const locCamPos = gl.getUniformLocation(prog, 'u_camPos');
  const locSunDir = gl.getUniformLocation(prog, 'u_sunDir');
  const locResolution = gl.getUniformLocation(prog, 'u_resolution');
  const locTime = gl.getUniformLocation(prog, 'u_time');
  const locCoverage = gl.getUniformLocation(prog, 'u_coverage');
  const locInnerRadius = gl.getUniformLocation(prog, 'u_innerRadius');
  const locOuterRadius = gl.getUniformLocation(prog, 'u_outerRadius');

  // Fullscreen quad [-1, 1]
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

  let width = canvas.width;
  let height = canvas.height;

  let yaw = 0.5;
  let pitch = 0.25;
  let distance = 46.0;

  let sunAzimuth = 1.0;
  let sunElevation = 0.6;
  let cloudCoverage = 0.55;
  let autoRotate = true;
  let elapsed = 0.0;

  const innerRadius = 20.0;
  const outerRadius = 22.8;

  const projMat = new Float32Array(16);
  const viewMat = new Float32Array(16);
  const vpMat = new Float32Array(16);
  const invVPMat = new Float32Array(16);

  return {
    gl,
    resize(w: number, h: number) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    },

    setCameraAngles(y: number, p: number) {
      yaw = y;
      pitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, p));
    },

    setCameraDistance(d: number) {
      distance = Math.max(24.0, Math.min(90.0, d));
    },

    setSunAngles(az: number, el: number) {
      sunAzimuth = az;
      sunElevation = el;
    },

    setCloudCoverage(c: number) {
      cloudCoverage = Math.max(0.1, Math.min(0.9, c));
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
        elapsed += dt;
        yaw += dt * 0.08;
      } else {
        elapsed += dt;
      }

      gl.viewport(0, 0, width, height);

      const eyeY = Math.sin(pitch) * distance;
      const rH = Math.cos(pitch) * distance;
      const eyeX = Math.sin(yaw) * rH;
      const eyeZ = Math.cos(yaw) * rH;

      mat4Perspective(projMat, Math.PI / 4, width / Math.max(1, height), 0.5, 200.0);
      mat4LookAt(viewMat, [eyeX, eyeY, eyeZ], [0, 0, 0], [0, 1, 0]);
      mat4Multiply(vpMat, projMat, viewMat);
      mat4Invert(invVPMat, vpMat);

      const sunDir = computeSunDirection(sunAzimuth, sunElevation);

      gl.useProgram(prog);
      gl.uniformMatrix4fv(locInvVP, false, invVPMat);
      gl.uniform3f(locCamPos, eyeX, eyeY, eyeZ);
      gl.uniform3f(locSunDir, sunDir[0], sunDir[1], sunDir[2]);
      gl.uniform2f(locResolution, width, height);
      gl.uniform1f(locTime, elapsed);
      gl.uniform1f(locCoverage, cloudCoverage);
      gl.uniform1f(locInnerRadius, innerRadius);
      gl.uniform1f(locOuterRadius, outerRadius);

      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    },

    destroy() {
      gl.deleteBuffer(quadVbo);
      gl.deleteVertexArray(quadVao);
      gl.deleteProgram(prog);
    },
  };
}
