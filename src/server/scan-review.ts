/** Isolated review and capture server. No observer or evaluator routes. */
import Fastify from 'fastify';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,existsSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {PNG} from 'pngjs';
import {describeScanAppearance,type ScanAppearanceDescriptor} from '../domain/scan-appearance.ts';
import {z} from 'zod';
import {DetectionStore,type DetectionBundle} from './detection-store.ts';
import {registerDetectionRoutes,type DetectionOptions} from './detection-routes.ts';
import {CaptureStore} from './capture-store.ts';
import {ScanStore} from './scan-store.ts';
import {registerIdentityRoutes,type IdentitySource,type IdentityRankingOptions} from './scan-identity-routes.ts';
import {registerCaptureRoutes} from './capture-routes.ts';
import {createRoomObserverProvider} from './room-observer-provider.ts';
import type {RoomAutomationOptions} from './room-memory-automation.ts';
import {registerRoomMemoryRoutes} from './room-memory-routes.ts';
import {registerRoomVoiceRoutes,type LocalVoiceProvider} from './room-voice-routes.ts';
import {registerScanAgent,type ScanAgentOptions} from './scan-agent.ts';
import type {BeliefEpisode,BeliefObservation} from '../domain/belief-contracts.ts';
import {ScanCommandSchema} from '../domain/scan-contracts.ts';
import type {ScanReviewView,ScanReviewCard} from '../domain/scan-review-contracts.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(200);
export const ScanReviewManifestSchema=z.strictObject({
 schemaVersion:z.literal(1),purpose:z.string(),networkCalls:z.literal(0),inputHash:hash,
 cards:z.array(z.strictObject({eventId:id,observationId:id,regionRef:hash,frameId:id,placeId:id,
  sourceHash:hash,cropHash:hash,sourceWidth:z.number().int().positive(),sourceHeight:z.number().int().positive(),
  bounds:z.strictObject({left:z.number().int().nonnegative(),top:z.number().int().nonnegative(),right:z.number().int().positive(),bottom:z.number().int().positive()}),
  foregroundPixels:z.number().int().positive(),
 })),
});
export type ScanReviewManifest=z.infer<typeof ScanReviewManifestSchema>;
export const scanHash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export function safeScanFile(root:string,path:string):string {
 const base=realpathSync(root),target=realpathSync(resolve(base,path)),rel=relative(base,target);
 if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw new Error('Asset path escaped workspace');
 return target;
}
export function verifyScanPixels(card:ScanReviewManifest['cards'][number],sourceBytes:Buffer,cropBytes:Buffer):number[]{
 if(scanHash(sourceBytes)!==card.sourceHash||scanHash(cropBytes)!==card.cropHash)throw new Error('Asset hash changed');
 const source=PNG.sync.read(sourceBytes),crop=PNG.sync.read(cropBytes),b=card.bounds;
 if(source.width!==card.sourceWidth||source.height!==card.sourceHeight||b.right>source.width||b.bottom>source.height||b.right<=b.left||b.bottom<=b.top||crop.width!==b.right-b.left||crop.height!==b.bottom-b.top)throw new Error('Invalid crop bounds or dimensions');
 if(scanHash(card.sourceHash+JSON.stringify([b.left,b.top,b.right,b.bottom])+card.cropHash)!==card.regionRef)throw new Error('Crop region identity mismatch');
 const hist=Array<number>(24).fill(0);let pixels=0;
 for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++){
  const i=(y*crop.width+x)*4,alpha=crop.data[i+3];if(alpha===0)continue;
  if(alpha!==255)throw new Error('Nonbinary crop alpha');pixels++;
  const si=((b.top+y)*source.width+b.left+x)*4;
  for(let c=0;c<3;c++){if(crop.data[i+c]!==source.data[si+c])throw new Error('Crop pixels differ from source');hist[c*8+Math.floor(crop.data[i+c]/32)]++;}
 }
 if(pixels!==card.foregroundPixels)throw new Error('Foreground count changed');
 const norm=Math.hypot(...hist);return hist.map(v=>v/norm);
}
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export function createScanReviewApp(directory:string,options:{port?:number;agent?:ScanAgentOptions;detection?:DetectionOptions;identityRanking?:IdentityRankingOptions;roomObserver?:RoomAutomationOptions;voice?:LocalVoiceProvider;allowTestAudio?:boolean;captureSourceKind?:'device-camera'|'virtual-camera'}={}){
 const root=resolve(directory);
 if(!existsSync(join(root,'scan-workspace.sqlite')))throw new Error('Missing prepared scan workspace');
 const manifest=ScanReviewManifestSchema.parse(JSON.parse(readFileSync(safeScanFile(root,'scan-review-manifest.json'),'utf8')));
 const store=new ScanStore(root),allowlist=new Set<string>(),bindings=new Map<string,ScanReviewManifest['cards'][number]>();
 try{
  const observations=new Map<string,{event:BeliefEpisode;observation:BeliefObservation}>();
  for(const placeId of new Set(store.sessions().map(s=>s.placeId)))for(const row of store.events(placeId)){
   if(row.kind!=='evidence'||row.event.kind!=='observe')continue;
   if(row.event.provenance!=='cached-model')continue;
   for(const observation of row.event.observations)observations.set(`${encodeURIComponent(row.event.id)}/${encodeURIComponent(observation.id)}`,{event:row.event,observation});
  }
  for(const card of manifest.cards){
   const key=`${encodeURIComponent(card.eventId)}/${encodeURIComponent(card.observationId)}`,saved=observations.get(key);
   if(bindings.has(key)||!saved||saved.event.placeId!==card.placeId||saved.event.id!==`cached-${card.frameId}`||saved.event.sourceHash!==card.sourceHash||saved.observation.cropHash!==card.cropHash||saved.observation.regionRef!==card.regionRef)throw new Error('Manifest does not bind saved observation');
   const feature=verifyScanPixels(card,readFileSync(safeScanFile(root,`assets/${card.sourceHash}.png`)),readFileSync(safeScanFile(root,`assets/${card.cropHash}.png`)));
   if(saved.observation.feature.method!=='foreground-rgb-histogram-8-v0'||canonical(feature)!==canonical(saved.observation.feature.values))throw new Error('Observation descriptor differs from saved pixels');
   bindings.set(key,card);allowlist.add(card.sourceHash);allowlist.add(card.cropHash);
  }
  if(bindings.size!==observations.size)throw new Error('Manifest must bind every saved observation');
 }catch(error){store.close();throw error;}
 const detections=new DetectionStore(root);
 const publish=(bundle:DetectionBundle)=>{
  const captures=new CaptureStore(root);
  try{
   const frame=captures.frames().find(f=>bundle.cards.length?f.id===bundle.cards[0].frameId:`capture-place-${scanHash(f.id)}`===bundle.session.placeId);
   if(!frame||bundle.session.placeId!==`capture-place-${scanHash(frame.id)}`||bundle.event.sourceHash!==frame.sourceHash||bundle.event.observedAt!==frame.capturedAt||bundle.event.timeBasis!=='capture'||bundle.event.provenance==='cached-model'||bundle.session.provenance!==bundle.event.provenance||bundle.cards.length!==bundle.event.observations.length)throw new Error('Invalid dynamic detection origin');
   for(const [index,card] of bundle.cards.entries()){
    const observation=bundle.event.observations[index];
    if(card.eventId!==bundle.event.id||card.observationId!==observation.id||card.placeId!==bundle.session.placeId||card.sourceHash!==frame.sourceHash||card.frameId!==frame.id||card.sourceWidth!==frame.width||card.sourceHeight!==frame.height||card.cropHash!==observation.cropHash||card.regionRef!==observation.regionRef||observation.scope!=='unknown')throw new Error('Invalid dynamic observation binding');
    const source=detections.asset(card.sourceHash),crop=detections.asset(card.cropHash);
    if(!source||!crop)throw new Error('Missing dynamic detection pixels');
    const values=verifyScanPixels(card,source,crop);
    if(observation.feature.method!=='foreground-rgb-histogram-8-v0'||canonical(values)!==canonical(observation.feature.values))throw new Error('Dynamic descriptor differs from pixels');
   }
   store.importDetection(bundle.session,bundle.event);
   for(const card of bundle.cards){bindings.set(`${encodeURIComponent(card.eventId)}/${encodeURIComponent(card.observationId)}`,card);allowlist.add(card.sourceHash);allowlist.add(card.cropHash);}
  }finally{captures.close();}
 };
 const app=Fastify({bodyLimit:64*1024});
 registerRoomVoiceRoutes(app,options.voice,options.allowTestAudio);
 app.addHook('onClose',async()=>{store.close();});
 try{
  registerDetectionRoutes(app,root,store,detections,publish,options.detection);
  for(const placeId of new Set(store.sessions().map(s=>s.placeId)))for(const row of store.events(placeId)){
   if(row.kind==='evidence'&&row.event.kind==='observe'&&row.event.provenance!=='cached-model'){
    const bundle=detections.analyses().map(a=>detections.bundle(a.frameId)).find(b=>b?.event.id===row.event.id);
    if(!bundle||canonical(bundle.event)!==canonical(row.event))throw new Error('Unbound dynamic observation origin');
   }
  }
 }catch(error){store.close();detections.close();throw error;}

 // Derived, bounded process-local cache. Immutable source/crop content is
 // rehashed before every lookup; no personal claims or identity decisions enter.
 const appearanceCache=new Map<string,ScanAppearanceDescriptor|null>();
 const known=(placeId:string)=>store.sessions(placeId).length>0;
 const view=(placeId:string,revision?:number):ScanReviewView=>{
  const base=store.view(placeId,revision);
  const cards:ScanReviewCard[]=base.belief.entities.map(entity=>{
   const anchor=entity.history[0],binding=bindings.get(anchor.observationId);
   if(!binding||entity.anchorObservation!==anchor.observationId)throw new Error('Missing candidate anchor binding');
   return {candidateId:entity.id,observationRef:entity.anchorObservation,regionRef:anchor.regionRef,cropUrl:`/api/scan/assets/${anchor.cropHash}`,sourceUrl:`/api/scan/assets/${anchor.sourceHash}`,sourceHash:anchor.sourceHash,cropHash:anchor.cropHash,observedAt:anchor.observedAt,timeBasis:anchor.timeBasis,scope:entity.scope,modelLabel:anchor.label,bounds:binding.bounds,sourceWidth:binding.sourceWidth,sourceHeight:binding.sourceHeight};
  });
  return {...base,latestRevision:store.latestRevision(placeId),cards};
 };
 app.get('/api/scan/places',async()=>({places:[...new Set(store.sessions().map(s=>s.placeId))].map((id,index)=>({id,label:store.sessions(id)[0].provenance==='cached-model'?`Example area ${index+1}`:store.sessions(id)[0].label,candidateCount:store.view(id).belief.entities.length,sessionCount:store.sessions(id).length}))}));
 app.get('/api/scan/view',async(request,reply)=>{
  const parsed=z.strictObject({placeId:id,revision:z.string().regex(/^\d+$/).optional()}).safeParse(request.query);
  if(!parsed.success)return reply.code(400).send({error:'Invalid place or revision'});
  if(!known(parsed.data.placeId))return reply.code(404).send({error:'Unknown place'});
  const revision=parsed.data.revision===undefined?undefined:Number(parsed.data.revision);
  if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision>store.latestRevision(parsed.data.placeId)))return reply.code(400).send({error:'Invalid revision'});
  return view(parsed.data.placeId,revision);
 });
 app.get<{Params:{hash:string}}>('/api/scan/assets/:hash',async(request,reply)=>{
  const key=request.params.hash;if(!allowlist.has(key))return reply.code(404).send({error:'Unknown asset'});
  const bytes=detections.asset(key)??readFileSync(safeScanFile(root,`assets/${key}.png`));
  if(scanHash(bytes)!==key)return reply.code(409).send({error:'Asset hash changed'});
  return reply.type('image/png').header('Cache-Control','no-store').send(bytes);
 });
 app.post('/api/scan/commands',async(request,reply)=>{
  const origin=request.headers.origin,host=request.headers.host;
  if((origin&&origin!==`http://${host}`)||request.headers['sec-fetch-site']==='cross-site')return reply.code(403).send({error:'Same-origin commands required'});
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))return reply.code(415).send({error:'JSON required'});
  const parsed=z.strictObject({expectedRevision:z.number().int().nonnegative(),command:ScanCommandSchema}).safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:'Invalid command envelope'});
  const {command,expectedRevision}=parsed.data;
  if(!known(command.placeId))return reply.code(404).send({error:'Unknown place'});
  const prior=store.events(command.placeId).find(row=>row.event.id===command.id);
  if(prior){if(prior.kind!=='command'||canonical(prior.event)!==canonical(command))return reply.code(409).send({error:'Immutable command ID collision'});return view(command.placeId);}
  if(expectedRevision!==store.latestRevision(command.placeId))return reply.code(409).send({error:'Stale revision',latestRevision:store.latestRevision(command.placeId)});
  try{store.appendCommand(command);return view(command.placeId);}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'Invalid command'});}
 });
 registerIdentityRoutes(app,root,()=>{
  const placeIds=[...new Set(store.sessions().map(s=>s.placeId))],sources:IdentitySource[]=[];
  for(const [index,placeId] of placeIds.entries()){
   const current=view(placeId),session=current.sessions[0];
   const placeLabel=session.provenance==='cached-model'?`Example area ${index+1}`:session.label;
   for(const card of current.cards){
    // An on-disk withdrawal or changed asset invalidates an endpoint immediately.
    let appearance:ScanAppearanceDescriptor|null=null;
    try{
     let cropBytes:Buffer|undefined;
     for(const assetHash of [card.sourceHash,card.cropHash]){
      const bytes=detections.asset(assetHash)??readFileSync(safeScanFile(root,`assets/${assetHash}.png`));
      if(scanHash(bytes)!==assetHash)throw new Error('Changed identity asset');
      if(assetHash===card.cropHash)cropBytes=bytes;
     }
     const cacheKey=JSON.stringify([card.sourceHash,card.cropHash,card.regionRef]);
     if(!appearanceCache.has(cacheKey)){
      // The manifest/detection import already verified mask pixels against this
      // exact source. Matching hashes preserve that binding on cache misses.
      appearanceCache.set(cacheKey,describeScanAppearance(PNG.sync.read(cropBytes!)));
      if(appearanceCache.size>128)appearanceCache.delete(appearanceCache.keys().next().value!);
     }
     appearance=appearanceCache.get(cacheKey)??null;
    }catch{continue;}
    const claim=current.claims.objects.find(o=>o.candidateId===card.candidateId)!;
    const entity=current.belief.entities.find(e=>e.id===card.candidateId)!;
    sources.push({anchor:{placeId,candidateId:card.candidateId,observationRef:card.observationRef,regionRef:card.regionRef,sourceHash:card.sourceHash},
     card,placeLabel,label:claim.userLabel??card.modelLabel,tags:claim.tags,claim,provenance:session.provenance,feature:entity.prototype,appearance});
   }
  }
  return {sources,workspaceRevision:store.latestRevision(),placeIds};
 },options.identityRanking);
 if(options.roomObserver?.provider&&!options.roomObserver.testOnly&&!options.roomObserver.localAgent&&!(options.roomObserver.provider.paid&&options.roomObserver.allowPaid))throw new Error('Injected room observers require explicit testOnly:true or localAgent:true');
 const roomAutomation=registerRoomMemoryRoutes(app,root,options.roomObserver??{provider:createRoomObserverProvider(),allowPaid:process.env.ENABLE_ROOM_OBSERVER==='true'});
 registerCaptureRoutes(app,root,frames=>roomAutomation.enqueueFrames(frames),options.captureSourceKind);
 registerScanAgent(app,root,store,view,options.agent);
 return app;
}
