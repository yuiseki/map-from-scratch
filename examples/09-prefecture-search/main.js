export { };
const data = await (await fetch('../../data/baked/01-prefecture-picker/prefectures.json')).json();
const prefs = data.p.map(([code, name, d])=>({
        code,
        name,
        path: new Path2D(d)
    }));
const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const query = document.getElementById('query');
const result = document.getElementById('result');
const names = document.getElementById('names');
let scale = 1, selected = -1;
for (const pref of prefs){
    const option = document.createElement('option');
    option.value = pref.name;
    names.append(option);
}
function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineWidth = Math.max(1, devicePixelRatio / scale);
    ctx.strokeStyle = '#fff';
    for(let i = 0; i < prefs.length; i++){
        ctx.fillStyle = i === selected ? '#d35b37' : '#a6bad0';
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
query.addEventListener('input', ()=>{
    const text = query.value.trim();
    selected = text ? prefs.findIndex(({ name })=>name.includes(text)) : -1;
    result.textContent = !text ? '県名を入力してください。' : selected < 0 ? '該当する都道府県はありません。' : `${prefs[selected].name} (${prefs[selected].code})`;
    draw();
});
new ResizeObserver(resize).observe(canvas);
resize();
