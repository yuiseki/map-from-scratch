import { mount } from './globe.ts'; import { greatCirclePoint, viewQuaternion } from './tour.ts';
const started=performance.now(); const canvas=document.getElementById('map') as HTMLCanvasElement;
const globe=await mount(canvas,'../../../data/baked/d3-025-world-tour/land.png');
const first=performance.now()-started; const cities:[[number,number],[number,number],[number,number],[number,number]]=[[139.69,35.68],[103.82,1.35],[-0.12,51.51],[-74.0,40.71]];
if(new URLSearchParams(location.search).has('bench')) { const p=greatCirclePoint(cities[0],cities[1],0.5); globe.setRoute(cities[0],cities[1]); globe.setQuaternion(viewQuaternion(Math.atan2(p[1],p[0])*180/Math.PI,Math.asin(p[2])*180/Math.PI)); await (await import('./bench.ts')).run(globe,first,false,true); }
else { let t=0, last=-1; const animate=()=>{ t=(t+0.00022)%cities.length; const i=Math.floor(t), u=t-i, a=cities[i], b=cities[(i+1)%cities.length]; const p=greatCirclePoint(a,b,u); const lon=Math.atan2(p[1],p[0]), lat=Math.asin(p[2]); if(i!==last){globe.setRoute(a,b);last=i;} globe.setQuaternion(viewQuaternion(lon*180/Math.PI,lat*180/Math.PI)); requestAnimationFrame(animate); }; animate(); }
