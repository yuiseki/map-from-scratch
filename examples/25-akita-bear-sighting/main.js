const GEO_ASPECT = 0.6412;
const LAND_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_isAkita;
uniform vec2 u_vp;
out float v_isAkita;

vec2 transformPos(vec2 pos) {
  vec2 norm = pos / 65535.0;
  vec2 p = vec2(norm.x - 0.5, norm.y - 0.5);
  p.x *= ${GEO_ASPECT};
  float screenAspect = u_vp.x / u_vp.y;
  // p.x already carries GEO_ASPECT: only the screen aspect is left to undo.
  if (screenAspect > ${GEO_ASPECT}) {
    return vec2(p.x * 2.15 / screenAspect, p.y * 2.15);
  } else {
    return vec2(p.x * 2.15 / ${GEO_ASPECT}, p.y * 2.15 * (screenAspect / ${GEO_ASPECT}));
  }
}

void main() {
  v_isAkita = a_isAkita;
  vec2 p = transformPos(a_pos);
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const LAND_FS = `#version 300 es
precision mediump float;
in float v_isAkita;
out vec4 o_color;
void main() {
  // Distinct palette: Akita (#233649) vs neighbors (#17222e)
  if (v_isAkita > 0.5) {
    o_color = vec4(0.14, 0.22, 0.30, 1.0);
  } else {
    o_color = vec4(0.09, 0.13, 0.18, 1.0);
  }
}`;
const POINT_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_day;
layout(location=2) in vec4 a_info; // animal, kind, city, heads
layout(location=3) in vec2 a_extra; // hour, incidentIdx

uniform vec2 u_vp;
uniform float u_time;
uniform float u_window;
uniform uint u_animal_mask;
uniform uint u_kind_mask;
uniform float u_dpr;

out vec4 v_col;
out float v_isInjury;

vec2 transformPos(vec2 pos) {
  vec2 norm = pos / 65535.0;
  vec2 p = vec2(norm.x - 0.5, norm.y - 0.5);
  p.x *= ${GEO_ASPECT};
  float screenAspect = u_vp.x / u_vp.y;
  // p.x already carries GEO_ASPECT: only the screen aspect is left to undo.
  if (screenAspect > ${GEO_ASPECT}) {
    return vec2(p.x * 2.15 / screenAspect, p.y * 2.15);
  } else {
    return vec2(p.x * 2.15 / ${GEO_ASPECT}, p.y * 2.15 * (screenAspect / ${GEO_ASPECT}));
  }
}

void main() {
  float age = u_time - a_day;
  if (age < 0.0 || age > u_window) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  uint animal = uint(a_info.x);
  uint animalBit = 1u << (animal - 1u);
  if ((u_animal_mask & animalBit) == 0u) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  uint kind = uint(a_info.y);
  uint kindBit = (kind == 4u) ? 8u : (1u << (kind - 1u));
  if ((u_kind_mask & kindBit) == 0u) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  float fade = 1.0 - (age / u_window);
  vec3 rgb;
  float baseSize;
  bool isInj = (kind == 4u);
  v_isInjury = isInj ? 1.0 : 0.0;

  if (isInj) {
    rgb = vec3(1.0, 0.15, 0.15);
    baseSize = 13.0 + 3.0 * fade;
  } else if (animal == 1u) {
    // Bear: vibrant orange
    rgb = vec3(1.0, 0.45, 0.05);
    baseSize = 5.5 + 2.0 * fade;
  } else if (animal == 2u) {
    // Boar: cyan / teal
    rgb = vec3(0.12, 0.85, 0.65);
    baseSize = 5.0 + 1.5 * fade;
  } else {
    // Deer: yellow
    rgb = vec3(0.98, 0.82, 0.12);
    baseSize = 5.0 + 1.5 * fade;
  }

  gl_PointSize = baseSize * u_dpr;
  float alpha = isInj ? 1.0 : (0.25 + 0.70 * fade);
  v_col = vec4(rgb, alpha);
  gl_Position = vec4(transformPos(a_pos), 0.0, 1.0);
}`;
const POINT_FS = `#version 300 es
precision mediump float;
in vec4 v_col;
in float v_isInjury;
out vec4 o_color;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float r = length(coord) * 2.0;

  if (v_isInjury > 0.5) {
    // Ring + dot for human injuries
    float a = 0.0;
    if (r < 0.45) {
      a = smoothstep(0.45, 0.35, r);
    } else if (r > 0.65 && r < 1.0) {
      a = smoothstep(0.65, 0.75, r) * smoothstep(1.0, 0.85, r) * 0.85;
    }
    if (a < 0.02) discard;
    o_color = vec4(v_col.rgb, a);
  } else {
    float a = smoothstep(1.0, 0.75, r);
    if (a < 0.02) discard;
    o_color = vec4(v_col.rgb, v_col.a * a);
  }
}`;
function createProgram(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    for (const [type, src] of [
        [
            gl.VERTEX_SHADER,
            vsSrc
        ],
        [
            gl.FRAGMENT_SHADER,
            fsSrc
        ]
    ]){
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(s) ?? 'Shader compilation failed');
        }
        gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(p) ?? 'Program link failed');
    }
    return p;
}
export async function init() {
    const canvas = document.getElementById('map');
    const ctx = canvas.getContext('webgl2', {
        antialias: true,
        alpha: false
    });
    if (!ctx) throw new Error('WebGL2 not supported');
    const gl = ctx;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.08, 0.11, 0.15, 1.0);
    const [landBuf, sightingsBuf, metaRes, incidentsRes] = await Promise.all([
        fetch('../../data/baked/25-akita-bear-sighting/akita.bin').then((r)=>r.arrayBuffer()),
        fetch('../../data/baked/25-akita-bear-sighting/sightings.bin').then((r)=>r.arrayBuffer()),
        fetch('../../data/baked/25-akita-bear-sighting/meta.json').then((r)=>r.json()),
        fetch('../../data/baked/25-akita-bear-sighting/incidents.json').then((r)=>r.json())
    ]);
    const meta = metaRes;
    const incidents = incidentsRes;
    const incidentMap = new Map();
    incidents.forEach((inc, i)=>incidentMap.set(i + 1, inc));
    const landProg = createProgram(gl, LAND_VS, LAND_FS);
    const uLandVp = gl.getUniformLocation(landProg, 'u_vp');
    const landVao = gl.createVertexArray();
    gl.bindVertexArray(landVao);
    const landVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, landVbo);
    gl.bufferData(gl.ARRAY_BUFFER, landBuf, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, false, 6, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, false, 6, 4);
    const landVertexCount = landBuf.byteLength / 6;
    const pointProg = createProgram(gl, POINT_VS, POINT_FS);
    const uPointVp = gl.getUniformLocation(pointProg, 'u_vp');
    const uPointTime = gl.getUniformLocation(pointProg, 'u_time');
    const uPointWindow = gl.getUniformLocation(pointProg, 'u_window');
    const uPointAnimalMask = gl.getUniformLocation(pointProg, 'u_animal_mask');
    const uPointKindMask = gl.getUniformLocation(pointProg, 'u_kind_mask');
    const uPointDpr = gl.getUniformLocation(pointProg, 'u_dpr');
    const pointVao = gl.createVertexArray();
    gl.bindVertexArray(pointVao);
    const pointVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pointVbo);
    gl.bufferData(gl.ARRAY_BUFFER, sightingsBuf, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, false, 12, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, false, 12, 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, false, 12, 6);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.UNSIGNED_BYTE, false, 12, 10);
    const totalPoints = sightingsBuf.byteLength / 12;
    const rawSightings = new DataView(sightingsBuf);
    let currentDay = 560;
    let windowDays = 30;
    let animalMask = 7;
    let kindMask = 15;
    let isPlaying = false;
    let playAnimId = 0;
    const slider = document.getElementById('slider');
    const dateLabel = document.getElementById('date-label');
    const playBtn = document.getElementById('play-btn');
    const windowSelect = document.getElementById('window-select');
    const chkBear = document.getElementById('chk-bear');
    const chkBoar = document.getElementById('chk-boar');
    const chkDeer = document.getElementById('chk-deer');
    const chkInjury = document.getElementById('chk-injury');
    const statVisible = document.getElementById('stat-visible');
    const statBear = document.getElementById('stat-bear');
    const statBoar = document.getElementById('stat-boar');
    const statDeer = document.getElementById('stat-deer');
    const statInjury = document.getElementById('stat-injury');
    const tooltip = document.getElementById('tooltip');
    const ttHead = document.getElementById('tt-head');
    const ttInfo = document.getElementById('tt-info');
    const ttDesc = document.getElementById('tt-desc');
    slider.max = String(meta.maxDays);
    slider.value = String(currentDay);
    const baseDateEpoch = new Date(meta.baseDate).getTime();
    const formatDay = (day)=>{
        const d = new Date(baseDateEpoch + day * 86400 * 1000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    };
    const updateStats = ()=>{
        let cTotal = 0, cBear = 0, cBoar = 0, cDeer = 0, cInjury = 0;
        for(let i = 0; i < totalPoints; i++){
            const off = i * 12;
            const day = rawSightings.getUint16(off + 4, true);
            const age = currentDay - day;
            if (age < 0 || age > windowDays) continue;
            const animal = rawSightings.getUint8(off + 6);
            const animalBit = 1 << animal - 1;
            if ((Number(animalMask) & animalBit) === 0) continue;
            const kind = rawSightings.getUint8(off + 7);
            const kindBit = kind === 4 ? 8 : 1 << kind - 1;
            if ((Number(kindMask) & kindBit) === 0) continue;
            cTotal++;
            if (animal === 1) cBear++;
            else if (animal === 2) cBoar++;
            else if (animal === 3) cDeer++;
            if (kind === 4) cInjury++;
        }
        statVisible.textContent = cTotal.toLocaleString();
        statBear.textContent = cBear.toLocaleString();
        statBoar.textContent = cBoar.toLocaleString();
        statDeer.textContent = cDeer.toLocaleString();
        statInjury.textContent = cInjury.toLocaleString();
    };
    function render() {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth * dpr;
        const h = canvas.clientHeight * dpr;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(landProg);
        gl.uniform2f(uLandVp, canvas.width, canvas.height);
        gl.bindVertexArray(landVao);
        gl.drawArrays(gl.TRIANGLES, 0, landVertexCount);
        gl.useProgram(pointProg);
        gl.uniform2f(uPointVp, canvas.width, canvas.height);
        gl.uniform1f(uPointTime, currentDay);
        gl.uniform1f(uPointWindow, windowDays);
        gl.uniform1ui(uPointAnimalMask, animalMask);
        gl.uniform1ui(uPointKindMask, kindMask);
        gl.uniform1f(uPointDpr, dpr);
        gl.bindVertexArray(pointVao);
        gl.drawArrays(gl.POINTS, 0, totalPoints);
    }
    const setDay = (d)=>{
        currentDay = Math.max(0, Math.min(meta.maxDays, d));
        slider.value = String(Math.round(currentDay));
        dateLabel.textContent = formatDay(Math.round(currentDay));
        render();
        updateStats();
    };
    slider.oninput = ()=>setDay(parseFloat(slider.value));
    windowSelect.onchange = ()=>{
        windowDays = parseFloat(windowSelect.value);
        render();
        updateStats();
    };
    const updateMasks = ()=>{
        let aMask = 0;
        if (chkBear.checked) aMask |= 1;
        if (chkBoar.checked) aMask |= 2;
        if (chkDeer.checked) aMask |= 4;
        animalMask = aMask;
        let kMask = 0;
        kMask |= 1 | 2 | 4;
        if (chkInjury.checked) kMask |= 8;
        kindMask = kMask;
        render();
        updateStats();
    };
    chkBear.onchange = updateMasks;
    chkBoar.onchange = updateMasks;
    chkDeer.onchange = updateMasks;
    chkInjury.onchange = updateMasks;
    const playStep = ()=>{
        if (!isPlaying) return;
        let next = currentDay + 1.5;
        if (next > meta.maxDays) next = 0;
        setDay(next);
        playAnimId = requestAnimationFrame(playStep);
    };
    playBtn.onclick = ()=>{
        isPlaying = !isPlaying;
        playBtn.textContent = isPlaying ? '一時停止' : '再生';
        if (isPlaying) playAnimId = requestAnimationFrame(playStep);
        else cancelAnimationFrame(playAnimId);
    };
    canvas.onmousemove = (e)=>{
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const cw = rect.width, ch = rect.height;
        const clipX = mx / cw * 2.0 - 1.0;
        const clipY = 1.0 - my / ch * 2.0;
        const screenAspect = cw / ch;
        let px = clipX / 2.15;
        let py = clipY / 2.15;
        if (screenAspect > GEO_ASPECT) {
            px *= screenAspect;
        } else {
            px *= GEO_ASPECT;
            py /= screenAspect / GEO_ASPECT;
        }
        px /= GEO_ASPECT;
        const targetNormX = px + 0.5;
        const targetNormY = py + 0.5;
        let bestDist = 0.015;
        let bestIdx = -1;
        for(let i = 0; i < totalPoints; i++){
            const off = i * 12;
            const day = rawSightings.getUint16(off + 4, true);
            const age = currentDay - day;
            if (age < 0 || age > windowDays) continue;
            const animal = rawSightings.getUint8(off + 6);
            const animalBit = 1 << animal - 1;
            if ((Number(animalMask) & animalBit) === 0) continue;
            const kind = rawSightings.getUint8(off + 7);
            const kindBit = kind === 4 ? 8 : 1 << kind - 1;
            if ((Number(kindMask) & kindBit) === 0) continue;
            const u16x = rawSightings.getUint16(off, true);
            const u16y = rawSightings.getUint16(off + 2, true);
            const nx = u16x / 65535.0;
            const ny = u16y / 65535.0;
            const dx = (nx - targetNormX) * GEO_ASPECT;
            const dy = ny - targetNormY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }
        if (bestIdx >= 0) {
            const off = bestIdx * 12;
            const day = rawSightings.getUint16(off + 4, true);
            const animal = rawSightings.getUint8(off + 6);
            const kind = rawSightings.getUint8(off + 7);
            const cityId = rawSightings.getUint8(off + 8);
            const heads = rawSightings.getUint8(off + 9);
            const hour = rawSightings.getUint8(off + 10);
            const incIdx = rawSightings.getUint8(off + 11);
            const cityName = meta.cities[cityId - 1] || '秋田県内';
            const animalName = meta.animals[animal] || '野生動物';
            const kindName = meta.kinds[kind] || '出没';
            ttHead.textContent = `${formatDay(day)} ${hour}時頃 - ${cityName}`;
            ttInfo.textContent = `${animalName} ${heads}頭 (${kindName})`;
            if (incIdx > 0 && incidentMap.has(incIdx)) {
                ttDesc.textContent = incidentMap.get(incIdx).desc;
                ttDesc.style.display = 'block';
            } else {
                ttDesc.style.display = 'none';
            }
            tooltip.style.left = `${mx}px`;
            tooltip.style.top = `${my}px`;
            tooltip.style.display = 'block';
        } else {
            tooltip.style.display = 'none';
        }
    };
    canvas.onmouseleave = ()=>{
        tooltip.style.display = 'none';
    };
    window.onresize = render;
    setDay(currentDay);
    const api = {
        gl,
        canvas,
        meta,
        setDay,
        setFilter: (bear, boar, deer, injury)=>{
            chkBear.checked = bear;
            chkBoar.checked = boar;
            chkDeer.checked = deer;
            chkInjury.checked = injury;
            updateMasks();
        },
        render,
        readPixel: (clipX, clipY)=>{
            const px = Math.round((clipX + 1.0) / 2.0 * canvas.width);
            const py = Math.round((clipY + 1.0) / 2.0 * canvas.height);
            const buf = new Uint8Array(4);
            gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            return [
                buf[0],
                buf[1],
                buf[2],
                buf[3]
            ];
        }
    };
    window.__akitaMap = api;
    if (window.location.search.includes('bench')) {
        import('./bench.js').then((b)=>b.runBench(api));
    }
    return api;
}
init().catch((err)=>{
    console.error('Map initialization failed:', err);
});
