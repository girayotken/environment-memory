import type {FastifyInstance} from 'fastify';
import {PNG} from 'pngjs';
import {z} from 'zod';
import {CaptureStore} from './capture-store.ts';
import {DetectionStore,type DetectionBundle,type DetectionAnalysis} from './detection-store.ts';
import {createDetectionProvider,type DetectionProvider,type DetectionTransport} from './scan-detector.ts';
import {scanHash,verifyScanPixels} from './scan-review.ts';
import type {ScanStore} from './scan-store.ts';
import type {CapturedFrame} from '../domain/capture-contracts.ts';
export interface DetectionOptions {testOnly?:boolean;provider?:DetectionProvider;transport?:DetectionTransport;budgetDirectory?:string}
const boundsSchema=z.strictObject({left:z.number().int().nonnegative(),top:z.number().int().nonnegative(),right:z.number().int().positive(),bottom:z.number().int().positive()});
export function registerDetectionRoutes(app:FastifyInstance,root:string,store:ScanStore,detections:DetectionStore,publish:(bundle:DetectionBundle)=>void,options:DetectionOptions={}){
 if(options.provider&&!options.testOnly)throw new Error('Injected detection provider requires explicit testOnly');
 const directStatus=()=>({enabled:true,reason:null,budget:{requests:0,requestLimit:0,capUsd:0,reservedUsd:0,estimatedUsd:0}});
 const engine=options.testOnly&&options.provider?{status:directStatus,detect:options.provider,close:()=>{}}:createDetectionProvider(options),captures=new CaptureStore(root),pending=new Map<string,Promise<DetectionAnalysis>>();
 app.addHook('onClose',async()=>{await Promise.allSettled([...pending.values()]);captures.close();engine.close();detections.close();});
 const availability=()=>engine.status();
 const complete=(frameId:string,bundle:DetectionBundle)=>{
  publish(bundle);
  const analysis:DetectionAnalysis={frameId,status:bundle.cards.length?'completed':'empty',placeId:bundle.session.placeId,candidateCount:bundle.cards.length,error:null};
  detections.save(analysis);return analysis;
 };
 // Stage-before-publish recovery only: never resume or repeat network inference.
 for(const a of detections.analyses()){
  const bundle=detections.bundle(a.frameId);
  if(bundle)complete(a.frameId,bundle);
  else if(a.status==='processing')detections.save({...a,status:'error',error:'Analysis was interrupted; provider outcome is unknown. No automatic retry.'});
 }
 const analyze=async(frame:CapturedFrame)=>{
  try{
   const bytes=captures.asset(frame.sourceHash);if(!bytes||scanHash(bytes)!==frame.sourceHash)throw new Error('Capture source is absent or changed');
   const result=await (options.provider??engine.detect)({frame,bytes});
   if(!result||result.sourceHash!==frame.sourceHash||typeof result.model!=='string'||!result.model.trim()||!Array.isArray(result.regions)||result.regions.length>24)throw new Error('Invalid source-bound detection result');
   const key=scanHash(frame.id),placeId=`capture-place-${key}`,eventId=`capture-observe-${key}`,provenance=options.testOnly?'authored-scenario' as const:'live-model' as const;
   const assets=new Map<string,Buffer>([[frame.sourceHash,bytes]]);
   const cards:DetectionBundle['cards']=[],observations:DetectionBundle['event']['observations']=[];
   for(const [i,region] of result.regions.entries()){
    const bounds=boundsSchema.parse(region.bounds);
    if(bounds.right>frame.width||bounds.bottom>frame.height||bounds.right<=bounds.left||bounds.bottom<=bounds.top)throw new Error('Invalid detection bounds');
    if(!Buffer.isBuffer(region.crop)||region.crop.length<33||region.crop.length>16*1024*1024||region.crop.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||region.crop.readUInt32BE(16)!==bounds.right-bounds.left||region.crop.readUInt32BE(20)!==bounds.bottom-bounds.top)throw new Error('Invalid detection crop size');
    const crop=PNG.sync.read(region.crop);let foregroundPixels=0;for(let p=3;p<crop.data.length;p+=4)if(crop.data[p])foregroundPixels++;
    if(!foregroundPixels)throw new Error('Empty detection mask');
    const label=region.label===null?null:z.string().trim().min(1).max(200).parse(region.label);
    const cropHash=scanHash(region.crop),regionRef=scanHash(frame.sourceHash+JSON.stringify([bounds.left,bounds.top,bounds.right,bounds.bottom])+cropHash),observationId=`detected-${key.slice(0,32)}-${i}`;
    const card={eventId,observationId,regionRef,frameId:frame.id,placeId,sourceHash:frame.sourceHash,cropHash,sourceWidth:frame.width,sourceHeight:frame.height,bounds,foregroundPixels};
    const values=verifyScanPixels(card,bytes,region.crop);
    cards.push(card);observations.push({id:observationId,regionRef,cropHash,scope:'unknown',feature:{method:'foreground-rgb-histogram-8-v0',values},...(label?{label}:{})});assets.set(cropHash,region.crop);
   }
   const bundle:DetectionBundle={session:{id:`capture-session-${key}`,placeId,provenance,createdAt:frame.capturedAt,label:`Captured frame ${frame.capturedAt.slice(0,16).replace('T',' ')} UTC${options.testOnly?' (authored test)':''}`},event:{kind:'observe',id:eventId,placeId,provenance,sourceHash:frame.sourceHash,groupId:`capture-group-${key}`,observedAt:frame.capturedAt,timeBasis:'capture',observations},cards,model:result.model,receipt:result.receipt};
   detections.stage(frame.id,bundle,assets);return complete(frame.id,bundle);
  }catch(error){const a:DetectionAnalysis={frameId:frame.id,status:'error',placeId:null,candidateCount:0,error:error instanceof Error?error.message:'Detection failed'};detections.save(a);return a;}
 };
 app.get('/api/scan/detection',async()=>({...availability(),analyses:detections.analyses()}));
 app.post<{Params:{frameId:string}}>('/api/scan/captures/:frameId/analyze',async(request,reply)=>{
  if((request.headers.origin&&request.headers.origin!==`http://${request.headers.host}`)||request.headers['sec-fetch-site']==='cross-site')return reply.code(403).send({error:'Same-origin analysis required'});
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))return reply.code(415).send({error:'JSON required'});
  if(!z.strictObject({}).safeParse(request.body).success)return reply.code(422).send({error:'Analysis accepts an empty JSON object only'});
  const frame=captures.frames().find(f=>f.id===request.params.frameId);if(!frame)return reply.code(404).send({error:'Unknown capture frame'});
  const inflight=pending.get(frame.id);if(inflight)return {analysis:await inflight};
  const old=detections.get(frame.id);if(old){const bundle=detections.bundle(frame.id);return {analysis:bundle?complete(frame.id,bundle):old};}
  const state=availability();if(!state.enabled)return reply.code(403).send({error:state.reason??'Detection is disabled'});
  if(!detections.begin(frame.id))return reply.code(409).send({error:'Analysis already exists'});
  const operation=analyze(frame);pending.set(frame.id,operation);
  try{return {analysis:await operation};}finally{pending.delete(frame.id);}
 });
}
