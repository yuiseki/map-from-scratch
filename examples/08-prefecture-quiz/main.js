export { };
const data = await (await fetch('../../data/baked/01-prefecture-picker/prefectures.json')).json();
const prefs = data.p.map(([code, name, d])=>({
        code,
        name,
        path: new Path2D(d)
    }));
const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const target = document.getElementById('target');
const statusEl = document.getElementById('status');
const restart = document.getElementById('restart');
let scale = 1, current = 0, mistake = -1;
let order = [];
function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineWidth = Math.max(1, devicePixelRatio / scale);
    ctx.strokeStyle = '#fff';
    for(let i = 0; i < prefs.length; i++){
        ctx.fillStyle = i === mistake ? '#de795e' : '#9dbfae';
        ctx.fill(prefs[i].path);
        ctx.stroke(prefs[i].path);
    }
}
function resize() {
    const width = canvas.getBoundingClientRect().width;
    scale = width * devicePixelRatio / data.w;
    canvas.width = Math.round(data.w * scale);
    canvas.height = Math.round(data.h * scale);
    draw();
}
function start() {
    order = prefs.map((_, i)=>i);
    for(let i = order.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [
            order[j],
            order[i]
        ];
    }
    current = 0;
    mistake = -1;
    target.textContent = `第 1 問: ${prefs[order[0]].name} はどこ？`;
    statusEl.textContent = `0 / ${prefs.length} 問正解`;
    draw();
}
canvas.addEventListener('click', (event)=>{
    if (current >= order.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * devicePixelRatio;
    const y = (event.clientY - rect.top) * devicePixelRatio;
    const picked = prefs.findIndex(({ path })=>ctx.isPointInPath(path, x, y));
    if (picked < 0) return;
    if (picked !== order[current]) {
        mistake = picked;
        statusEl.textContent = `${prefs[picked].name}です。もう一度選んでください。`;
        draw();
        return;
    }
    mistake = -1;
    current++;
    statusEl.textContent = `正解！ ${current} / ${prefs.length} 問正解`;
    target.textContent = current < order.length ? `第 ${current + 1} 問: ${prefs[order[current]].name} はどこ？` : '全問正解です。';
    draw();
});
restart.addEventListener('click', start);
new ResizeObserver(resize).observe(canvas);
start();
resize();
