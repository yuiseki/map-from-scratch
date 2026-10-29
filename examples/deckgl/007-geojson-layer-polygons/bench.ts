import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import type { VancouverMap } from './renderer.ts';

export async function run(map: VancouverMap, firstFrameMs: number): Promise<void> {
  const {gl}=map;
  gl.canvas.addEventListener('webglcontextlost',()=>emit({error:'WebGL context lost'}));
  emit({metric:'first_frame_ms',value:firstFrameMs});
  emit({info:{gpu:glRenderer(gl),blocks:map.blockCount,vertices:map.vertexCount}});
  emit({check:'all-blocks-loaded',pass:map.blockCount===4627,detail:String(map.blockCount)});
  const initial={x:map.centerX,y:map.centerY,zoom:map.zoom,pitch:map.pitch,yaw:map.yaw};
  await benchFrames(gl,240,(i)=>{
    const t=i/239;
    map.centerX=initial.x+1800*Math.sin(t*Math.PI*2);
    map.centerY=initial.y+900*Math.sin(t*Math.PI*4);
    map.zoom=11+2*(0.5-0.5*Math.cos(t*Math.PI*2));
    map.yaw=20*Math.sin(t*Math.PI*2);
    map.draw();
  });
  Object.assign(map,{centerX:initial.x,centerY:initial.y,zoom:initial.zoom,pitch:initial.pitch,yaw:initial.yaw});
  await benchFrames(gl,60,()=>map.draw(),{prefix:'whole_'});
  const pixels=()=>{
    map.draw();const out=new Uint8Array(map.canvas.width*map.canvas.height*4);
    gl.readPixels(0,0,map.canvas.width,map.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,out);return out;
  };
  const a=pixels();let colored=0;
  for(let i=0;i<a.length;i+=4)if(a[i+2]<180&&a[i]>80)colored++;
  emit({check:'visible-extrusions',pass:colored>10000,detail:`${colored} colored pixels`});
  map.yaw=35;map.pitch=65;const b=pixels();let changed=0;
  for(let i=0;i<a.length;i+=16)if(a[i]!==b[i]||a[i+1]!==b[i+1])changed++;
  emit({check:'camera-changes-screen',pass:changed>1000,detail:`${changed} changed samples`});
  Object.assign(map,{centerX:initial.x,centerY:initial.y,zoom:initial.zoom,pitch:initial.pitch,yaw:initial.yaw});
  map.draw();
  const rect=map.canvas.getBoundingClientRect();
  let picked=null;
  for(let y=0;y<5&&!picked;y++)for(let x=0;x<8&&!picked;x++){
    picked=map.pick(rect.left+rect.width*(x+0.5)/8,rect.top+rect.height*(y+0.5)/5);
  }
  emit({check:'pick-block-values',pass:!!picked&&Number.isFinite(picked.valuePerSqm)&&Number.isFinite(picked.growth),detail:picked?String(picked.id):'none'});
  emit({done:true});
}
