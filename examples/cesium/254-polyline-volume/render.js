import { globeShaders, landShaders, tubeShaders, GLOW_SCALE, MAX_LINES } from './shaders.js';
import { viewProj, FOV_Y } from './camera.js';
import { TUBE_RADIUS_KM, MIN_PX } from './tubes.js';
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
function invert(m) {
    const a = Array.from(m), inv = new Array(16);
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    return new Float32Array(inv.map((x)=>x / det));
}
export class Renderer {
    gl;
    origin;
    triangles = 0;
    globe;
    land;
    tube;
    constructor(canvas, origin){
        const gl = canvas.getContext('webgl2', {
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance'
        });
        if (!gl) throw new Error('WebGL2 is required');
        this.gl = gl;
        this.origin = origin;
        const uni = (p, names)=>Object.fromEntries(names.map((n)=>[
                    n,
                    gl.getUniformLocation(p, n)
                ]));
        const g = globeShaders(), gp = program(gl, g.vs, g.fs), gvao = gl.createVertexArray();
        gl.bindVertexArray(gvao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1,
            -1,
            3,
            -1,
            -1,
            3
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.globe = {
            p: gp,
            vao: gvao,
            u: uni(gp, [
                'uInvVP',
                'uVP',
                'uEye',
                'uOrigin'
            ])
        };
        const l = landShaders(), lp = program(gl, l.vs, l.fs);
        this.land = {
            p: lp,
            vao: gl.createVertexArray(),
            n: 0,
            u: uni(lp, [
                'uVP',
                'uOrigin'
            ])
        };
        const t = tubeShaders(), tp = program(gl, t.vs, t.fs), hp = program(gl, t.vs, t.halo);
        const names = [
            'uVP',
            'uOrigin',
            'uEye',
            'uRadius',
            'uMinPx',
            'uPxPerRad',
            'uInflate',
            'uColour',
            'uHead',
            'uPulse'
        ];
        this.tube = {
            p: tp,
            halo: hp,
            vao: gl.createVertexArray(),
            n: 0,
            bufs: [],
            u: [
                uni(tp, names),
                uni(hp, names)
            ]
        };
        gl.bindVertexArray(null);
    }
    setLand(pos, idx) {
        const gl = this.gl;
        gl.bindVertexArray(this.land.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        this.land.n = idx.length;
    }
    setTubes(m) {
        const gl = this.gl;
        for (const b of this.tube.bufs)gl.deleteBuffer(b);
        this.tube.bufs = [];
        gl.bindVertexArray(this.tube.vao);
        const buf = (data, target = gl.ARRAY_BUFFER)=>{
            const b = gl.createBuffer();
            this.tube.bufs.push(b);
            gl.bindBuffer(target, b);
            gl.bufferData(target, data, gl.STATIC_DRAW);
            return b;
        };
        buf(m.centre);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        buf(m.offset);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        buf(m.normal);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 3, gl.BYTE, true, 4, 0);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribIPointer(3, 1, gl.BYTE, 4, 3);
        buf(m.along);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
        buf(m.index, gl.ELEMENT_ARRAY_BUFFER);
        gl.bindVertexArray(null);
        this.tube.n = m.index.length;
        this.triangles = m.index.length / 3;
    }
    draw(cam, colours, heads, pulse, target = null) {
        const gl = this.gl, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.viewport(0, 0, W, H);
        const { m, eyeRel } = viewProj(cam, W / H, this.origin);
        gl.depthMask(true);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.ALWAYS);
        gl.useProgram(this.globe.p);
        gl.uniformMatrix4fv(this.globe.u.uInvVP, false, invert(m));
        gl.uniformMatrix4fv(this.globe.u.uVP, false, m);
        gl.uniform3fv(this.globe.u.uEye, eyeRel);
        gl.uniform3fv(this.globe.u.uOrigin, this.origin);
        gl.bindVertexArray(this.globe.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.depthFunc(gl.LEQUAL);
        gl.useProgram(this.land.p);
        gl.uniformMatrix4fv(this.land.u.uVP, false, m);
        gl.uniform3fv(this.land.u.uOrigin, this.origin);
        gl.bindVertexArray(this.land.vao);
        gl.drawElements(gl.TRIANGLES, this.land.n, gl.UNSIGNED_INT, 0);
        const col = new Float32Array(MAX_LINES * 3), hd = new Float32Array(MAX_LINES);
        colours.forEach((c, i)=>col.set(c, i * 3));
        hd.set(heads.slice(0, MAX_LINES));
        gl.bindVertexArray(this.tube.vao);
        gl.enable(gl.CULL_FACE);
        for (const [k, p] of [
            this.tube.p,
            this.tube.halo
        ].entries()){
            const u = this.tube.u[k];
            gl.useProgram(p);
            gl.uniformMatrix4fv(u.uVP, false, m);
            gl.uniform3fv(u.uOrigin, this.origin);
            gl.uniform3fv(u.uEye, eyeRel);
            gl.uniform1f(u.uRadius, TUBE_RADIUS_KM);
            gl.uniform1f(u.uMinPx, MIN_PX);
            gl.uniform1f(u.uPxPerRad, H / (2 * Math.tan(FOV_Y / 2)));
            gl.uniform1f(u.uInflate, k ? GLOW_SCALE : 1);
            gl.uniform3fv(u.uColour, col);
            gl.uniform1fv(u.uHead, hd);
            gl.uniform1f(u.uPulse, pulse ? 1 : 0);
            if (k) {
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.ONE, gl.ONE);
                gl.depthMask(false);
            }
            gl.drawElements(gl.TRIANGLES, this.tube.n, gl.UNSIGNED_INT, 0);
        }
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        gl.disable(gl.CULL_FACE);
        gl.bindVertexArray(null);
    }
}
