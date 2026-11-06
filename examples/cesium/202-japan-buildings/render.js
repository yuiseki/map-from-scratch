import { rampGlsl, vec3Of, SKY, LAND, OCEAN } from './ramp.js';
import { dropGlsl } from './geo.js';
const SUN_AZ = 150 * Math.PI / 180, SUN_EL = 40 * Math.PI / 180;
export const SUN = [
    Math.sin(SUN_AZ) * Math.cos(SUN_EL),
    Math.cos(SUN_AZ) * Math.cos(SUN_EL),
    Math.sin(SUN_EL)
];
const GLOBE_VS = `#version 300 es
out vec2 v_ndc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  v_ndc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const GLOBE_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
out vec4 o;
uniform vec3 u_right, u_up, u_fwd;   // camera basis, local frame
uniform vec2 u_tan;                  // tan of half the field of view, x and y
uniform vec3 u_C;                    // sphere centre minus eye
uniform float u_c;                   // |C|^2 - R^2 = alt (2R + alt), from doubles
uniform float u_alt, u_near, u_far;
uniform vec3 u_eye;                  // eye, local frame
uniform mat3 u_toEcef;               // local axes in ECEF
uniform vec3 u_origin;               // local origin in ECEF
uniform vec3 u_sun;
uniform sampler2D u_world, u_kanto, u_city;
uniform vec4 u_bWorld, u_bKanto, u_bCity;
const vec3 SKY = ${vec3Of(SKY)};
const vec3 LAND = ${vec3Of(LAND)};
const vec3 OCEAN = ${vec3Of(OCEAN)};
const vec3 ZENITH = vec3(0.16, 0.33, 0.62);
const vec3 SPACE = vec3(0.012, 0.016, 0.03);

float maskAt(sampler2D t, vec4 b, vec2 ll, out bool inside) {
  vec2 uv = vec2((ll.y - b.x) / b.z, (b.y - ll.x) / b.w);
  inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
  return texture(t, uv).r;
}

void main() {
  vec3 d = normalize(u_right * v_ndc.x * u_tan.x + u_up * v_ndc.y * u_tan.y + u_fwd);
  float b = dot(d, u_C);
  float disc = b * b - u_c;
  vec3 upE = -normalize(u_C);
  float space = smoothstep(40000.0, 400000.0, u_alt);
  if (b <= 0.0 || disc < 0.0) {
    // Sky: blue at the horizon, deeper at the zenith, black from orbit, with
    // a thin limb of blue around the planet.
    float horizonDip = sqrt(max(0.0, u_c / dot(u_C, u_C)));   // sin of the horizon's dip
    float e = dot(d, upE) + horizonDip;
    vec3 sky = mix(SKY, ZENITH, smoothstep(0.0, 0.5, e));
    vec3 limb = mix(SKY, SPACE, smoothstep(0.0, 0.08, e));
    o = vec4(mix(sky, limb, space), 1.0);
    gl_FragDepth = 1.0;
    return;
  }
  float t = u_c / (b + sqrt(disc));
  vec3 rel = t * d;
  vec3 p = u_origin + u_toEcef * (u_eye + rel);
  // ECEF -> geodetic latitude and longitude (Bowring, one step).
  const float A = 6378137.0, B = 6356752.3142, E2 = 0.00669437999014, EP2 = 0.00673949674228;
  float q = length(p.xy);
  float th = atan(p.z * A, q * B);
  float lat = atan(p.z + EP2 * B * pow(sin(th), 3.0), q - E2 * A * pow(cos(th), 3.0));
  vec2 ll = degrees(vec2(lat, atan(p.y, p.x)));
  bool inC, inK, inW;
  float land = maskAt(u_city, u_bCity, ll, inC);
  if (!inC) land = maskAt(u_kanto, u_bKanto, ll, inK);
  if (!inC && !inK) land = maskAt(u_world, u_bWorld, ll, inW);
  land = smoothstep(0.35, 0.65, land);
  vec3 n = normalize(rel - u_C);
  float light = 0.55 + 0.5 * max(dot(n, u_sun), 0.0);
  vec3 c = mix(OCEAN, LAND, land) * light;
  // Aerial perspective: distant ground fades into the horizon colour.
  float haze = 1.0 - exp(-t / (25000.0 + 2.0 * u_alt));
  c = mix(c, mix(SKY, SPACE, space * 0.6), haze * 0.85);
  o = vec4(c, 1.0);
  float vz = t * dot(d, u_fwd);
  float ndc = (u_far + u_near) / (u_far - u_near) - 2.0 * u_far * u_near / ((u_far - u_near) * vz);
  gl_FragDepth = clamp(ndc * 0.5 + 0.5, 0.0, 0.9999999);
}`;
const BLD_VS = `#version 300 es
layout(location = 0) in vec4 a;      // x, y over the tile's square (0..65535), z (cm), roof height (cm)
uniform mat4 u_vp;
uniform vec3 u_rel;                  // the square's corner minus the eye
uniform vec2 u_abs;                  // the square's corner, local frame
uniform float u_qs, u_R;
out vec3 v_rel;
out float v_top, v_z;
void main() {
  vec2 loc = a.xy / 65535.0 * u_qs;
  vec2 ab = u_abs + loc;
  float z = a.z * 0.01;
  vec3 rel = u_rel + vec3(loc, z + ${dropGlsl('ab.x', 'ab.y', 'u_R')});
  v_rel = rel;
  v_top = a.w * 0.01;
  v_z = z;
  gl_Position = u_vp * vec4(rel, 1.0);
}`;
const BLD_FS = `#version 300 es
precision highp float;
in vec3 v_rel;
in float v_top, v_z;
out vec4 o;
uniform vec3 u_sun;
uniform float u_haze;
uniform vec3 u_hazeColor;
${rampGlsl()}
void main() {
  // Flat face normal from screen derivatives: no normals in the data.
  vec3 n = normalize(cross(dFdx(v_rel), dFdy(v_rel)));
  if (dot(n, v_rel) > 0.0) n = -n;
  float diff = max(dot(n, u_sun), 0.0);
  float amb = 0.42 + 0.18 * n.z;
  float ao = mix(0.72, 1.0, smoothstep(0.0, 14.0, v_z));
  vec3 c = ramp(v_top) * (amb + 0.62 * diff) * ao;
  float haze = 1.0 - exp(-length(v_rel) / u_haze);
  o = vec4(mix(c, u_hazeColor, haze * 0.85), 1.0);
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
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
        gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
}
const uniforms = (gl, p, src)=>{
    const u = {};
    for (const m of src.matchAll(/uniform \w+ ([\w, ]+);/g))for (const n of m[1].split(','))u[n.trim()] = gl.getUniformLocation(p, n.trim());
    return u;
};
export class Renderer {
    gl;
    globe;
    bld;
    ug;
    ub;
    empty;
    masks = {};
    drawnBuildings = 0;
    drawnTiles = 0;
    constructor(gl){
        this.gl = gl;
        this.globe = program(gl, GLOBE_VS, GLOBE_FS);
        this.bld = program(gl, BLD_VS, BLD_FS);
        this.ug = uniforms(gl, this.globe, GLOBE_FS);
        this.ub = uniforms(gl, this.bld, BLD_VS + BLD_FS);
        this.empty = gl.createVertexArray();
    }
    setMask(name, w, h, data, bounds) {
        const gl = this.gl, tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.masks[name] = {
            tex,
            bounds
        };
    }
    draw(s, tiles) {
        const gl = this.gl, ug = this.ug, ub = this.ub;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.globe);
        gl.uniform3fv(ug.u_right, s.basis.right);
        gl.uniform3fv(ug.u_up, s.basis.up);
        gl.uniform3fv(ug.u_fwd, s.basis.fwd);
        gl.uniform2f(ug.u_tan, s.tanX, s.tanY);
        const C = [
            -s.eye[0],
            -s.eye[1],
            -s.R - s.eye[2]
        ];
        gl.uniform3fv(ug.u_C, C);
        gl.uniform1f(ug.u_c, s.alt * (2 * s.R + s.alt));
        gl.uniform1f(ug.u_alt, s.alt);
        gl.uniform1f(ug.u_near, s.near);
        gl.uniform1f(ug.u_far, s.far);
        gl.uniform3fv(ug.u_eye, s.eye);
        const f = s.frame;
        gl.uniformMatrix3fv(ug.u_toEcef, false, [
            ...f.e,
            ...f.n,
            ...f.u
        ]);
        gl.uniform3fv(ug.u_origin, f.o);
        gl.uniform3fv(ug.u_sun, SUN);
        [
            'world',
            'kanto',
            'city'
        ].forEach((name, unit)=>{
            const m = this.masks[name];
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, m?.tex ?? null);
            gl.uniform1i(ug[`u_${name}`], unit);
            gl.uniform4fv(ug[`u_b${name[0].toUpperCase()}${name.slice(1)}`], m?.bounds ?? [
                0,
                0,
                -1,
                -1
            ]);
        });
        gl.bindVertexArray(this.empty);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.useProgram(this.bld);
        gl.uniformMatrix4fv(ub.u_vp, false, new Float32Array(s.vp));
        gl.uniform1f(ub.u_R, s.R);
        gl.uniform3fv(ub.u_sun, SUN);
        gl.uniform1f(ub.u_haze, 25000 + 2 * s.alt);
        gl.uniform3fv(ub.u_hazeColor, SKY.map((v)=>v / 255));
        let buildings = 0;
        for (const t of tiles){
            const n = t.node, qx0 = n.x0 - n.size / 2, qy0 = n.y0 - n.size / 2;
            gl.uniform3f(ub.u_rel, qx0 - s.eye[0], qy0 - s.eye[1], -s.eye[2]);
            gl.uniform2f(ub.u_abs, qx0, qy0);
            gl.uniform1f(ub.u_qs, 2 * n.size);
            for (const c of t.chunks){
                gl.bindVertexArray(c.vao);
                gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_SHORT, 0);
            }
            buildings += t.buildings;
        }
        gl.bindVertexArray(null);
        this.drawnBuildings = buildings;
        this.drawnTiles = tiles.length;
    }
}
