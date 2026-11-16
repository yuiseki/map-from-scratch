import { createSphereGrid, eyePosition, viewProjection } from './camera.js';
import { ATMOSPHERE_FRAGMENT, ATMOSPHERE_RADIUS, GLOBE_FRAGMENT, VERTEX } from './shading.js';
function compile(gl, fragment) {
    const program = gl.createProgram();
    for (const [type, src] of [
        [
            gl.VERTEX_SHADER,
            VERTEX
        ],
        [
            gl.FRAGMENT_SHADER,
            fragment
        ]
    ]){
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
        gl.attachShader(program, s);
    }
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.bindAttribLocation(program, 1, 'aUv');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    const u = {};
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for(let i = 0; i < n; i++){
        const name = gl.getActiveUniform(program, i).name;
        u[name] = gl.getUniformLocation(program, name);
    }
    return {
        program,
        u
    };
}
function texture(gl, unit, image, gray) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (gray) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, image);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
export class GlobeRenderer {
    gl;
    canvas;
    globe;
    air;
    count;
    constructor(canvas, day, water, lights){
        const gl = canvas.getContext('webgl2', {
            antialias: true,
            powerPreference: 'high-performance'
        });
        if (!gl) throw new Error('WebGL2 is required');
        this.gl = gl;
        this.canvas = canvas;
        this.globe = compile(gl, GLOBE_FRAGMENT);
        this.air = compile(gl, ATMOSPHERE_FRAGMENT);
        const mesh = createSphereGrid(128, 256);
        gl.bindVertexArray(gl.createVertexArray());
        for (const [loc, data, size] of [
            [
                0,
                mesh.positions,
                3
            ],
            [
                1,
                mesh.uvs,
                2
            ]
        ]){
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
        this.count = mesh.indices.length;
        texture(gl, 0, day, false);
        texture(gl, 1, water, true);
        texture(gl, 2, lights, true);
        gl.useProgram(this.globe.program);
        gl.uniform1i(this.globe.u.uDay, 0);
        gl.uniform1i(this.globe.u.uWater, 1);
        gl.uniform1i(this.globe.u.uLights, 2);
        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 0);
    }
    resize(cssWidth, cssHeight) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
        this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    render({ camera, sun, params }) {
        const gl = this.gl;
        const m = viewProjection(camera, this.canvas.width / this.canvas.height);
        const eye = eyePosition(camera);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        let u = this.globe.u;
        gl.useProgram(this.globe.program);
        gl.uniformMatrix4fv(u.uMatrix, false, m);
        gl.uniform1f(u.uRadius, 1);
        gl.uniform3fv(u.uSun, sun);
        gl.uniform3fv(u.uEye, eye);
        gl.uniform3fv(u.uAmbient, params.ambient);
        gl.uniform3fv(u.uDiffuse, params.diffuse);
        gl.uniform3fv(u.uSpecular, params.specular);
        gl.uniform1f(u.uShininess, params.shininess);
        gl.uniform1f(u.uNight, params.night);
        gl.uniform1f(u.uExposure, params.exposure);
        gl.uniform1f(u.uGamma, params.gamma);
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
        if (!params.atmosphere) return;
        u = this.air.u;
        gl.useProgram(this.air.program);
        gl.uniformMatrix4fv(u.uMatrix, false, m);
        gl.uniform1f(u.uRadius, ATMOSPHERE_RADIUS);
        gl.uniform3fv(u.uSun, sun);
        gl.uniform3fv(u.uEye, eye);
        gl.uniform1f(u.uExposure, params.exposure);
        gl.uniform1f(u.uGamma, params.gamma);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.disable(gl.DEPTH_TEST);
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
    }
}
