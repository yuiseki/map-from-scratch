export async function mount(el, url) {
    const { w, h, p } = await (await fetch(url)).json();
    const prefs = p.map(([code, name, d])=>({
            code,
            name,
            path: new Path2D(d)
        }));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.style.display = 'block';
    el.append(canvas);
    let hover = -1, selected = -1, k = 1;
    function draw() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.lineWidth = devicePixelRatio / k;
        ctx.strokeStyle = '#fff';
        prefs.forEach(({ path }, i)=>{
            ctx.fillStyle = i === selected ? '#c8553d' : i === hover ? '#f2a65a' : '#8fb8a8';
            ctx.fill(path);
            ctx.stroke(path);
        });
    }
    function setHover(i) {
        if (i !== hover) {
            hover = i;
            draw();
        }
    }
    function resize() {
        const cssW = el.clientWidth;
        k = cssW * devicePixelRatio / w;
        canvas.width = Math.round(w * k);
        canvas.height = Math.round(h * k);
        canvas.style.width = `${cssW}px`;
        draw();
    }
    function pick(x, y) {
        const dx = x * devicePixelRatio, dy = y * devicePixelRatio;
        for(let i = 0; i < prefs.length; i++)if (ctx.isPointInPath(prefs[i].path, dx, dy)) return i;
        return -1;
    }
    const at = (e)=>{
        const r = canvas.getBoundingClientRect();
        return pick(e.clientX - r.left, e.clientY - r.top);
    };
    canvas.addEventListener('pointermove', (e)=>{
        const i = at(e);
        canvas.style.cursor = i < 0 ? '' : 'pointer';
        setHover(i);
    });
    canvas.addEventListener('click', (e)=>{
        const i = at(e);
        if (i < 0) return;
        selected = i;
        draw();
        el.dispatchEvent(new CustomEvent('prefecture', {
            detail: {
                code: prefs[i].code,
                name: prefs[i].name
            }
        }));
    });
    canvas.addEventListener('contextrestored', draw);
    new ResizeObserver(resize).observe(el);
    resize();
    return {
        ctx,
        prefs,
        pick,
        draw,
        setHover
    };
}
