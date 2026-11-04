/** Offline, read-only source adapter. Never imports evaluator truth or credentials. */
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {BeliefEventSchema,type BeliefEpisode} from '../src/domain/belief-contracts.ts';
import {validateNames} from './qualification-requests.ts';

const [packetArg,trialArg,outputArg]=process.argv.slice(2);
if(!packetArg||!trialArg||!outputArg)throw new Error('Usage: belief-import-smoke.ts PACKET TRIAL OUTPUT_JSON');
const packet=resolve(packetArg),trial=resolve(trialArg),hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(readFileSync(join(packet,'predictor/inputs.json'),'utf8'));
const ledger=JSON.parse(readFileSync(join(trial,'ledger.json'),'utf8')) as {key:string;status:string}[];
const files=readdirSync(trial).filter(f=>f.endsWith('.json')).sort();
const records=files.flatMap(file=>{const row=JSON.parse(readFileSync(join(trial,file),'utf8'));return row?.method==='automatic-sam-proposal'?[row]:[];});
const events:BeliefEpisode[]=[],receipts:{path:string;sha256:string}[]=[];
const read=(path:string)=>{const bytes=readFileSync(path);receipts.push({path:relative(trial,path),sha256:hash(bytes)});return bytes;};
for(const frameId of [...new Set(records.map(r=>r.frame))]){
 const input=manifest.frames.find((f:any)=>f.id===frameId);if(!input||input.split!=='development')throw new Error('Only existing development predictions may be imported');
 const imagePath=resolve(packet,'predictor',input.image),rel=relative(join(packet,'predictor'),imagePath);
 if(rel.startsWith('..')||rel.startsWith('/'))throw new Error('Source path escaped predictor');
 const sourceBytes=read(imagePath);if(hash(sourceBytes)!==input.sha256)throw new Error('Source hash changed');
 const source=PNG.sync.read(sourceBytes);
 if(source.width!==input.width||source.height!==input.height)throw new Error('Source dimensions changed');
 const frameRecords=records.filter(r=>r.frame===frameId),resultFile=`${frameId}-result.json`;
 const names=new Map<string,string>();
 if(files.includes(resultFile)){
  const result=JSON.parse(read(join(trial,resultFile)).toString());if(result.frame!==frameId)throw new Error('Wrong naming frame');
  for(const row of validateNames(result.names,frameRecords.map(r=>r.id)).regions)names.set(row.regionId,row.label);
 }
 const discoveryIndex=ledger.findIndex(a=>a.key===input.sha256+':discover'&&a.status==='completed');
 if(discoveryIndex<0)throw new Error('Missing completed source discovery');
 const response=JSON.parse(read(join(trial,`call-${discoveryIndex+1}`,'response.json')).toString());
 if(!Number.isFinite(response.created_at))throw new Error('Provider observation time missing');
 const observations=frameRecords.map(row=>{
  if(!/^[a-f0-9]{64}$/.test(row.id))throw new Error('Invalid region ID');
  read(join(trial,`${row.id}.json`));
  const bytes=read(join(trial,`${row.id}.png`)),crop=PNG.sync.read(bytes),b=row.bounds;
  if(row.sourceSha256!==input.sha256||![b.left,b.top,b.right,b.bottom].every(Number.isInteger)||b.left<0||b.top<0||b.right>source.width||b.bottom>source.height||crop.width!==b.right-b.left||crop.height!==b.bottom-b.top)throw new Error('Invalid source-bound crop');
  const cropHash=hash(bytes);
  if(hash(input.sha256+JSON.stringify([b.left,b.top,b.right,b.bottom])+cropHash)!==row.id)throw new Error('Crop identity mismatch');
  const histogram=Array<number>(24).fill(0);let pixels=0;
  for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++){
   const i=(y*crop.width+x)*4,alpha=crop.data[i+3];if(!alpha)continue;
   if(alpha!==255)throw new Error('Nonbinary crop alpha');pixels++;
   const si=((b.top+y)*source.width+b.left+x)*4;
   for(let channel=0;channel<3;channel++){
    if(crop.data[i+channel]!==source.data[si+channel])throw new Error('Crop RGB differs from source');
    histogram[channel*8+Math.floor(crop.data[i+channel]/32)]++;
   }
  }
  if(!pixels||pixels!==row.foregroundPixels)throw new Error('Foreground count changed');
  const norm=Math.hypot(...histogram);
  return {id:row.id,regionRef:row.id,cropHash,scope:'unknown' as const,
   feature:{method:'foreground-rgb-histogram-8-v0',values:histogram.map(v=>v/norm)},
   ...(names.has(row.id)?{label:names.get(row.id)!}:{})};
 });
 events.push(BeliefEventSchema.parse({kind:'observe',id:`cached-${frameId}`,provenance:'cached-model',sourceHash:input.sha256,
  groupId:`frame-${input.sha256}`,placeId:`declared-experiment-sequence-${input.sequence}`,observedAt:new Date(response.created_at*1000).toISOString(),
  timeBasis:'provider-response',observations}) as BeliefEpisode);
}
events.sort((a,b)=>a.observedAt.localeCompare(b.observedAt));
const output={schemaVersion:1,purpose:'Cached first-visit proposals only; scope unknown; declared sequence contexts are not recognized places. Histogram is an unqualified diagnostic feature.',
 networkCalls:0,events,receipts};
writeFileSync(resolve(outputArg),JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({events:events.length,observations:events.reduce((n,e)=>n+e.observations.length,0),sourceChecks:receipts.length,networkCalls:0}));
