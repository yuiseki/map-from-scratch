import { CS, N0, R_EFF } from './terrain.js';
const V = CS + 1, GRID = V * V;
export const HEIGHT_OURS = `uniform highp usampler2DArray u_h;
float H(int u, int v) { return float(texelFetch(u_h, ivec3(u + 1, v + 1, g_layer), 0).r) * g_q; }`;
const VS = (heightFn)=>`#version 300 es
precision highp float; precision highp int;
layout(location=0) in uvec4 a_chunk;   // layer, level, row, column
layout(location=1) in float a_skirt;   // m
uniform mat4 u_vp; uniform vec3 u_eye; uniform float u_cell;
int g_layer; int g_level; float g_q; ivec2 g_org;
${heightFn}
out vec3 v_pos; out vec3 v_n; out vec2 v_uv; flat out float v_tag;
void main() {
  g_layer = int(a_chunk.x); g_level = int(a_chunk.y);
  float s = exp2(float(g_level));
  g_q = 0.25 * s;
  g_org = ivec2(a_chunk.w, a_chunk.z) * ${CS};
  int id = gl_VertexID, u, v;
  bool skirt = id >= ${GRID};
  if (skirt) {
    int e = (id - ${GRID}) / ${V}, t = (id - ${GRID}) % ${V};
    u = e == 1 ? ${CS} : e == 3 ? 0 : t;
    v = e == 0 ? 0 : e == 2 ? ${CS} : t;
  } else {
    u = id % ${V}; v = id / ${V};
  }
  // Interior vertices sit on sample centres. Edge vertices sit on the
  // chunk's border (half a sample from the centres), at the mean of the samples
  // astride it: neighbours of any level then meet on the same line, so the
  // vertical skirts close every gap, and a same-level neighbour computes the
  // same height from its border samples.
  ivec2 a = ivec2(u == 0 ? -1 : u == ${CS} ? ${CS - 1} : u, v == 0 ? -1 : v == ${CS} ? ${CS - 1} : v);
  ivec2 b = ivec2(u == 0 ? 0 : u, v == 0 ? 0 : v);
  float h = a == b ? H(u, v) : 0.25 * (H(a.x, a.y) + H(b.x, a.y) + H(a.x, b.y) + H(b.x, b.y));
  vec2 f = vec2(u == 0 ? 0.0 : u == ${CS} ? ${CS}.0 : float(u) + 0.5, v == 0 ? 0.0 : v == ${CS} ? ${CS}.0 : float(v) + 0.5);
  // normals: central differences of the samples, using the border samples at the edge
  float step = 2.0 * u_cell * s;
  v_n = vec3((H(u - 1, v) - H(u + 1, v)) / step, (H(u, v + 1) - H(u, v - 1)) / step, 1.0);
  vec2 px = (vec2(g_org) + f) * s;                                    // L0 px from the NW corner
  v_uv = px / ${N0}.0;                                                 // same z12 XYZ grid as the 6x6 photo atlas
  vec2 xy = vec2(px.x - ${N0 / 2}.0, ${N0 / 2}.0 - px.y) * u_cell;   // m from the centre, y north
  v_pos = vec3(xy, h);
  v_tag = float(g_level) + (skirt ? 16.0 : 0.0);
  vec2 d = xy - u_eye.xy;
  // the earth's curvature (with refraction), seen from the point under the eye
  float z = h - (skirt ? a_skirt : 0.0) - dot(d, d) * ${(1 / (2 * R_EFF)).toExponential(6)};
  gl_Position = u_vp * vec4(xy, z, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 v_pos; in vec3 v_n; in vec2 v_uv; flat in float v_tag;
uniform vec3 u_eye; uniform vec3 u_sky;
uniform sampler2D u_photo; uniform int u_photoReady;
layout(location=0) out vec4 o;
layout(location=1) out vec4 o_pos;
const vec3 SUN = vec3(-0.5417, 0.5417, 0.6428);
void main() {
  float h = v_pos.z;
  bool photo = u_photoReady != 0 && v_tag < 16.0;
  vec3 c;
  if (photo) c = texture(u_photo, v_uv).rgb;
  else {
    c = vec3(0.33, 0.48, 0.27);
    c = mix(c, vec3(0.47, 0.51, 0.31), smoothstep(700.0, 900.0, h));
    c = mix(c, vec3(0.53, 0.44, 0.34), smoothstep(1400.0, 1600.0, h));
    c = mix(c, vec3(0.45, 0.39, 0.38), smoothstep(2400.0, 2600.0, h));
    c = mix(c, vec3(1.0), smoothstep(3300.0, 3400.0, h));
  }
  c *= photo ? 0.55 + 0.55 * max(dot(normalize(v_n), SUN), 0.0)
             : 0.35 + 0.85 * max(dot(normalize(v_n), SUN), 0.0);
  // aerial perspective: air density exp(-z / 8 km) averaged along the ray
  float dz = u_eye.z - h, e0 = exp(-h / 8000.0);
  float dens = abs(dz) < 1.0 ? e0 : 8000.0 * (e0 - exp(-u_eye.z / 8000.0)) / dz;
  c = mix(u_sky, c, exp(-distance(v_pos, u_eye) * dens / 60000.0));
  o = vec4(c, 1.0);
  o_pos = vec4(v_pos, v_tag);
}`;
export const SKY = [
    0.78,
    0.85,
    0.93
];
export function createRenderer(gl, heightFn, bind) {
    const p = gl.createProgram();
    for (const [type, src] of [
        [
            gl.VERTEX_SHADER,
            VS(heightFn)
        ],
        [
            gl.FRAGMENT_SHADER,
            FS
        ]
    ]){
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
        gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const u = (n)=>gl.getUniformLocation(p, n);
    const uVp = u('u_vp'), uEye = u('u_eye'), uCell = u('u_cell'), uSky = u('u_sky');
    const idx = [];
    for(let v = 0; v < CS; v++)for(let x = 0; x < CS; x++){
        const a = v * V + x;
        idx.push(a, a + 1, a + V, a + 1, a + V + 1, a + V);
    }
    const edge = (e, t)=>e === 0 ? t : e === 1 ? t * V + CS : e === 2 ? CS * V + t : t * V;
    for(let e = 0; e < 4; e++)for(let t = 0; t < CS; t++){
        const g0 = edge(e, t), g1 = edge(e, t + 1), s0 = GRID + e * V + t;
        idx.push(g0, g1, s0, g1, s0 + 1, s0);
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    const inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_SHORT, 10, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, false, 10, 8);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    let instData = new Uint16Array(5 * 64);
    function draw(t, view, ids, target = null, clear = SKY) {
        if (instData.length < 5 * ids.length) instData = new Uint16Array(5 * ids.length * 2);
        ids.forEach((id, n)=>{
            const c = t.chunks[id];
            instData.set([
                id,
                c.k,
                c.i,
                c.j,
                c.skirt
            ], 5 * n);
        });
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.viewport(0, 0, view.w, view.h);
        gl.clearColor(clear[0], clear[1], clear[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (target) gl.clearBufferfv(gl.COLOR, 1, [
            0,
            0,
            0,
            -1
        ]);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(p);
        bind(p);
        gl.uniformMatrix4fv(uVp, false, view.m);
        gl.uniform3fv(uEye, view.eye);
        gl.uniform1f(uCell, t.cell);
        gl.uniform3fv(uSky, SKY);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, inst);
        gl.bufferData(gl.ARRAY_BUFFER, instData.subarray(0, 5 * ids.length), gl.STREAM_DRAW);
        gl.drawElementsInstanced(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0, ids.length);
        gl.bindVertexArray(null);
    }
    return {
        draw,
        program: p,
        triangles: idx.length / 3
    };
}
