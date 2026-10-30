import { TerrainRenderer, type TerrainTile } from './renderer.ts';

const started=performance.now();
const map=new TerrainRenderer(document.getElementById('map') as HTMLCanvasElement);
const status=document.getElementById('status')!;
const wanted=new Set<string>();
const pending=new Set<string>();
const failures=new Map<string,number>();
const queue:{z:number;x:number;y:number;key:string}[]=[];
let bytes=0,requests=0,drawScheduled=false;
const key=(z:number,x:number,y:number)=>`${z}/${x}/${y}`;
const readyWaiters:(()=>void)[]=[];
let firstReady=false;
const completeWaiters:(()=>void)[]=[];
let completeReady=false;
function schedule():void {
  if(drawScheduled)return;
  drawScheduled=true;
  requestAnimationFrame(()=>{drawScheduled=false;map.draw();status.textContent=`標高 z${Math.floor(map.zoom)} · 読込 ${map.tiles.size} 枚 · 通信 ${requests} 件 / ${(bytes/1048576).toFixed(1)} MiB`;});
}
async function image(url:string,signal:AbortSignal):Promise<ImageBitmap> {
  requests++;
  const response=await fetch(url,{signal});
  if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);
  const blob=await response.blob();
  bytes+=blob.size;
  const bitmap=await createImageBitmap(blob,{colorSpaceConversion:'none'});
  if(bitmap.width!==512||bitmap.height!==512){bitmap.close();throw new Error(`unexpected tile size: ${url}`);}
  return bitmap;
}
async function load(z:number,x:number,y:number,k:string):Promise<void> {
  const demUrl=`https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
  const imageUrl=`https://tiles.versatiles.org/tiles/satellite/${z}/${x}/${y}.webp`;
  const signal=AbortSignal.timeout(6000);
  const [demResult,imageryResult]=await Promise.allSettled([image(demUrl,signal),image(imageUrl,signal)]);
  if(demResult.status==='rejected'||imageryResult.status==='rejected'){
    if(demResult.status==='fulfilled')demResult.value.close();
    if(imageryResult.status==='fulfilled')imageryResult.value.close();
    throw new Error(`${k}: ${String(demResult.status==='rejected'?demResult.reason:(imageryResult as PromiseRejectedResult).reason)}`);
  }
  const dem=demResult.value,imagery=imageryResult.value;
  if(!wanted.has(k)){dem.close();imagery.close();return;}
  const demTexture=map.texture(dem,true),imageTexture=map.texture(imagery);
  dem.close();imagery.close();
  const tile:TerrainTile={z,x,y,dem:demTexture,imagery:imageTexture,lastUsed:performance.now()};
  map.tiles.set(k,tile);
  if(map.tiles.size>96){
    const victims=[...map.tiles.entries()].filter(([id])=>!wanted.has(id)).sort((a,b)=>a[1].lastUsed-b[1].lastUsed);
    for(const [id] of victims.slice(0,map.tiles.size-80))map.remove(id);
  }
  schedule();
  const loaded=[...wanted].filter(id=>map.tiles.has(id)).length;
  if(!firstReady&&loaded>=9){
    firstReady=true;for(const done of readyWaiters)done();readyWaiters.length=0;
  }
  if(!completeReady&&loaded===wanted.size){
    completeReady=true;for(const done of completeWaiters)done();completeWaiters.length=0;
  }
}
function pump():void {
  while(pending.size<25&&queue.length){
    const tile=queue.shift()!;
    if(!wanted.has(tile.key)||map.tiles.has(tile.key)||pending.has(tile.key))continue;
    pending.add(tile.key);
    load(tile.z,tile.x,tile.y,tile.key).catch(error=>{
      const attempts=(failures.get(tile.key)??0)+1;
      failures.set(tile.key,attempts);
      status.textContent=String(error);
      if(attempts<3&&wanted.has(tile.key))setTimeout(()=>{
        if(wanted.has(tile.key)&&!map.tiles.has(tile.key)&&!pending.has(tile.key)){
          queue.unshift(tile);pump();
        }
      },250*attempts);
    }).finally(()=>{pending.delete(tile.key);pump();schedule();});
  }
}
function select():void {
  const z=Math.max(9,Math.min(12,Math.floor(map.zoom))),n=2**z;
  const rad=map.lat*Math.PI/180;
  const cx=Math.floor((map.lon+180)/360*n);
  const cy=Math.floor((1-Math.asinh(Math.tan(rad))/Math.PI)/2*n);
  wanted.clear();queue.length=0;
  const candidates:{z:number;x:number;y:number;key:string;priority:number}[]=[];
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const x=cx+dx,y=cy+dy;
    if(x<0||x>=n||y<0||y>=n)continue;
    const k=key(z,x,y);wanted.add(k);
    if(!map.tiles.has(k)&&!pending.has(k)&&(failures.get(k)??0)<3)candidates.push({z,x,y,key:k,priority:dx*dx+dy*dy});
  }
  candidates.sort((a,b)=>a.priority-b.priority);
  queue.push(...candidates);pump();schedule();
}
select();
const initialReady=new Promise<void>((resolve)=>{
  if(firstReady)resolve();else readyWaiters.push(resolve);
});
const completeReadyPromise=new Promise<void>((resolve)=>{
  if(completeReady)resolve();else completeWaiters.push(resolve);
});
const firstFrameMs=await Promise.race([initialReady.then(()=>{
  map.draw();map.gl.readPixels(0,0,1,1,map.gl.RGBA,map.gl.UNSIGNED_BYTE,new Uint8Array(4));
  return performance.now()-started;
}),new Promise<number>((_,reject)=>setTimeout(()=>reject(new Error('Terrain tiles did not load within 30 seconds')),30000))]);
document.getElementById('wireframe')!.addEventListener('change',(event)=>{map.wireframe=(event.target as HTMLInputElement).checked;schedule();});
document.getElementById('surface')!.addEventListener('change',(event)=>{map.surface=Number((event.target as HTMLSelectElement).value);schedule();});
const locations:Record<string,{lon:number;lat:number;zoom:number;bearing:number}>={
  helens:{lon:-122.18,lat:46.2,zoom:12.5,bearing:120},
  canyon:{lon:-112.1906,lat:36.1101,zoom:12.5,bearing:120},
  sanfrancisco:{lon:-122.1173,lat:37.6,zoom:10,bearing:0},
  losangeles:{lon:-118.2413,lat:34.0524,zoom:10,bearing:0},
  newyork:{lon:-73.9838,lat:40.7311,zoom:13,bearing:0},
  melbourne:{lon:144.9656,lat:-37.8173,zoom:11.5,bearing:0},
  dallas:{lon:-97.0376,lat:32.8,zoom:10,bearing:0},
};
document.getElementById('location')!.addEventListener('change',(event)=>{
  Object.assign(map,locations[(event.target as HTMLSelectElement).value]);select();
});
let drag:{x:number;y:number;rotate:boolean}|null=null;
map.canvas.addEventListener('contextmenu',event=>event.preventDefault());
map.canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY,rotate:event.button===2||event.shiftKey};map.canvas.setPointerCapture(event.pointerId);});
map.canvas.addEventListener('pointerup',()=>{drag=null;});
map.canvas.addEventListener('pointercancel',()=>{drag=null;});
map.canvas.addEventListener('pointermove',event=>{
  if(!drag)return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.x=event.clientX;drag.y=event.clientY;
  if(drag.rotate){map.bearing=(map.bearing+dx*0.3+360)%360;map.pitch=Math.max(0,Math.min(80,map.pitch+dy*0.2));schedule();}
  else{
    const meters=25000*2**(11.5-map.zoom)*2*Math.tan(25*Math.PI/180)/map.canvas.clientHeight;
    const rad=map.bearing*Math.PI/180,scale=Math.cos(map.lat*Math.PI/180);
    const east=-dx*Math.cos(rad)+dy*Math.sin(rad),north=dx*Math.sin(rad)+dy*Math.cos(rad);
    map.lon+=east*meters/(111319.49*scale);map.lat+=north*meters/111319.49;
    map.lat=Math.max(-80,Math.min(80,map.lat));select();
  }
});
map.canvas.addEventListener('wheel',event=>{
  event.preventDefault();map.zoom=Math.max(9,Math.min(13,map.zoom-event.deltaY*0.002));select();
},{passive:false});
window.addEventListener('resize',()=>map.resize());
if(new URLSearchParams(location.search).has('bench')){
  const completeView=Promise.race([completeReadyPromise.then(()=>performance.now()-started),new Promise<number>((_,reject)=>setTimeout(()=>reject(new Error('Complete terrain view did not load within 30 seconds')),30000))]);
  await(await import('./bench.ts')).run(map,firstFrameMs,await completeView,{requests,bytes});
}
