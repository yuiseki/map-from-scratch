import { POINT_VS, POINT_FS, FULLSCREEN_VS, EDL_FS } from './shading.js';
export const BACKGROUND = [
    0.043,
    0.063,
    0.098
];
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
    const u = (name)=>gl.getUniformLocation(p, name);
    return {
        p,
        u
    };
}
export function createRenderer(canvas) {
    const ctx = canvas.getContext('webgl2', {
        antialias: false,
        alpha: false,
        depth: false,
        powerPreference: 'high-performance'
    });
    if (!ctx) throw new Error('WebGL2 が使えません');
    const gl = ctx;
    const points = program(gl, POINT_VS, POINT_FS);
    const edl = program(gl, FULLSCREEN_VS, EDL_FS);
    const pu = {
        viewProj: points.u('u_viewProj'),
        eye: points.u('u_eye'),
        forward: points.u('u_forward'),
        min: points.u('u_min'),
        extent: points.u('u_extent'),
        point: points.u('u_point'),
        attenuate: points.u('u_attenuate')
    };
    const eu = {
        color: edl.u('u_color'),
        depth: edl.u('u_depth'),
        nearFar: edl.u('u_nearFar'),
        radius: edl.u('u_radius'),
        strength: edl.u('u_strength'),
        on: edl.u('u_edl')
    };
    const empty = gl.createVertexArray();
    const fbo = gl.createFramebuffer();
    const colorTex = gl.createTexture(), depthTex = gl.createTexture();
    let fw = 0, fh = 0;
    function target(w, h) {
        if (w === fw && h === fh) return;
        fw = w;
        fh = h;
        for (const [tex, internal, format, type] of [
            [
                colorTex,
                gl.RGBA8,
                gl.RGBA,
                gl.UNSIGNED_BYTE
            ],
            [
                depthTex,
                gl.DEPTH_COMPONENT32F,
                gl.DEPTH_COMPONENT,
                gl.FLOAT
            ]
        ]){
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    function upload(node, bytes) {
        const vao = gl.createVertexArray(), buffer = gl.createBuffer();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(bytes, 0, node.count * 9), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, true, 6, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 3, node.count * 6);
        gl.bindVertexArray(null);
        return {
            vao,
            buffer,
            node
        };
    }
    function draw(frame) {
        const w = canvas.width, h = canvas.height;
        target(w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, w, h);
        gl.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);
        gl.clearDepth(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(points.p);
        const v = frame.view;
        gl.uniformMatrix4fv(pu.viewProj, false, v.viewProj);
        gl.uniform3fv(pu.eye, v.eye);
        gl.uniform3fv(pu.forward, v.forward);
        for (const { mesh, point } of frame.items){
            const n = mesh.node;
            gl.uniform3f(pu.min, n.min[0], n.min[1], n.min[2]);
            gl.uniform3f(pu.extent, n.max[0] - n.min[0], n.max[1] - n.min[1], n.max[2] - n.min[2]);
            gl.uniform3f(pu.point, point.maxSize, point.geometricError, point.depthMultiplier);
            gl.uniform1i(pu.attenuate, point.attenuate ? 1 : 0);
            gl.bindVertexArray(mesh.vao);
            gl.drawArrays(gl.POINTS, 0, n.count);
        }
        gl.disable(gl.DEPTH_TEST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.useProgram(edl.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, colorTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, depthTex);
        gl.uniform1i(eu.color, 0);
        gl.uniform1i(eu.depth, 1);
        gl.uniform2f(eu.nearFar, v.near, v.far);
        gl.uniform1f(eu.radius, frame.edl.radius);
        gl.uniform1f(eu.strength, frame.edl.strength);
        gl.uniform1i(eu.on, frame.edl.on ? 1 : 0);
        gl.bindVertexArray(empty);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    }
    return {
        gl,
        upload,
        draw
    };
}
