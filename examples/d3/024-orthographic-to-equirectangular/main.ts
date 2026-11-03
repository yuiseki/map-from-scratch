import { mount } from './globe.ts';
const started=performance.now(); const canvas=document.getElementById('map') as HTMLCanvasElement;
const globe=await mount(canvas,'../../../data/baked/d3-024-orthographic-to-equirectangular/land.png');
const first=performance.now()-started; globe.setMorph(0);
const slider=document.getElementById('morph') as HTMLInputElement; slider.addEventListener('input',()=>globe.setMorph(Number(slider.value)));
if(new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(globe,first,false,false,true);
