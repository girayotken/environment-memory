import type {FastifyInstance} from 'fastify';

export const VOICE_MAX_BYTES=8*1024*1024;
export class VoiceInputError extends Error {}
export class VoiceBusyError extends Error {}
export type LocalVoiceProvider={status:()=>{enabled:boolean;reason:string|null};transcribe:(audio:Buffer,contentType:string,signal:AbortSignal)=>Promise<string>};
export function registerRoomVoiceRoutes(app:FastifyInstance,provider?:LocalVoiceProvider,allowTestAudio=false){
 const types=['audio/webm','audio/ogg','audio/mp4','audio/wav','audio/x-wav'];
 for(const type of types)app.addContentTypeParser(type,{parseAs:'buffer',bodyLimit:VOICE_MAX_BYTES},(_request,body,done)=>done(null,body));
 app.get('/api/scan/room-memory/voice/status',async(_request,reply)=>reply.header('Cache-Control','no-store').send({...provider?.status()??{enabled:false,reason:'Local transcription is not configured'},allowTestAudio}));
 app.post('/api/scan/room-memory/voice/transcribe',{bodyLimit:VOICE_MAX_BYTES},async(request,reply)=>{
  if((request.headers.origin&&request.headers.origin!==`http://${request.headers.host}`)||request.headers['sec-fetch-site']==='cross-site')return reply.code(403).send({error:'Same-origin audio required'});
  const type=(request.headers['content-type']??'').split(';')[0].trim().toLowerCase();
  if(!types.includes(type)||!Buffer.isBuffer(request.body)||!request.body.length)return reply.code(400).send({error:'A supported audio recording is required'});
  if(!provider?.status().enabled)return reply.code(503).send({error:'Local transcription is unavailable'});
  const controller=new AbortController();
  const onClose=()=>{if(!reply.raw.writableEnded)controller.abort();};reply.raw.once('close',onClose);
  try{const transcript=(await provider.transcribe(request.body,type,controller.signal)).trim();if(!transcript||transcript.length>2000)return reply.code(422).send({error:'No usable transcript was returned'});return reply.header('Cache-Control','no-store').send({transcript});}
  catch(error){if(error instanceof VoiceBusyError)return reply.code(429).send({error:'Transcription is still stopping; try again shortly'});if(error instanceof VoiceInputError)return reply.code(422).send({error:'Recording is silent, too short, or too long'});return reply.code(502).send({error:'Local transcription failed; no edit was saved'});}finally{reply.raw.removeListener('close',onClose);}
 });
}
