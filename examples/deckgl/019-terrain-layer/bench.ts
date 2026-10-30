import {benchFrames,emit,glRenderer} from '../../../harness/page/bench.ts';
import type {TerrainRenderer} from './renderer.ts';

export async function run(map:TerrainRenderer,firstFrameMs:number,completeViewMs:number,network:{requests:number;bytes:number}):Promise<void>{
  const gl=map.gl;
  gl.canvas.addEventListener('webglcontextlost',()=>emit({error:'WebGL context lost'}));
  emit({metric:'first_frame_ms',value:firstFrameMs});
  emit({metric:'complete_view_ms',value:completeViewMs});
  emit({info:{gpu:glRenderer(gl),tiles:map.tiles.size,sourceRequests:network.requests,sourceBytes:network.bytes}});
  emit({check:'initial-tiles-loaded',pass:map.tiles.size>=25,detail:`${map.tiles.size} tiles`});
  const initial={bearing:map.bearing,pitch:map.pitch,zoom:map.zoom};
  await benchFrames(gl,180,i=>{
    const t=i/179;
    map.bearing=initial.bearing+60*Math.sin(t*Math.PI*2);
    map.pitch=45+25*(0.5-0.5*Math.cos(t*Math.PI*2));
    map.zoom=12.2+0.6*(0.5-0.5*Math.cos(t*Math.PI*2));
    map.draw();
  });
  Object.assign(map,initial);
  await benchFrames(gl,60,()=>map.draw(),{prefix:'whole_'});
  const pixels=()=>{map.draw();const out=new Uint8Array(map.canvas.width*map.canvas.height*4);gl.readPixels(0,0,map.canvas.width,map.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,out);return out;};
  const before=pixels();let visible=0;
  for(let i=0;i<before.length;i+=4)if(before[i]>25&&before[i+1]>25&&before[i+2]>25)visible++;
  emit({check:'terrain-visible',pass:visible>50000,detail:`${visible} terrain pixels`});
  map.wireframe=true;const lines=pixels();let changed=0;
  for(let i=0;i<before.length;i+=16)if(before[i]!==lines[i]||before[i+1]!==lines[i+1])changed++;
  emit({check:'wireframe-changes-screen',pass:changed>3000,detail:`${changed} changed samples`});
  map.wireframe=false;map.surface=1;const relief=pixels();changed=0;
  for(let i=0;i<before.length;i+=16)if(before[i]!==relief[i]||before[i+1]!==relief[i+1])changed++;
  emit({check:'surface-changes-screen',pass:changed>3000,detail:`${changed} changed samples`});
  map.surface=0;map.bearing=initial.bearing+45;
  const rotated=pixels();changed=0;
  for(let i=0;i<before.length;i+=16)if(before[i]!==rotated[i]||before[i+1]!==rotated[i+1])changed++;
  emit({check:'orbit-changes-screen',pass:changed>3000,detail:`${changed} changed samples`});
  map.bearing=initial.bearing;map.zoom=initial.zoom+0.35;
  const zoomed=pixels();changed=0;
  for(let i=0;i<before.length;i+=16)if(before[i]!==zoomed[i]||before[i+1]!==zoomed[i+1])changed++;
  emit({check:'zoom-changes-screen',pass:changed>3000,detail:`${changed} changed samples`});
  map.zoom=11.8;
  const fallback=pixels();let fallbackVisible=0;
  for(let i=0;i<fallback.length;i+=4)if(fallback[i]>25&&fallback[i+1]>25&&fallback[i+2]>25)fallbackVisible++;
  emit({check:'zoom-transition-fallback',pass:map.fallbackTiles>0&&fallbackVisible>50000,detail:`${map.fallbackTiles} fallback draws, ${fallbackVisible} visible pixels`});
  Object.assign(map,initial);map.draw();emit({done:true});
}
