import { HighwayMap } from './renderer.ts';

const started=performance.now();
const base='../../../data/baked/deckgl-008-geojson-layer-paths/';
const responses=await Promise.all(['roads.bin','stats.bin','routes.json'].map(name=>fetch(base+name)));
for(const response of responses)if(!response.ok)throw new Error(`data HTTP ${response.status}`);
const [roads,stats,routes]=await Promise.all([responses[0].arrayBuffer(),responses[1].arrayBuffer(),responses[2].json()]);
const map=new HighwayMap(document.getElementById('map') as HTMLCanvasElement,roads,stats,routes);
map.gl.readPixels(0,0,1,1,map.gl.RGBA,map.gl.UNSIGNED_BYTE,new Uint8Array(4));
const firstFrameMs=performance.now()-started;
const status=document.getElementById('status')!;
const refresh=()=>{status.textContent=`${map.roadCount.toLocaleString('ja-JP')} 道路 · ${map.segmentCount.toLocaleString('ja-JP')} 線分 · zoom ${map.zoom.toFixed(1)}`;};
refresh();
const year=document.getElementById('year') as HTMLInputElement;
year.addEventListener('input',()=>{map.setYear(Number(year.value));document.getElementById('year-value')!.textContent=year.value;});
const canvas=map.canvas,tooltip=document.getElementById('tooltip')!;
let drag:{x:number;y:number}|null=null;
canvas.addEventListener('pointerdown',(event)=>{drag={x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);tooltip.style.display='none';});
canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});
canvas.addEventListener('pointermove',(event)=>{
  if(drag){map.pan(event.clientX-drag.x,event.clientY-drag.y);drag.x=event.clientX;drag.y=event.clientY;refresh();return;}
  const picked=map.pick(event.clientX,event.clientY);
  tooltip.style.display=picked?'block':'none';
  if(picked){
    const [state,type,id,name]=picked.route;
    tooltip.textContent=`${name} (${state}) · ${map.year}年: ${picked.incidents}件の事故、${picked.fatalities}人死亡 · ${type}-${id}`;
    tooltip.style.left=`${event.clientX+12}px`;tooltip.style.top=`${event.clientY+12}px`;
  }
});
canvas.addEventListener('pointerleave',()=>{tooltip.style.display='none';});
canvas.addEventListener('wheel',(event)=>{event.preventDefault();map.zoomAt(Math.exp(-event.deltaY*0.0015),event.clientX,event.clientY);refresh();},{passive:false});
window.addEventListener('resize',()=>map.resize());
if(new URLSearchParams(location.search).has('bench'))await(await import('./bench.ts')).run(map,firstFrameMs);
