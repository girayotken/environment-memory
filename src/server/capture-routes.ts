import type {FastifyInstance} from 'fastify';
import type {CapturedFrame,CaptureSourceKind} from '../domain/capture-contracts.ts';
import {CAPTURE_BODY_LIMIT} from '../domain/capture-contracts.ts';
import {CaptureStore,CaptureCollisionError,CaptureValidationError} from './capture-store.ts';

export function registerCaptureRoutes(app:FastifyInstance,root:string,onSaved?:(frames:CapturedFrame[])=>void,requiredSourceKind?:CaptureSourceKind){
 const store=new CaptureStore(root);
 app.addHook('onClose',async()=>store.close());
 app.get('/api/scan/captures',async()=>({frames:store.frames()}));
 app.get<{Params:{hash:string}}>('/api/scan/captures/assets/:hash',async(request,reply)=>{
  const bytes=store.asset(request.params.hash);
  if(!bytes)return reply.code(404).send({error:'Unknown capture asset'});
  return reply.type('image/png').header('Cache-Control','no-store').send(bytes);
 });
 app.post('/api/scan/captures',{bodyLimit:CAPTURE_BODY_LIMIT},async(request,reply)=>{
  const origin=request.headers.origin,host=request.headers.host;
  if((origin&&origin!==`http://${host}`)||request.headers['sec-fetch-site']==='cross-site')return reply.code(403).send({error:'Same-origin captures required'});
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))return reply.code(415).send({error:'JSON required'});
  try{if(requiredSourceKind&&(!request.body||typeof request.body!=='object'||!('frames' in request.body)||!Array.isArray(request.body.frames)||request.body.frames.some((frame:unknown)=>!frame||typeof frame!=='object'||!('sourceKind' in frame)||frame.sourceKind!==requiredSourceKind)))throw new CaptureValidationError('Required capture source kind missing or invalid');const prior=new Set(store.frames().map(f=>f.id)),frames=store.import(request.body);let automationWarning:string|undefined;try{onSaved?.(frames.filter(f=>!prior.has(f.id)));}catch{automationWarning='Frames were saved. Room observation scheduling needs recovery.';}return {frames,...(automationWarning?{automationWarning}:{})};}
  catch(error){
   if(error instanceof CaptureValidationError)return reply.code(400).send({error:error.message});
   if(error instanceof CaptureCollisionError)return reply.code(409).send({error:error.message});
   throw error;
  }
 });
}
