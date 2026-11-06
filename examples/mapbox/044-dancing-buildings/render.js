import { VS, FS, SKY } from './dance.js';
import { BANDS, VERTEX_BYTES } from './format.js';
const GROUND_HALF = 32767;
function shader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
}
export function createRenderer(gl, d) {
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    const u = (n)=>gl.getUniformLocation(prog, n);
    const uMVP = u('uMVP'), uLevels = u('uLevels'), uLight = u('uLight'), uEye = u('uEye'), uFog = u('uFog');
    const nv = d.vertexCount, ni = d.indices.length;
    const verts = new Uint8Array((nv + 4) * VERTEX_BYTES);
    verts.set(d.vertices);
    const dv = new DataView(verts.buffer);
    [
        [
            -1,
            -1
        ],
        [
            1,
            -1
        ],
        [
            1,
            1
        ],
        [
            -1,
            1
        ]
    ].forEach(([sx, sy], i)=>{
        const o = (nv + i) * VERTEX_BYTES;
        dv.setInt16(o, sx * GROUND_HALF, true);
        dv.setInt16(o + 2, sy * GROUND_HALF, true);
        dv.setUint8(o + 6, 255);
    });
    const idx = new Uint32Array(ni + 6);
    idx.set(d.indices);
    idx.set([
        nv,
        nv + 1,
        nv + 2,
        nv,
        nv + 2,
        nv + 3
    ], ni);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.SHORT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, false, VERTEX_BYTES, 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 1, gl.UNSIGNED_BYTE, VERTEX_BYTES, 6);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, false, VERTEX_BYTES, 7);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(SKY[0], SKY[1], SKY[2], 1);
    return {
        gl,
        triangles: idx.length / 3,
        draw (v, levels, light, fog) {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.useProgram(prog);
            gl.uniformMatrix4fv(uMVP, false, v.m);
            gl.uniform1fv(uLevels, levels, 0, BANDS);
            gl.uniform4fv(uLight, light);
            gl.uniform3fv(uEye, v.eye);
            gl.uniform2f(uFog, fog[0], fog[1]);
            gl.bindVertexArray(vao);
            gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
            gl.bindVertexArray(null);
        }
    };
}
