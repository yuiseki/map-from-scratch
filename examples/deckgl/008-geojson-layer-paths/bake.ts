import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Road = { geometry: { type: 'LineString' | 'MultiLineString'; coordinates: number[][] | number[][][] }; properties: { state: string; type: string; id: string; name: string; length: number } };
const roads = (JSON.parse(readFileSync(source('deckgl-highway-roads'), 'utf8')) as { features: Road[] }).features;
const accidentLines = readFileSync(source('deckgl-highway-accidents'), 'utf8').trim().split(/\r?\n/);
if (accidentLines[0] !== 'state,type,id,year,incidents,fatalities') throw new Error('unexpected accident CSV header');
const dir = 'data/baked/deckgl-008-geojson-layer-paths';
mkdirSync(dir, { recursive: true });
const R = 6378137;
const project = ([lon, lat]: number[]): [number, number] => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const paths: [number, number][][][] = [];
for (const road of roads) {
  const lines = road.geometry.type === 'LineString' ? [road.geometry.coordinates as number[][]] : road.geometry.coordinates as number[][][];
  const projected = lines.map((line) => line.map(project));
  paths.push(projected);
  for (const line of projected) for (const [x,y] of line) {
    minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y);
  }
}
const scaleX = (maxX-minX)/65535, scaleY = (maxY-minY)/65535;
const segments: number[][] = [];
for (const [roadId, lines] of paths.entries()) for (const line of lines) for (let i=1;i<line.length;i++) {
  const a=line[i-1],b=line[i];
  const q = (p: [number,number]) => [Math.round((p[0]-minX)/scaleX),Math.round((p[1]-minY)/scaleY)];
  const [x0,y0]=q(a),[x1,y1]=q(b);
  if (x0===x1&&y0===y1) continue;
  segments.push([x0,y0,x1,y1,roadId]);
}
const mesh = Buffer.allocUnsafe(28+segments.length*10);
mesh.write('HW01',0,'ascii'); mesh.writeUInt32LE(segments.length,4); mesh.writeUInt32LE(roads.length,8);
mesh.writeFloatLE(minX,12); mesh.writeFloatLE(minY,16); mesh.writeFloatLE(scaleX,20); mesh.writeFloatLE(scaleY,24);
segments.forEach((s,i)=>{ const at=28+i*10; for(let k=0;k<5;k++)mesh.writeUInt16LE(s[k],at+k*2); });
writeFileSync(`${dir}/roads.bin`,mesh);
const routes=roads.map((road)=>{
  const {state,type,id,name,length}=road.properties;
  if(!Number.isFinite(length)||length<=0)throw new Error(`invalid length for ${state}-${type}-${id}`);
  return [state,type,id,name,length] as const;
});
writeFileSync(`${dir}/routes.json`,JSON.stringify(routes));
const byKey=new Map<string,number[]>();
routes.forEach(([state,type,id],i)=>{
  const key=`${state}-${type}-${id}`, found=byKey.get(key);
  if(found)found.push(i);else byKey.set(key,[i]);
});
const stats=Buffer.alloc(8+26*roads.length*2);
stats.write('HS01',0,'ascii');stats.writeUInt32LE(roads.length,4);
let matched=0;
for(const row of accidentLines.slice(1)){
  const [state,type,id,yearText,incText,fatalText]=row.split(',');
  const year=Number(yearText),inc=Number(incText),fatal=Number(fatalText);
  if(year<1990||year>2015||!Number.isInteger(inc)||!Number.isInteger(fatal)||inc<0||inc>255||fatal<0||fatal>255)throw new Error(`invalid accident row ${row}`);
  const roadsForKey=byKey.get(`${state}-${type}-${id}`);
  if(!roadsForKey)continue;
  for(const i of roadsForKey){const at=8+((year-1990)*roads.length+i)*2;stats[at]=inc;stats[at+1]=fatal;matched++;}
}
writeFileSync(`${dir}/stats.bin`,stats);
console.log(`${roads.length} roads, ${segments.length} quantized segments, ${accidentLines.length-1} annual rows, ${matched} road-year matches`);
