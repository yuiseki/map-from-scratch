import { mount, type Quaternion } from './globe.ts'; import { multiply, versorBetween } from './versor.ts';
const started=performance.now(); const canvas=document.getElementById('map') as HTMLCanvasElement;
const globe=await mount(canvas,'../../../data/baked/d3-027-versor-dragging/land.png');
const first=performance.now()-started; let down=false, start:[number,number,number]=[0,0,1], rotation:Quaternion=[1,0,0,0], base:Quaternion=rotation;
function point(e:PointerEvent):[number,number,number] { const r=canvas.getBoundingClientRect(); const s=Math.min(r.width,r.height); let x=(e.clientX-r.left-r.width/2)*2/s, y=-(e.clientY-r.top-r.height/2)*2/s; const d=x*x+y*y; if(d>1){const n=Math.sqrt(d);x/=n;y/=n;return[x,y,0];} return[x,y,Math.sqrt(1-d)]; }
canvas.addEventListener('pointerdown',e=>{down=true;start=point(e);base=rotation;try{canvas.setPointerCapture(e.pointerId)}catch{}});
canvas.addEventListener('pointermove',e=>{if(!down)return;const delta=versorBetween(start,point(e));rotation=multiply(delta,base);globe.setQuaternion(rotation);});
canvas.addEventListener('pointerup',e=>{down=false;base=rotation;try{canvas.releasePointerCapture(e.pointerId)}catch{}});
canvas.addEventListener('pointercancel',()=>{down=false});
if(new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(globe,first,false,false,false,true);
