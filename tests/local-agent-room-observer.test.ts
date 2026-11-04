import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import type {RoomObserverInput} from '../src/domain/room-observer-contracts.ts';
import {createLocalAgentRoomObserver} from '../src/server/local-agent-room-observer.ts';
import {roomObserverRequest} from '../src/server/room-observer-provider.ts';
import {compactObserverRequest,observerRequestV8,observerRequestV9,observerRequestV10} from '../src/server/room-observer-wire.ts';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fixture():RoomObserverInput{
 const image=(colour:number)=>{const png=new PNG({width:2,height:2});png.data.fill(colour);return PNG.sync.write(png);},bytes=image(90),prior=image(130);
 const source={viewId:'old',frameId:'old-frame',sourceHash:hash(prior),capturedAt:'2026-10-28T12:00:00Z',imageUrl:'/not-exposed'};
 return {frame:{id:'current',sessionId:'session',capturedAt:'2026-10-29T12:00:00Z',sourceHash:hash(bytes),width:2,height:2,imageUrl:'/not-exposed',analysisStatus:'not-analyzed'},frameBytes:bytes,references:[{source,bytes:prior}],room:{roomId:'room',label:'Room',provenance:'agent-derived',graph:{scope:'Partial room',sourceViews:[source],nodes:[{id:'bench',label:'Bench',kind:'support',status:'provisional',attributes:[],evidence:[{viewId:'old',basis:'Visible bench'}]}],edges:[],identityGroups:[],unknowns:[],nodeOrigins:{},reviewNotes:[]},visits:[]}};
}
const result=()=>{
 const priorSourceHash=fixture().references[0].source.sourceHash;
 return {protocolVersion:2,summary:'Synthetic relay test only',observations:[{nodeId:'bench',label:'Bench',kind:'support',attributes:[],status:'likely-same',basis:'Synthetic appearance',alternatives:'Identity unknown',location:null,semanticUnknown:null,needs:'none',request:null,viewDeferral:null,
  currentAppearance:{description:'Synthetic current bench',features:[{feature:'outline',description:'Synthetic rectangular outline',visible:true},{feature:'frame',description:'Synthetic open frame',visible:true}]},
  comparison:{priorSourceHashes:[priorSourceHash],adequateDiscriminatingEvidence:true,limitation:'none',features:[{feature:'outline',kind:'silhouette',result:'same',currentBasis:'Synthetic current outline',historicalBasis:'Synthetic prior outline',priorSourceHash},{feature:'frame',kind:'construction',result:'same',currentBasis:'Synthetic current frame',historicalBasis:'Synthetic prior frame',priorSourceHash}]},
 }],actionAssessments:null};
};
function packet(root:string,input:RoomObserverInput){const requestHash=hash(JSON.stringify(observerRequestV10(input,roomObserverRequest(input,undefined,{detailGuidance:true,stateGuidance:true})))),folder=join(root,requestHash),ready=JSON.parse(readFileSync(join(folder,'ready.json'),'utf8'));return {folder,ready};}
function respond(folder:string,ready:Record<string,unknown>,value:any=result(),provider='Sol 6.1 subagent'){const request=JSON.parse(readFileSync(join(folder,'request.json'),'utf8'));const packet=JSON.parse(request.input[1].content[0].text);const source=JSON.parse(request.input[1].content[3].text).source.sourceHash;value=structuredClone(value);value.protocolVersion=3;value.support=[];value.containment=[];value.outsideContainment=[];for(const o of value.observations){if(o.nodeId==='bench')o.nodeId=packet.memory.nodes[0].id;const a=o.currentAppearance;o.appearanceDescription=a.description;o.features=a.features.map((f:any)=>{const comparisons=o.comparison.features.filter((x:any)=>x.feature===f.feature).map((c:any)=>{const {feature,...rest}=c;return {...rest,identityRelevance:'unassessed',priorSourceHash:source};});return {...f,comparisons};});delete o.currentAppearance;delete o.comparison.features;o.comparison.priorSourceHashes=[source];}writeFileSync(join(folder,'response.json'),JSON.stringify({requestHash:ready.requestHash,responseToken:ready.responseToken,provider,result:value}));}

