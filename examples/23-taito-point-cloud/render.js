const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_color;
uniform vec3 u_eye, u_forward, u_right, u_up;
uniform float u_tanX, u_tanY, u_near, u_far, u_size;
out vec3 v_color;
void main() {
  vec3 d = a_position - u_eye;
  float depth = dot(d, u_forward);
  float z = (u_far + u_near) / (u_far - u_near) * depth - 2.0 * u_far * u_near / (u_far - u_near);
  gl_Position = vec4(dot(d, u_right) / u_tanX, dot(d, u_up) / u_tanY, z, depth);
  gl_PointSize = clamp(u_size * 220.0 / max(depth, 1.0), 1.2, 8.0);
  v_color = a_color;
}`;
const FS = `#version 300 es
precision highp float;
in vec3 v_color;
out vec4 color;
void main() {
  if (dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5) > 0.25) discard;
  color = vec4(v_color, 1.0);
}`;
export function createRenderer(canvas) {
    const context = canvas.getContext('webgl2', {
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
    });
    if (!context) throw new Error('WebGL2 が使えません');
    const gl = context;
    const program = gl.createProgram();
    for (const [type, source] of [
        [
            gl.VERTEX_SHADER,
            VS
        ],
        [
            gl.FRAGMENT_SHADER,
            FS
        ]
    ]){
        const shader = gl.createShader(type);
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
        size: uniform('u_size')
    };
    function upload(cloud) {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, position);
        gl.bufferData(gl.ARRAY_BUFFER, cloud.positions, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        const color = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, color);
        gl.bufferData(gl.ARRAY_BUFFER, cloud.colors, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.bindVertexArray(null);
        return {
            vao,
            position,
            color,
            count: cloud.count,
            bytes: cloud.positions.byteLength + cloud.colors.byteLength
        };
    }
    function remove(mesh) {
        gl.deleteVertexArray(mesh.vao);
        gl.deleteBuffer(mesh.position);
        gl.deleteBuffer(mesh.color);
    }
    function draw(camera, meshes) {
        const dpr = Math.min(2, devicePixelRatio || 1);
        const width = Math.max(1, Math.round(camera.width * dpr)), height = Math.max(1, Math.round(camera.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.clearColor(0.055, 0.085, 0.11, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(program);
        const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
        const h = Math.cos(pitch), v = Math.sin(pitch), tanY = Math.tan(Math.PI / 6);
        const eye = [
            camera.x + Math.sin(yaw) * h * camera.distance,
            camera.y - Math.cos(yaw) * h * camera.distance,
            50 + v * camera.distance
        ];
        gl.uniform3fv(u.eye, eye);
        gl.uniform3fv(u.forward, [
            -Math.sin(yaw) * h,
            Math.cos(yaw) * h,
            -v
        ]);
        gl.uniform3fv(u.right, [
            Math.cos(yaw),
            Math.sin(yaw),
            0
        ]);
        gl.uniform3fv(u.up, [
            -Math.sin(yaw) * v,
            Math.cos(yaw) * v,
            h
        ]);
        gl.uniform1f(u.tanY, tanY);
        gl.uniform1f(u.tanX, tanY * width / height);
        gl.uniform1f(u.near, Math.max(0.5, camera.distance / 2000));
        gl.uniform1f(u.far, Math.max(10000, camera.distance * 8));
        gl.uniform1f(u.size, camera.size * dpr);
        for (const mesh of meshes){
            gl.bindVertexArray(mesh.vao);
            gl.drawArrays(gl.POINTS, 0, mesh.count);
        }
        gl.bindVertexArray(null);
    }
    return {
        upload,
        remove,
        draw
    };
}
