import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import Fastify from 'fastify';
import {registerRoomVoiceRoutes,VOICE_MAX_BYTES} from '../src/server/room-voice-routes.ts';

test('voice route only returns a transcript and rejects cross-origin and oversized audio',async()=>{
 const app=Fastify();let calls=0;
 registerRoomVoiceRoutes(app,{status:()=>({enabled:true,reason:null}),transcribe:async(bytes,type)=>{calls++;assert.equal(bytes.toString(),'audio');assert.equal(type,'audio/webm');return '  Rename this  ';}});
 const status=await app.inject({method:'GET',url:'/api/scan/room-memory/voice/status'});assert.equal(status.json().enabled,true);
 const url='/api/scan/room-memory/voice/transcribe';
 const bad=await app.inject({method:'POST',url,headers:{'content-type':'audio/webm',origin:'https://other.example'},payload:Buffer.from('audio')});assert.equal(bad.statusCode,403);
 const large=await app.inject({method:'POST',url,headers:{'content-type':'audio/webm'},payload:Buffer.alloc(VOICE_MAX_BYTES+1)});assert.equal(large.statusCode,413);
 const ok=await app.inject({method:'POST',url,headers:{'content-type':'audio/webm'},payload:Buffer.from('audio')});assert.deepEqual(ok.json(),{transcript:'Rename this'});assert.equal(calls,1);
 await app.close();
});
test('voice unavailable and failed transcription never produce a transcript',async()=>{
 const app=Fastify();registerRoomVoiceRoutes(app);const url='/api/scan/room-memory/voice/transcribe';
 assert.equal((await app.inject({method:'POST',url,headers:{'content-type':'audio/wav'},payload:Buffer.from('a')})).statusCode,503);await app.close();
 const failing=Fastify();registerRoomVoiceRoutes(failing,{status:()=>({enabled:true,reason:null}),transcribe:async()=>{throw Error('private failure');}});
 const response=await failing.inject({method:'POST',url,headers:{'content-type':'audio/wav'},payload:Buffer.from('a')});assert.equal(response.statusCode,502);assert.ok(!response.body.includes('private failure'));await failing.close();
});
test('disconnect aborts in-flight transcription',async()=>{
 const app=Fastify();let started!:()=>void,aborted!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;}),stopped=new Promise<void>(resolve=>{aborted=resolve;});
 registerRoomVoiceRoutes(app,{status:()=>({enabled:true,reason:null}),transcribe:async(_bytes,_type,signal)=>{started();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborted();resolve();},{once:true}));throw Error('cancelled');}});
 await app.listen({host:'127.0.0.1',port:0});const controller=new AbortController();
 const pending=fetch(`${app.listeningOrigin}/api/scan/room-memory/voice/transcribe`,{method:'POST',headers:{'content-type':'audio/webm'},body:Buffer.from('audio'),signal:controller.signal}).catch(()=>{});
 await ready;controller.abort();await Promise.race([stopped,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('transcription was not aborted')),2000))]);await pending;await app.close();
});
