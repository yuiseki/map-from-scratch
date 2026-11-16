const HORIZON = [
    0.843,
    0.91,
    0.969
];
const VS = `#version 300 es
precision highp float; precision highp int; precision highp usampler2D;
uniform usampler2D u_h;
uniform mat4 u_vp;
uniform ivec2 u_dim;
uniform float u_cell;
out vec2 v_uv; out vec3 v_world;
void main() {
  int id = gl_VertexID, W = u_dim.x;
  ivec2 p = ivec2(id % W, id / W);
  // The sun never moves, so the shading is baked into the colour texture and
  // the vertex shader needs the height only for the displacement.
  vec3 pos = vec3(
    (float(p.x) / float(W - 1) - 0.5) * float(W - 1) * u_cell,
    (0.5 - float(p.y) / float(u_dim.y - 1)) * float(u_dim.y - 1) * u_cell,
    float(texelFetch(u_h, p, 0).r));
  v_uv = (vec2(p) + 0.5) / vec2(u_dim);
  v_world = pos;
  gl_Position = u_vp * vec4(pos, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_uv; in vec3 v_world;
uniform sampler2D u_c;
uniform vec3 u_eye;
uniform vec3 u_sky;
out vec4 outColor;
void main() {
  vec3 c = texture(u_c, v_uv).rgb;
  float d = distance(v_world, u_eye);
  c = mix(c, u_sky, 1.0 - exp(-d / 60000.0)); // seen from 14 km, 001's 26 km haze washes the mountain out
  outColor = vec4(c, 1.0);
}`;
export function createRenderer(gl, r) {
    const program = gl.createProgram();
    for (const [type, src] of [
        [
            gl.VERTEX_SHADER,
            VS
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
        gl.attachShader(program, s);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
    const uVp = gl.getUniformLocation(program, 'u_vp');
    const uDim = gl.getUniformLocation(program, 'u_dim');
    const uCell = gl.getUniformLocation(program, 'u_cell');
    const uEye = gl.getUniformLocation(program, 'u_eye');
    const uSky = gl.getUniformLocation(program, 'u_sky');
    const uHeight = gl.getUniformLocation(program, 'u_h');
    const uColour = gl.getUniformLocation(program, 'u_c');
    const heightTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, r.width, r.height, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, r.heights);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const colourTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, colourTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, r.width, r.height, 0, gl.RGB, gl.UNSIGNED_BYTE, r.colours);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const W = r.width, H = r.height;
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let k = 0;
    for(let y = 0; y < H - 1; y++){
        for(let x = 0; x < W - 1; x++){
            const a = y * W + x;
            idx[k++] = a;
            idx[k++] = a + 1;
            idx[k++] = a + W;
            idx[k++] = a + 1;
            idx[k++] = a + W + 1;
            idx[k++] = a + W;
        }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    function draw(view) {
        gl.viewport(0, 0, view.w, view.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, heightTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, colourTex);
        gl.uniform1i(uHeight, 0);
        gl.uniform1i(uColour, 1);
        gl.uniformMatrix4fv(uVp, false, view.m);
        gl.uniform2i(uDim, W, H);
        gl.uniform1f(uCell, r.cellM);
        gl.uniform3fv(uEye, view.eye);
        gl.uniform3fv(uSky, HORIZON);
        gl.bindVertexArray(vao);
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
    }
    return {
        draw,
        triangles: idx.length / 3
    };
}
