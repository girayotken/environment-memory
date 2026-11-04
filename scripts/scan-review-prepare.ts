/** Offline preparation: only verified saved source/crop pixels enter a fresh workspace. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {BeliefEventSchema,type BeliefEpisode} from '../src/domain/belief-contracts.ts';
import {replayBeliefs} from '../src/domain/belief-memory.ts';
import {ScanStore} from '../src/server/scan-store.ts';
import {ScanReviewManifestSchema,scanHash,safeScanFile,verifyScanPixels,type ScanReviewManifest} from '../src/server/scan-review.ts';
import {validateNames} from './qualification-requests.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const inputSchema=z.strictObject({schemaVersion:z.literal(1),purpose:z.string(),networkCalls:z.literal(0),events:z.array(BeliefEventSchema).min(1),receipts:z.array(z.strictObject({path:z.string(),sha256:hash})).optional()});
const regionSchema=z.strictObject({id:hash,frame:z.string(),sourceSha256:hash,bounds:z.strictObject({left:z.number().int().nonnegative(),top:z.number().int().nonnegative(),right:z.number().int().positive(),bottom:z.number().int().positive()}),foregroundPixels:z.number().int().positive(),concept:z.string(),method:z.literal('automatic-sam-proposal')});
export function prepareScanReview(inputArg:string,packetArg:string,trialArg:string,outputArg:string){
 const input=resolve(inputArg),packet=resolve(packetArg),trial=resolve(trialArg),output=resolve(outputArg);
 if(existsSync(output))throw new Error('Output directory already exists; choose a new workspace');
 const inputBytes=readFileSync(input),parsed=inputSchema.parse(JSON.parse(inputBytes.toString('utf8')));
 if(parsed.events.some(e=>e.kind!=='observe'||e.provenance!=='cached-model'))throw new Error('Only cached observation events accepted');
 const events=parsed.events as BeliefEpisode[];replayBeliefs(events);
 const frames=z.object({frames:z.array(z.object({id:z.string(),image:z.string(),sha256:hash,width:z.number().int().positive(),height:z.number().int().positive(),sequence:z.string(),split:z.string()}))}).parse(JSON.parse(readFileSync(safeScanFile(join(packet,'predictor'),'inputs.json'),'utf8'))).frames;
 const ledger=z.array(z.object({key:z.string(),status:z.string()})).parse(JSON.parse(readFileSync(safeScanFile(trial,'ledger.json'),'utf8')));
 const assets=new Map<string,Buffer>(),cards:ScanReviewManifest['cards']=[];
 for(const event of events){
  const frame=frames.find(f=>event.id===`cached-${f.id}`);
  if(!frame||frame.split!=='development'||frame.sha256!==event.sourceHash||event.placeId!==`declared-experiment-sequence-${frame.sequence}`||event.groupId!==`frame-${frame.sha256}`)throw new Error('Observation frame/source/place mismatch');
  const call=ledger.findIndex(row=>row.key===frame.sha256+':discover'&&row.status==='completed');
  if(call<0)throw new Error('Missing completed discovery');
  const response=z.object({created_at:z.number().finite()}).parse(JSON.parse(readFileSync(safeScanFile(trial,`call-${call+1}/response.json`),'utf8')));
  if(event.timeBasis!=='provider-response'||event.observedAt!==new Date(response.created_at*1000).toISOString())throw new Error('Provider observation time mismatch');
  const source=readFileSync(safeScanFile(join(packet,'predictor'),frame.image));
  const resultPath=join(trial,`${frame.id}-result.json`),names=new Map<string,string>();
  if(existsSync(resultPath)){
   const result=JSON.parse(readFileSync(safeScanFile(trial,`${frame.id}-result.json`),'utf8'));
   if(result.frame!==frame.id)throw new Error('Wrong naming frame');
   for(const row of validateNames(result.names,event.observations.map(o=>o.regionRef)).regions)names.set(row.regionId,row.label);
  }
  for(const observation of event.observations){
   if(!hash.safeParse(observation.regionRef).success)throw new Error('Invalid region reference');
   const region=regionSchema.parse(JSON.parse(readFileSync(safeScanFile(trial,`${observation.regionRef}.json`),'utf8')));
   if(region.id!==observation.id||region.id!==observation.regionRef||region.frame!==frame.id||region.sourceSha256!==event.sourceHash||observation.scope!=='unknown'||observation.location!==undefined||observation.label!==names.get(region.id))throw new Error('Observation region or naming mismatch');
   const crop=readFileSync(safeScanFile(trial,`${region.id}.png`));
   const card={eventId:event.id,observationId:observation.id,regionRef:region.id,frameId:frame.id,placeId:event.placeId,sourceHash:event.sourceHash,cropHash:observation.cropHash,sourceWidth:frame.width,sourceHeight:frame.height,bounds:region.bounds,foregroundPixels:region.foregroundPixels};
   const feature=verifyScanPixels(card,source,crop);
   if(observation.feature.method!=='foreground-rgb-histogram-8-v0'||JSON.stringify(feature)!==JSON.stringify(observation.feature.values))throw new Error('Observation feature mismatch');
   cards.push(card);assets.set(card.sourceHash,source);assets.set(card.cropHash,crop);
  }
 }
 const manifest=ScanReviewManifestSchema.parse({schemaVersion:1,purpose:'Isolated review of cached first-visit provisional regions; no multi-view recognition or evaluator truth.',networkCalls:0,inputHash:scanHash(inputBytes),cards});
 mkdirSync(output,{recursive:false});let store:ScanStore|undefined;
 try{
  mkdirSync(join(output,'assets'));
  for(const [sha,bytes] of assets)writeFileSync(join(output,'assets',`${sha}.png`),bytes,{flag:'wx',mode:0o600});
  store=new ScanStore(output);
  events.forEach((event,index)=>{const id=`scan-review-session-${index+1}-${event.sourceHash}`;store!.createSession({id,placeId:event.placeId,provenance:'cached-model',createdAt:event.observedAt,label:`Cached first visit ${index+1}`});store!.appendEvidence(id,event);});
  writeFileSync(join(output,'scan-review-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 }catch(error){store?.close();store=undefined;rmSync(output,{recursive:true,force:true});throw error;}finally{store?.close();}
 return {output,episodes:events.length,cards:cards.length,assets:assets.size,networkCalls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);if(args.length!==4)throw new Error('Usage: scan-review-prepare.ts INPUT_JSON PACKET_DIR TRIAL_DIR NEW_DIR');
 console.log(JSON.stringify(prepareScanReview(args[0],args[1],args[2],args[3])));
}
