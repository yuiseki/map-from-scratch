import { mount } from './globe.ts';
const started=performance.now(); const canvas=document.getElementById('map') as HTMLCanvasElement;
const globe=await mount(canvas,'../../../data/baked/d3-007-projection-comparison/land.png',true);
const first=performance.now()-started;
document.body.insertAdjacentHTML('beforeend','<div class="labels" style="left:30%;bottom:20px">ORTHOGRAPHIC</div><div class="labels right">EQUIRECTANGULAR</div>');
if(new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(globe,first,true);
