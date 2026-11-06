const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
uniform vec3 u_eye, u_forward, u_right, u_up;
uniform float u_tanX, u_tanY, u_near, u_far;
out vec3 v_normal, v_position;
void main() {
  vec3 d = a_position - u_eye;
  float depth = dot(d, u_forward);
  float z = (u_far + u_near) / (u_far - u_near) * depth - 2.0 * u_far * u_near / (u_far - u_near);
  gl_Position = vec4(dot(d, u_right) / u_tanX, dot(d, u_up) / u_tanY, z, depth);
  v_normal = a_normal;
  v_position = a_position;
}`;
const FS = `#version 300 es
precision highp float;
in vec3 v_normal, v_position;
uniform float u_ground;
out vec4 color;
void main() {
  if (u_ground > 0.5) {
    vec2 f = min(fract(v_position.xy / 1000.0), 1.0 - fract(v_position.xy / 1000.0));
    float line = 1.0 - smoothstep(0.0, 20.0, min(f.x, f.y) * 1000.0);
    color = vec4(mix(vec3(0.10, 0.18, 0.23), vec3(0.20, 0.34, 0.38), line * 0.55), 1.0);
    return;
  }
  vec3 n = normalize(v_normal);
  float light = 0.45 + 0.55 * max(dot(n, normalize(vec3(0.45, -0.3, 0.84))), 0.0);
  float variation = 0.06 * sin(v_position.x * 0.002 + v_position.y * 0.003);
  color = vec4((vec3(0.70, 0.79, 0.84) + variation) * light, 1.0);
}`;
export function cameraEye(camera) {
    const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
    const h = Math.cos(pitch), v = Math.sin(pitch);
    return [
        camera.x + Math.sin(yaw) * h * camera.distance,
        camera.y - Math.cos(yaw) * h * camera.distance,
        80 + v * camera.distance
    ];
}
export function createRenderer(canvas) {
    const context = canvas.getContext('webgl2', {
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
    });
    if (!context) throw new Error('WebGL2 が使えません');
    const gl = context;
    const program = gl.createProgram();
    for (const [kind, source] of [
        [
            gl.VERTEX_SHADER,
            VS
        ],
        [
            gl.FRAGMENT_SHADER,
            FS
        ]
    ]){
        const shader = gl.createShader(kind);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
        gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
    const uniform = (name)=>gl.getUniformLocation(program, name);
    const u = {
        eye: uniform('u_eye'),
        forward: uniform('u_forward'),
        right: uniform('u_right'),
        up: uniform('u_up'),
        tanX: uniform('u_tanX'),
        tanY: uniform('u_tanY'),
        near: uniform('u_near'),
        far: uniform('u_far'),
        ground: uniform('u_ground')
    };
    function upload(geometry) {
        const parts = [];
        for (const { positions, normals, indices } of geometry){
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            const position = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, position);
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
            const normal = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, normal);
            gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
            const index = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
            gl.bindVertexArray(null);
            parts.push({
                vao,
                position,
                normal,
                index,
                count: indices.length,
                bytes: positions.byteLength + normals.byteLength + indices.byteLength
            });
        }
        return {
            parts,
            bytes: parts.reduce((n, p)=>n + p.bytes, 0)
        };
    }
    function remove(mesh) {
        for (const p of mesh.parts){
            gl.deleteVertexArray(p.vao);
            gl.deleteBuffer(p.position);
            gl.deleteBuffer(p.normal);
            gl.deleteBuffer(p.index);
        }
    }
    const ground = upload([
        {
            positions: new Float32Array([
                -80000,
                -80000,
                -50,
                80000,
                -80000,
                -50,
                -80000,
                80000,
                -50,
                80000,
                80000,
                -50
            ]),
            normals: new Float32Array([
                0,
                0,
                1,
                0,
                0,
                1,
                0,
                0,
                1,
                0,
                0,
                1
            ]),
            indices: new Uint32Array([
                0,
                1,
                2,
                1,
                3,
                2
            ])
        }
    ]);
    function draw(camera, meshes) {
        const dpr = Math.min(2, devicePixelRatio || 1);
        const width = Math.max(1, Math.round(camera.width * dpr)), height = Math.max(1, Math.round(camera.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.clearColor(0.045, 0.083, 0.12, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(program);
        const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
        const h = Math.cos(pitch), v = Math.sin(pitch);
        const forward = [
            -Math.sin(yaw) * h,
            Math.cos(yaw) * h,
            -v
        ];
        const right = [
            Math.cos(yaw),
            Math.sin(yaw),
            0
        ];
        const up = [
            -Math.sin(yaw) * v,
            Math.cos(yaw) * v,
            h
        ];
        const eye = cameraEye(camera);
        gl.uniform3fv(u.eye, eye);
        gl.uniform3fv(u.forward, forward);
        gl.uniform3fv(u.right, right);
        gl.uniform3fv(u.up, up);
        gl.uniform1f(u.tanY, Math.tan(Math.PI / 6));
        gl.uniform1f(u.tanX, Math.tan(Math.PI / 6) * width / height);
        gl.uniform1f(u.near, Math.max(1, camera.distance / 2000));
        gl.uniform1f(u.far, Math.max(200000, camera.distance * 8));
        const paint = (mesh, groundFlag)=>{
            gl.uniform1f(u.ground, groundFlag);
            for (const part of mesh.parts){
                gl.bindVertexArray(part.vao);
                gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, 0);
            }
        };
        paint(ground, 1);
        for (const mesh of meshes)paint(mesh, 0);
        gl.bindVertexArray(null);
    }
    return {
        upload,
        remove,
        draw
    };
}
