import { mount } from './globe.ts';
const started=performance.now(); const canvas=document.getElementById('map') as HTMLCanvasElement;
const globe=await mount(canvas,'../../../data/baked/d3-006-projection-transitions/land.json');
const first=performance.now()-started;
if(new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(globe,first);
else { let t=0; const animate=()=>{ t+=0.0025; globe.setMorph(0.5-0.5*Math.cos(t)); const a=t*0.32; globe.setQuaternion([Math.cos(a/2),0,Math.sin(a/2),0]); requestAnimationFrame(animate); }; animate(); }