test('local relay exports the identical bounded request and PNGs, retains raw output and consumes durable allowance',async()=>{
 const root=mkdtempSync(join(tmpdir(),'local-room-')),input=fixture(),observer=createLocalAgentRoomObserver({directory:root,decisionLimit:1,timeoutMs:2000});
 try{
  Object.assign(input.room.graph,{evaluationTruth:'NOT-TO-OBSERVER'});const pending=observer.observe(input),{folder,ready}=packet(root,input);
  assert.deepEqual(JSON.parse(readFileSync(join(folder,'request.json'),'utf8')),observerRequestV10(input,roomObserverRequest(input,undefined,{detailGuidance:true,stateGuidance:true})));
  assert.deepEqual(readFileSync(join(folder,'current.png')),input.frameBytes);assert.deepEqual(readFileSync(join(folder,'reference-1.png')),input.references[0].bytes);
  const prompt=readFileSync(join(folder,'prompt.txt'),'utf8');assert.ok(!prompt.includes('NOT-TO-OBSERVER'));assert.ok(prompt.includes('[IMAGE: current.png]'));assert.ok(prompt.includes('component proportions, relative part sizes, arrangement and construction'));assert.ok(prompt.includes('retain the ordinary likely-same working judgment'));assert.ok(prompt.includes('State agreement alone cannot justify likely-same'));  assert.match(prompt,/complete envelope in ready\.json responseContract/);assert.match(prompt,/Copy requestHash, responseToken and provider exactly/);assert.ok(prompt.includes('historical_reference_data'));assert.ok(!prompt.includes('/not-exposed'));
  assert.equal(ready.provider,'Sol 6.1 subagent');assert.equal(ready.responseContract.provider,'Sol 6.1 subagent');assert.equal(observer.name,'Sol 6.1 subagent · local file relay');
  respond(folder,ready);const output=await pending as {observations:object[]};assert.equal('viewDeferral' in output.observations[0],false);
  assert.equal(JSON.parse(readFileSync(join(folder,'response.json'),'utf8')).result.observations[0].viewDeferral,null,'raw model JSON is unchanged');assert.equal(JSON.parse(readFileSync(join(folder,'receipt.json'),'utf8')).provenance,'agent-derived');
  assert.equal(observer.status().enabled,false);observer.close();const reopened=createLocalAgentRoomObserver({directory:root,decisionLimit:1});assert.equal(reopened.status().enabled,false);await assert.rejects(reopened.observe(input),/allowance/);reopened.close();
 }finally{observer.close();rmSync(root,{recursive:true,force:true});}
});

for(const invalid of ['binding','unknown-node','symlink'] as const)test(`local relay rejects ${invalid} through binding and common policy validation`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'local-room-')),input=fixture(),observer=createLocalAgentRoomObserver({directory:root,timeoutMs:2000});
 try{const pending=observer.observe(input),rejection=assert.rejects(pending),{folder,ready}=packet(root,input);const value=result();
  if(invalid==='binding')respond(folder,{...ready,requestHash:'0'.repeat(64)},value);
  else if(invalid==='unknown-node'){value.observations[0].nodeId='invented';respond(folder,ready,value);}
  else{const outside=join(root,'outside.json');writeFileSync(outside,'{}');symlinkSync(outside,join(folder,'response.json'));}
  await rejection;assert.equal(JSON.parse(readFileSync(join(root,'decisions.json'),'utf8'))[0].status,'failed');
 }finally{observer.close();rmSync(root,{recursive:true,force:true});}
});

test('local relay times out without publication, bounds configuration and refuses a repeated request',async()=>{
 const root=mkdtempSync(join(tmpdir(),'local-room-')),observer=createLocalAgentRoomObserver({directory:root,timeoutMs:10});
 try{await assert.rejects(observer.observe(fixture()),/timed out/);await assert.rejects(observer.observe(fixture()),/already claimed/);assert.throws(()=>createLocalAgentRoomObserver({directory:root,timeoutMs:180001}),/bounded/);}finally{observer.close();rmSync(root,{recursive:true,force:true});}
});

for(const matching of [true,false])test(`Terra relay ${matching?'accepts Terra':'rejects Sol'} provenance`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'local-room-')),input=fixture(),observer=createLocalAgentRoomObserver({directory:root,agent:'Terra 6.1',decisionLimit:1,timeoutMs:2000});
 try{const pending=observer.observe(input),{folder,ready}=packet(root,input);assert.equal(ready.provider,'Terra 6.1 subagent');assert.equal(ready.responseContract.provider,ready.provider);assert.equal(observer.name,'Terra 6.1 subagent · local file relay');
  const checked=matching?pending:assert.rejects(pending);respond(folder,ready,result(),matching?'Terra 6.1 subagent':'Sol 6.1 subagent');await checked;
  assert.equal(JSON.parse(readFileSync(join(root,'decisions.json'),'utf8'))[0].status,matching?'validated':'failed');
  if(matching)assert.equal(JSON.parse(readFileSync(join(folder,'receipt.json'),'utf8')).provider,'Terra 6.1 subagent');
 }finally{observer.close();rmSync(root,{recursive:true,force:true});}
});


test('missing response envelope reports a short validation error while retaining detail locally',async()=>{
 const root=mkdtempSync(join(tmpdir(),'room-relay-invalid-')),observer=createLocalAgentRoomObserver({directory:root,timeoutMs:1000}),input=fixture();
 try{const pending=observer.observe(input),{folder}=packet(root,input);writeFileSync(join(folder,'response.json'),JSON.stringify(result()));await assert.rejects(pending,error=>error instanceof Error&&error.message==='Local observer response failed validation; inspect the saved failure record.');const failure=JSON.parse(readFileSync(join(folder,'failure.json'),'utf8'));assert.match(failure.error,/requestHash/);assert.equal(JSON.parse(readFileSync(join(folder,'response.json'),'utf8')).summary,result().summary);}
 finally{observer.close();rmSync(root,{recursive:true,force:true});}
});

