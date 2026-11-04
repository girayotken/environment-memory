import {observerRequestV10,decodeCompactObserverOutput} from './room-observer-wire.ts';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,lstatSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import type {RoomObserverInput,RoomObserverProvider} from '../domain/room-observer-contracts.ts';
import {roomObserverRequest,validateRoomObserverInput,parseRoomObserverOutput} from './room-observer-provider.ts';

const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const agentChoices=['Sol 6.1','Terra 6.1'] as const;
export type LocalObserverAgent=typeof agentChoices[number];
/** Explicit local relay only: no model SDK, network call, token estimate or Meta ledger. */
export function createLocalAgentRoomObserver(options:{directory:string;timeoutMs?:number;decisionLimit?:1|2;agent?:LocalObserverAgent}){
 const root=resolve(options.directory),timeoutMs=options.timeoutMs??180_000,limit=options.decisionLimit??2,agent=options.agent??'Sol 6.1';
 if(!agentChoices.includes(agent))throw new Error('Local observer agent must be Sol 6.1 or Terra 6.1.');
 const provider=`${agent} subagent`,binding=z.strictObject({requestHash:z.string().regex(/^[a-f0-9]{64}$/),responseToken:z.string().uuid(),provider:z.literal(provider),result:z.unknown()});
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>180_000||![1,2].includes(limit))throw new Error('Local observer requires a bounded timeout and at most two decisions.');
 mkdirSync(root,{recursive:true});if(lstatSync(root).isSymbolicLink())throw new Error('Local bridge directory cannot be a symlink.');
 const ledgerPath=join(root,'decisions.json');
 let ledger:z.infer<typeof ledgerSchema>=existsSync(ledgerPath)?ledgerSchema.parse(JSON.parse(readFileSync(ledgerPath,'utf8'))):[];
 let closed=false;
 function persist(){const temporary=join(root,'decisions.tmp');writeFileSync(temporary,JSON.stringify(ledger,null,2));renameSync(temporary,ledgerPath);}
 function status(){const reason=closed?'Local observer is closed.':ledger.length>=limit?`Local ${agent} decision allowance is exhausted.`:null;return {enabled:reason===null,reason};}
 const observe:RoomObserverProvider['observe']=async(input:RoomObserverInput)=>{
  const state=status();if(!state.enabled)throw new Error(state.reason!);
  validateRoomObserverInput(input);const request=observerRequestV10(input,roomObserverRequest(input,undefined,{detailGuidance:true,stateGuidance:true})),requestHash=digest(JSON.stringify(request));
  if(ledger.some(item=>item.requestHash===requestHash))throw new Error('This exact local observer request was already claimed; it cannot trigger another decision.');
  const folder=join(root,requestHash),responseToken=randomUUID(),createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+timeoutMs).toISOString();
  mkdirSync(folder);const record={requestHash,sourceHash:input.frame.sourceHash,createdAt,expiresAt,status:'waiting' as const};ledger.push(record);persist();
  try{
   writeFileSync(join(folder,'request.json'),JSON.stringify(request,null,2),{flag:'wx'});
   writeFileSync(join(folder,'schema.json'),JSON.stringify(request.text.format.schema,null,2),{flag:'wx'});
   const images:Array<{file:string;sourceHash:string;role:'current'|'historical'}>=[];let imageIndex=0;
   const prompt=[`DEVELOPER\n${request.input[0].content}\n\nWrite response.json as the complete envelope in ready.json responseContract. Copy requestHash, responseToken and provider exactly; place the raw model JSON matching schema.json in result. Do not alter or annotate the model decision.`,'USER'];
   for(const part of request.input[1].content){if(typeof part==='string')throw new Error('Invalid observer content.');if(part.type==='input_text')prompt.push(part.text);else{const file=imageIndex===0?'current.png':`reference-${imageIndex}.png`,bytes=Buffer.from(part.image_url.slice('data:image/png;base64,'.length),'base64');writeFileSync(join(folder,file),bytes,{flag:'wx'});images.push({file,sourceHash:digest(bytes),role:imageIndex===0?'current':'historical'});prompt.push(`[IMAGE: ${file}]`);imageIndex++;}}
   writeFileSync(join(folder,'prompt.txt'),prompt.join('\n\n'),{flag:'wx'});
   const ready={version:1,provider,provenance:'agent-derived',requestHash,responseToken,createdAt,expiresAt,sourceHash:input.frame.sourceHash,prompt:'prompt.txt',schema:'schema.json',exactRequest:'request.json',images,response:'response.json',responseContract:{requestHash,responseToken,provider,result:'Raw model JSON matching schema.json. Do not alter or annotate the model decision.'}};
   // Written last: readers cannot see a ready request before all exact sources exist.
   writeFileSync(join(folder,'ready.json'),JSON.stringify(ready,null,2),{flag:'wx'});
   const responsePath=join(folder,'response.json'),deadline=Date.parse(expiresAt);
   while(!closed&&Date.now()<deadline){
    if(existsSync(responsePath)){
     const info=lstatSync(responsePath);if(!info.isFile()||info.isSymbolicLink()||info.size>128_000)throw new Error('Local response must be a bounded regular JSON file.');
     const raw=readFileSync(responsePath,'utf8'),response=binding.parse(JSON.parse(raw));
     if(response.requestHash!==requestHash||response.responseToken!==responseToken)throw new Error('Local response does not bind this exact request.');
     const result=parseRoomObserverOutput(decodeCompactObserverOutput(JSON.stringify(response.result),input,true,true,true),input);
     writeFileSync(join(folder,'receipt.json'),JSON.stringify({requestHash,responseToken,provider:response.provider,provenance:'agent-derived',sourceHash:input.frame.sourceHash,receivedAt:new Date().toISOString(),rawResponseHash:digest(raw),status:'validated'},null,2),{flag:'wx'});
     ledger=ledger.map(item=>item.requestHash===requestHash?{...item,status:'validated'}:item);persist();return result;
    }
    await delay(Math.min(200,Math.max(1,deadline-Date.now())));
   }
   throw new Error(closed?'Local observer was closed.':'Local observer response timed out; no decision was published.');
  }catch(error){ledger=ledger.map(item=>item.requestHash===requestHash?{...item,status:'failed'}:item);persist();writeFileSync(join(folder,'failure.json'),JSON.stringify({requestHash,error:error instanceof Error?error.message:'Local observer failed',failedAt:new Date().toISOString()},null,2));if(error instanceof z.ZodError)throw new Error('Local observer response failed validation; inspect the saved failure record.');throw error;}
 };
 return {name:`${provider} · local file relay`,paid:false,observe,status,close:()=>{closed=true;}};
}
const ledgerSchema=z.array(z.strictObject({requestHash:z.string().regex(/^[a-f0-9]{64}$/),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.string(),expiresAt:z.string(),status:z.enum(['waiting','validated','failed'])})).max(2);
