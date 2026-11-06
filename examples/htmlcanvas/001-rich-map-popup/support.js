export function supportsHtmlInCanvas(canvas) {
    canvas.setAttribute('content', 'drawable');
    return canvas.content === 'drawable';
}
export function hitTestCacheBuster(make = ()=>document.createElement('i')) {
    const stamp = make();
    let version = 0;
    return ()=>{
        stamp.dataset.v = String(++version);
    };
}