test('wire v8 supplies only attached candidate-bound historical appearance without changing v7',()=>{
 const input=fixture(),source=input.references[0].source;
 input.room.visits=[{schemaVersion:1,importId:'i',roomId:'room',visitId:'v',label:'visit',summary:'saved',provenance:'agent-derived',sourceViews:[source],proposals:[{id:'p',nodeId:'bench',status:'likely-same',observationId:null,basis:'visible',alternatives:'uncertain',evidence:[{viewId:source.viewId,basis:'visible'}],currentAppearance:{description:'Open rectangular container with a hinged lid',features:[{feature:'lid',description:'Raised lid',visible:true}]}}]}];
 const old=compactObserverRequest(roomObserverRequest(input,undefined,{detailGuidance:true,stateGuidance:true}),input,true,true);
 const request=observerRequestV8(input,roomObserverRequest(input,undefined,{detailGuidance:true,stateGuidance:true}));
 const memory=JSON.parse((request.input[1].content[0] as {text:string}).text).memory;
 assert.equal(memory.nodes[0].attachedAppearanceHistory[0].description,'Open rectangular container with a hinged lid');
 assert.equal(memory.nodes[0].attachedAppearanceHistory[0].sourceHash,memory.nodes[0].allowedComparisonSourceHashes[0]);
 assert.equal(memory.nodes[0].attachedAppearanceHistory[0].status,'likely-same');
 const proposal=input.room.visits[0].proposals[0];proposal.status='different';
 const rejected=observerRequestV8(input,roomObserverRequest(input,undefined,{detailGuidance:true,stateGuidance:true}));
 assert.equal(JSON.parse((rejected.input[1].content[0] as {text:string}).text).memory.nodes[0].attachedAppearanceHistory,undefined);proposal.status='likely-same';
 const originalTime=source.capturedAt;source.capturedAt=input.frame.capturedAt;
 const future=observerRequestV8(input,roomObserverRequest(input,undefined,{detailGuidance:true,stateGuidance:true}));
 assert.equal(JSON.parse((future.input[1].content[0] as {text:string}).text).memory.nodes[0].attachedAppearanceHistory,undefined);source.capturedAt=originalTime;
 assert.ok(String(request.input[0].content).includes('similar distinct objects'));
 assert.ok(!JSON.stringify(old).includes('attachedAppearanceHistory'));
 input.references=[];
 const noReference=observerRequestV8(input,roomObserverRequest(input,undefined,{detailGuidance:true,stateGuidance:true}));
 assert.equal(JSON.parse((noReference.input[1].content[0] as {text:string}).text).memory.nodes[0].attachedAppearanceHistory,undefined);
});

test('wire v9 keeps all candidates, references and allowed hashes while retaining only the newest appearance',()=>{
 const input=fixture(),first=input.references[0].source;
 const second={...first,viewId:'newer',frameId:'newer-frame',sourceHash:'b'.repeat(64),capturedAt:'2026-10-28T18:00:00Z'};
 input.references.push({source:second,bytes:Buffer.alloc(0)});input.room.graph.sourceViews.push(second);
 input.room.visits=[first,second].map((source,index)=>({schemaVersion:1,importId:`i${index}`,roomId:'room',visitId:`v${index}`,label:'visit',summary:'saved',provenance:'agent-derived',sourceViews:[source],proposals:[{id:`p${index}`,nodeId:'bench',status:'likely-same',observationId:null,basis:'visible',alternatives:'uncertain',evidence:[{viewId:source.viewId,basis:'visible'}],currentAppearance:{description:index?'newer appearance':'older appearance',features:[{feature:'outline',description:'visible',visible:true}]}}]}));
 const base=roomObserverRequest(input,undefined,{detailGuidance:true,stateGuidance:true}),v8=observerRequestV8(input,base),v9=observerRequestV9(input,base);
 const memory=(request:typeof v8)=>JSON.parse((request.input[1].content[0] as {text:string}).text).memory;
 assert.equal(memory(v8).nodes[0].attachedAppearanceHistory.length,2);
 assert.deepEqual(memory(v9).nodes[0].attachedAppearanceHistory,[memory(v8).nodes[0].attachedAppearanceHistory[0]]);
 assert.equal(memory(v9).nodes[0].attachedAppearanceHistory[0].description,'newer appearance');
 assert.deepEqual(memory(v9).nodes[0].allowedComparisonSourceHashes,memory(v8).nodes[0].allowedComparisonSourceHashes);
 assert.deepEqual(v9.input[1].content.slice(1),v8.input[1].content.slice(1));
 assert.equal(memory(v9).nodes.length,memory(v8).nodes.length);
 assert.ok(JSON.stringify(v9).length<JSON.stringify(v8).length);
});
