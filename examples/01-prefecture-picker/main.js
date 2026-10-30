import { mount } from './picker.js';
const el = document.getElementById('map');
el.addEventListener('prefecture', (e)=>{
    const { name, code } = e.detail;
    document.getElementById('out').textContent = `${name} (${code}) の記事を表示`;
});
const map = await mount(el, '../../data/baked/01-prefecture-picker/prefectures.json');
if (new URLSearchParams(location.search).has('bench')) {
    const [bench] = await Promise.all([
        import('./bench.js'),
        import('../../harness/page/bench.js')
    ]);
    await bench.run(el, map);
}
