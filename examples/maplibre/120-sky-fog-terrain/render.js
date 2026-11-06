import { viewProj, eyeOf } from './camera.js';
import { reliefGlsl, fogDepthGlsl, hexToRgb, NO_SKY } from './sky.js';
const CELLS = 64, SIDE = CELLS + 1;
const SKY_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 1.0, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
uniform vec3 u_sky_color, u_horizon_color;
uniform float u_horizon, u_sky_horizon_blend;
out vec4 fragColor;
void main() {
  float blend = gl_FragCoord.y - u_horizon;
  vec3 c = u_horizon_color;
  if (blend > 0.0) c = blend < u_sky_horizon_blend ? mix(u_sky_color, u_horizon_color, pow(1.0 - blend / u_sky_horizon_blend, 2.0)) : u_sky_color;
  fragColor = vec4(c, 1.0);
}`;
const TERRAIN_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_height;
uniform mat4 u_mvp;
uniform vec2 u_origin;      // local metres of sample (0,0), the north-west corner
uniform float u_step;
uniform int u_chunks_x;
uniform vec4 u_hole;        // x0, y0, x1, y1: vertices inside are sunk (the near grid covers them)
uniform vec3 u_eye, u_fwd;
out float v_h;
out vec3 v_n;
out float v_depth;
float hAt(ivec2 s) { ivec2 m = textureSize(u_height, 0) - 1; return texelFetch(u_height, clamp(s, ivec2(0), m), 0).r; }
void main() {
  ivec2 s = ivec2(gl_InstanceID % u_chunks_x, gl_InstanceID / u_chunks_x) * ${CELLS} + ivec2(gl_VertexID % ${SIDE}, gl_VertexID / ${SIDE});
  float h = hAt(s);
  float dx = (hAt(s + ivec2(1, 0)) - hAt(s - ivec2(1, 0))) / (2.0 * u_step);
  float dn = (hAt(s - ivec2(0, 1)) - hAt(s + ivec2(0, 1))) / (2.0 * u_step);   // rows run south
  vec3 p = vec3(u_origin.x + float(s.x) * u_step, u_origin.y - float(s.y) * u_step, h);
  v_h = h;
  v_n = normalize(vec3(-dx, -dn, 1.0));
  if (p.x > u_hole.x && p.x < u_hole.z && p.y > u_hole.y && p.y < u_hole.w) p.z -= 600.0;
  v_depth = dot(p - u_eye, u_fwd);
  gl_Position = u_mvp * vec4(p, 1.0);
}`;
const TERRAIN_FS = `#version 300 es
precision highp float;
uniform vec3 u_fog_color, u_horizon_color;
uniform float u_fog_near, u_fog_far, u_fog_ground_blend, u_fog_ground_blend_opacity, u_horizon_fog_blend;
in float v_h;
in vec3 v_n;
in float v_depth;
out vec4 fragColor;
${reliefGlsl()}
${fogDepthGlsl}
const float gamma = 2.2;
void main() {
  vec3 n = normalize(v_n);
  float shade = clamp(dot(n, SUN), 0.0, 1.0);
  float flat_ = n.z;   // flat ground keeps its relief colour
  vec3 base = relief(v_h);
  vec3 c = mix(SHADOW, base * 1.1, clamp(0.25 + 0.95 * shade * (0.6 + 0.4 * flat_), 0.0, 1.0));
  float d = fogDepth(v_depth);
  if (u_fog_ground_blend_opacity > 0.0 && d > u_fog_ground_blend) {
    vec3 lin = pow(c, vec3(gamma));
    float bc = smoothstep(0.0, 1.0, max((d - u_horizon_fog_blend) / (1.0 - u_horizon_fog_blend), 0.0));
    vec3 fh = mix(pow(u_fog_color, vec3(gamma)), pow(u_horizon_color, vec3(gamma)), bc);
    float f = max(d - u_fog_ground_blend, 0.0) / (1.0 - u_fog_ground_blend);
    c = pow(mix(lin, fh, pow(f, 2.0) * u_fog_ground_blend_opacity), vec3(1.0 / gamma));
  }
  fragColor = vec4(c, 1.0);
}`;
function program(gl, vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [
        [
            gl.VERTEX_SHADER,
            vs
        ],
        [
            gl.FRAGMENT_SHADER,
            fs
        ]
    ]){
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const logs = gl.getAttachedShaders(p).map((s)=>gl.getShaderInfoLog(s)).join('\n');
        throw new Error(`shader: ${gl.getProgramInfoLog(p)}\n${logs}`);
    }
    return {
        p,
        u: (n)=>gl.getUniformLocation(p, n)
    };
}
export function createRenderer(canvas) {
    const gl = canvas.getContext('webgl2', {
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL2 is not available');
    const sky = program(gl, SKY_VS, SKY_FS);
    const ter = program(gl, TERRAIN_VS, TERRAIN_FS);
    const idx = [];
    for(let j = 0; j < CELLS; j++)for(let i = 0; i < CELLS; i++){
        const a = j * SIDE + i, b = a + 1, c = a + SIDE, d = c + 1;
        idx.push(a, c, b, b, c, d);
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const levels = [];
    function addLevel(g, origin, hole = [
        0,
        0,
        0,
        0
    ]) {
        if ((g.w - 1) % CELLS || (g.h - 1) % CELLS) throw new Error(`grid ${g.w}x${g.h} is not ${CELLS}n+1`);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, g.w, g.h);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.w, g.h, gl.RED, gl.FLOAT, g.heights);
        for (const k of [
            gl.TEXTURE_MIN_FILTER,
            gl.TEXTURE_MAG_FILTER
        ])gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
        const chunksX = (g.w - 1) / CELLS;
        levels.push({
            tex,
            origin,
            step: g.step,
            chunksX,
            instances: chunksX * ((g.h - 1) / CELLS),
            hole
        });
    }
    function draw(cam, s, skyOn) {
        const w = canvas.width, h = canvas.height;
        gl.viewport(0, 0, w, h);
        const bg = hexToRgb(NO_SKY);
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.bindVertexArray(vao);
        if (skyOn) {
            gl.disable(gl.DEPTH_TEST);
            gl.useProgram(sky.p);
            gl.uniform3fv(sky.u('u_sky_color'), s.sky);
            gl.uniform3fv(sky.u('u_horizon_color'), s.horizon);
            gl.uniform1f(sky.u('u_horizon'), s.horizonFrag);
            gl.uniform1f(sky.u('u_sky_horizon_blend'), s.skyBlendPx);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.useProgram(ter.p);
        const e = eyeOf(cam);
        const fl = Math.hypot(cam.tx - e[0], cam.ty - e[1], cam.tz - e[2]);
        gl.uniformMatrix4fv(ter.u('u_mvp'), false, new Float32Array(viewProj(cam, w / h)));
        gl.uniform3f(ter.u('u_eye'), e[0], e[1], e[2]);
        gl.uniform3f(ter.u('u_fwd'), (cam.tx - e[0]) / fl, (cam.ty - e[1]) / fl, (cam.tz - e[2]) / fl);
        gl.uniform3fv(ter.u('u_fog_color'), s.fog);
        gl.uniform3fv(ter.u('u_horizon_color'), s.horizon);
        gl.uniform1f(ter.u('u_fog_near'), s.fogNear);
        gl.uniform1f(ter.u('u_fog_far'), s.fogFar);
        gl.uniform1f(ter.u('u_fog_ground_blend'), s.fogGroundBlend);
        gl.uniform1f(ter.u('u_fog_ground_blend_opacity'), s.fogOpacity);
        gl.uniform1f(ter.u('u_horizon_fog_blend'), s.horizonFogBlend);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(ter.u('u_height'), 0);
        for (const L of levels){
            gl.bindTexture(gl.TEXTURE_2D, L.tex);
            gl.uniform2f(ter.u('u_origin'), L.origin[0], L.origin[1]);
            gl.uniform1f(ter.u('u_step'), L.step);
            gl.uniform1i(ter.u('u_chunks_x'), L.chunksX);
            gl.uniform4fv(ter.u('u_hole'), L.hole);
            gl.drawElementsInstanced(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0, L.instances);
        }
        gl.bindVertexArray(null);
    }
    const triangles = ()=>levels.reduce((a, L)=>a + L.instances * CELLS * CELLS * 2, 0);
    return {
        gl,
        addLevel,
        draw,
        triangles
    };
}
