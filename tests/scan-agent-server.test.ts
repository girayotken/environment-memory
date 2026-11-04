import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {DatabaseSync} from 'node:sqlite';
import {ScanStore} from '../src/server/scan-store.ts';
import {createScanReviewApp,type ScanReviewManifest} from '../src/server/scan-review.ts';
import type {ScanReviewView} from '../src/domain/scan-review-contracts.ts';
import type {ScanCommand} from '../src/domain/scan-contracts.ts';
import type {ScanAgentTransport,ScanAgentResponse} from '../src/server/scan-agent.ts';
import type {ScanAgentRequest,AgentTurn} from '../src/domain/scan-agent-contracts.ts';
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const place='synthetic-test-place',other='synthetic-other-place';
const at='2026-10-28T12:00:00.000Z';
/** Authored test pixels and fake cached records exercise HTTP mechanics, not model perception. */
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'scan-review-test-'));
 mkdirSync(join(directory,'assets'));
 const source=new PNG({width:4,height:2});
 for(let y=0;y<2;y++)for(let x=0;x<4;x++)source.data.set(x<2?[255,0,0,255]:[0,0,255,255],(y*4+x)*4);
 const sourceBytes=PNG.sync.write(source),sourceHash=digest(sourceBytes);
 writeFileSync(join(directory,'assets',`${sourceHash}.png`),sourceBytes);
 const manifest:ScanReviewManifest={schemaVersion:1,purpose:'SYNTHETIC TEST ONLY: authored pixels with fake cached-model records; no inference',networkCalls:0,inputHash:digest('fake-input'),cards:[]};
 const store=new ScanStore(directory);
 try{
  for(const [index,placeId] of [place,other].entries()){
   const frameId=`synthetic-${index}`,eventId=`cached-${frameId}`,sessionId=`session-${index}`;
   const observations=[0,...(index===0?[1]:[])].map(cropIndex=>{
    const left=cropIndex*2,bounds={left,top:0,right:left+2,bottom:2},crop=new PNG({width:2,height:2});
    for(let y=0;y<2;y++)for(let x=0;x<2;x++)crop.data.set(source.data.subarray((y*4+left+x)*4,(y*4+left+x)*4+4),(y*2+x)*4);
    const cropBytes=PNG.sync.write(crop),cropHash=digest(cropBytes),regionRef=digest(sourceHash+JSON.stringify([left,0,left+2,2])+cropHash);
    writeFileSync(join(directory,'assets',`${cropHash}.png`),cropBytes);
    const values=Array<number>(24).fill(0),weight=4/Math.sqrt(48);
    for(const bin of cropIndex===0?[7,8,16]:[0,8,23])values[bin]=weight;
    const observationId=`observation-${index}-${cropIndex}`;
    manifest.cards.push({eventId,observationId,regionRef,frameId,placeId,sourceHash,cropHash,sourceWidth:4,sourceHeight:2,bounds,foregroundPixels:4});
    return {id:observationId,regionRef,cropHash,scope:'unknown' as const,feature:{method:'foreground-rgb-histogram-8-v0',values},label:`Fake cached label ${cropIndex}`};
   });
   store.createSession({id:sessionId,placeId,provenance:'cached-model',createdAt:at,label:'Synthetic HTTP fixture only'});
   store.appendEvidence(sessionId,{kind:'observe',id:eventId,placeId,provenance:'cached-model',sourceHash,groupId:`frame-${sourceHash}`,observedAt:at,timeBasis:'provider-response',observations});
  }
 }finally{store.close();}
 writeFileSync(join(directory,'scan-review-manifest.json'),JSON.stringify(manifest));
 return {directory,manifest,sourceBytes,cleanup(){rmSync(directory,{recursive:true,force:true});}};
}
const command=(id:string,action:ScanCommand['action'],placeId=place):ScanCommand=>({id,placeId,createdAt:at,actor:{id:'synthetic-http-test',kind:'user'},utterance:'Synthetic explicit selection',action});
const url=(placeId=place,revision?:number)=>`/api/scan/view?placeId=${encodeURIComponent(placeId)}${revision===undefined?'':`&revision=${revision}`}`;
type App=ReturnType<typeof createScanReviewApp>;
async function view(app:App,placeId=place,revision?:number){const r=await app.inject(url(placeId,revision));assert.equal(r.statusCode,200,r.body);return r.json<ScanReviewView>();}
async function post(app:App,revision:number,c:ScanCommand,headers:Record<string,string>={}){return app.inject({method:'POST',url:'/api/scan/commands',headers,payload:{expectedRevision:revision,command:c}});}

function transport(proposal:unknown={kind:'commands',scope:'selected',message:'model claims should not be displayed',operations:[{type:'set-label',value:'My tool',groupId:null}]}){
 let counts=0,generations=0;const requests:unknown[]=[];
 const wire:ScanAgentTransport={count:async r=>{counts++;requests.push(r);return 250;},generate:async r=>{generations++;requests.push(r);return {id:'synthetic-response',model:'muse-spark-1.3',status:'completed',output_text:JSON.stringify(proposal),usage:{input_tokens:250,output_tokens:50,total_tokens:300}};}};
 return {wire,requests,get counts(){return counts;},get generations(){return generations;}};
}
function input(v:ScanReviewView,extra:Partial<ScanAgentRequest>={}):ScanAgentRequest{return {id:randomUUID(),placeId:place,expectedRevision:v.revision,selectedCandidateIds:[v.cards[0].candidateId],selectedGroupId:null,replyTo:null,message:'Call this My tool',...extra};}
const turnPost=(app:App,body:Record<string,unknown>|string,headers:Record<string,string>={})=>app.inject({method:'POST',url:'/api/scan/agent/turn',payload:body,headers});

test('text agent disabled by default; headers and target validation precede provider access',async()=>{
 const f=fixture(),app=createScanReviewApp(f.directory);try{
  const v=await view(app),body=input(v),status=(await app.inject(`/api/scan/agent?placeId=${place}`)).json();
  assert.equal(status.enabled,false);assert.match(status.reason,/assistant off/);assert.equal(status.budget.requests,0);
  assert.equal((await turnPost(app,body,{origin:'https://foreign.example'})).statusCode,403);
  assert.equal((await turnPost(app,body,{'sec-fetch-site':'cross-site'})).statusCode,403);
  assert.equal((await turnPost(app,JSON.stringify(body),{'content-type':'text/plain'})).statusCode,415);
  assert.equal((await turnPost(app,{...body,selectedCandidateIds:['unknown']})).statusCode,400);
  assert.equal((await turnPost(app,{...body,expectedRevision:0})).statusCode,409);
  assert.equal((await turnPost(app,body)).statusCode,412);assert.deepEqual(await view(app),v);
 }finally{await app.close();f.cleanup();}
});

test('scoped real-adapter seam commits once, immutable retries survive restart and context excludes image/spatial data',async()=>{
 const f=fixture(),fake=transport();let app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:fake.wire}});try{
  const v=await view(app),body=input(v),first=await turnPost(app,body);assert.equal(first.statusCode,200,first.body);
  const result=first.json<{turn:AgentTurn;view:ScanReviewView}>();assert.equal(result.turn.status,'applied');assert.deepEqual(result.turn.commandIds,[`agent:${body.id}:0`]);assert.equal(result.turn.reply,'Personal name: My tool');assert.equal(result.view.claims.objects[0].userLabel,'My tool');assert.equal(result.view.claims.objects[1].userLabel,null);
  const encoded=JSON.stringify(fake.requests[0]);assert.match(encoded,/Write all assistant messages and clarification questions in English/);assert.match(encoded,/Preserve user-provided names, group names and tag values exactly/);for(const forbidden of ['bounds','sourceUrl','cropUrl','sourceHash','cropHash',v.cards[1].candidateId])assert.equal(encoded.includes(forbidden),false,forbidden);
  assert.equal((fake.requests[0] as {store:boolean}).store,false);
  assert.equal((await turnPost(app,body)).statusCode,200);assert.equal(fake.counts,1);assert.equal(fake.generations,1);
  assert.equal((await turnPost(app,{...body,message:'different'})).statusCode,409);
  await app.close();app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:fake.wire}});
  assert.equal((await turnPost(app,body)).json().turn.status,'applied');assert.equal(fake.generations,1);
  const state=(await app.inject(`/api/scan/agent?placeId=${place}`)).json();assert.equal(state.budget.requests,2);assert.equal(state.turns.length,1);
 }finally{await app.close();f.cleanup();}
});

test('clarification persists; followup needs exact selection and valid replyTo',async()=>{
 const f=fixture(),fake=transport({kind:'clarify',scope:'unresolved',message:'Which selected cards?',operations:[]}),app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:fake.wire}});try{
  const v=await view(app),body=input(v),r=await turnPost(app,body);assert.equal(r.statusCode,200);assert.equal(r.json().turn.status,'clarify');assert.deepEqual(await view(app),v);
  assert.equal((await turnPost(app,input(v,{replyTo:body.id,selectedCandidateIds:[v.cards[1].candidateId]}))).statusCode,400);
  assert.equal((await turnPost(app,input(v,{replyTo:randomUUID()}))).statusCode,400);
  assert.equal((await turnPost(app,input(v,{replyTo:body.id,message:'All selected.'}))).statusCode,200);assert.equal(fake.generations,2);
 }finally{await app.close();f.cleanup();}
});

test('revision change during async interpretation returns stale and writes no agent commands',async()=>{
 const f=fixture();let unblock!:(r:ScanAgentResponse)=>void,started!:()=>void;
 const start=new Promise<void>(r=>{started=r;}),pending=new Promise<ScanAgentResponse>(r=>{unblock=r;});
 const app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:{count:async()=>100,generate:async()=>{started();return pending;}}}});try{
  const v=await view(app),body=input(v),response=turnPost(app,body);await start;
  const manual=await post(app,v.revision,command('during-provider',{type:'add-tag',candidateIds:[v.cards[0].candidateId],tag:'manual'}));assert.equal(manual.statusCode,200);
  unblock({id:'fake',model:'muse-spark-1.3',status:'completed',output_text:JSON.stringify({kind:'commands',scope:'selected',message:'ok',operations:[{type:'set-label',value:'Bad stale',groupId:null}]}),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});
  const r=await response;assert.equal(r.statusCode,409,r.body);assert.equal(r.json().turn.status,'stale');assert.equal((await view(app)).claims.objects[0].userLabel,null);
  assert.equal((await turnPost(app,body)).json().turn.status,'stale');
 }finally{await app.close();f.cleanup();}
});

test('preflight failure retains two request slots and halts future provider work across restart',async()=>{
 const f=fixture();let calls=0;const wire:ScanAgentTransport={count:async()=>{calls++;throw new Error('SECRET_PROVIDER_DETAIL');},generate:async()=>{throw new Error('must not generate');}};
 let app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:wire}});try{
  const v=await view(app),body=input(v),r=await turnPost(app,body);assert.equal(r.statusCode,502);assert.equal(r.json().turn.status,'error');assert.equal(r.body.includes('SECRET_PROVIDER_DETAIL'),false);assert.deepEqual(await view(app),v);
  assert.equal((await turnPost(app,body)).json().turn.status,'error');assert.equal(calls,1);
  await app.close();app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:wire}});
  const next=await turnPost(app,input(v));assert.equal(next.statusCode,429);assert.equal(calls,1);
  const status=(await app.inject(`/api/scan/agent?placeId=${place}`)).json();assert.equal(status.budget.requests,2);assert.equal(status.budget.reservedUsd,.008384);
 }finally{await app.close();f.cleanup();}
});

test('five turns exhaust ten reserved HTTP requests; shared budget cannot reset with another workspace',async()=>{
 const a=fixture(),b=fixture(),fake=transport({kind:'clarify',scope:'unresolved',message:'Please clarify.',operations:[]}),budgetDirectory=join(a.directory,'shared-budget');
 const app=createScanReviewApp(a.directory,{agent:{testOnly:true,transport:fake.wire,budgetDirectory}}),otherApp=createScanReviewApp(b.directory,{agent:{testOnly:true,transport:fake.wire,budgetDirectory}});try{
  const v=await view(app);for(let i=0;i<5;i++)assert.equal((await turnPost(app,input(v))).statusCode,200);
  assert.equal((await turnPost(otherApp,input(await view(otherApp)))).statusCode,429);assert.equal(fake.counts,5);assert.equal(fake.generations,5);
 }finally{await app.close();await otherApp.close();a.cleanup();b.cleanup();}
});

test('invalid complete compound proposal, oversized count and absent usage commit nothing and halt budget',async()=>{
 for(const mode of ['proposal','count','usage']){
  const f=fixture(),fake=transport({kind:'commands',scope:'selected',message:'partially valid',operations:[{type:'set-label',value:'Must not commit',groupId:null},{type:'delete',value:null,groupId:null}]}),wire:ScanAgentTransport=mode==='count'?{...fake.wire,count:async()=>4097}:mode==='usage'?{...fake.wire,generate:async()=>({id:'fake',model:'muse-spark-1.3',status:'completed',output_text:'{}'})}:fake.wire;
  const app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:wire}});try{
   const v=await view(app);assert.equal((await turnPost(app,input(v))).statusCode,502,mode);assert.deepEqual(await view(app),v);assert.equal((await turnPost(app,input(v))).statusCode,429,mode);if(mode==='count')assert.equal(fake.generations,0);
  }finally{await app.close();f.cleanup();}
 }
});

test('restart recovers exact committed deterministic batch without provider call; interrupted uncommitted turn is error',async()=>{
 const f=fixture(),fake=transport();let app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:fake.wire}});try{
  const v=await view(app),body=input(v),r=await turnPost(app,body);assert.equal(r.statusCode,200);
  const saved=r.json().turn as AgentTurn;await app.close();
  const db=new DatabaseSync(join(f.directory,'scan-agent-turns.sqlite'));
  db.prepare('UPDATE turns SET turn=? WHERE id=?').run(JSON.stringify({...saved,status:'processing',commandIds:[]}),body.id);db.close();
  app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:fake.wire}});
  const recovered=(await turnPost(app,body)).json().turn;assert.equal(recovered.status,'applied');assert.deepEqual(recovered.commandIds,[`agent:${body.id}:0`]);assert.equal(fake.generations,1);
  await app.close();
  const lost=input(v),db2=new DatabaseSync(join(f.directory,'scan-agent-turns.sqlite'));
  // A crash before output persistence cannot be resumed automatically.
  db2.prepare('INSERT INTO turns(id,fingerprint,request,turn) VALUES(?,?,?,?)').run(lost.id,'synthetic-never-retried',JSON.stringify(lost),JSON.stringify({...saved,id:lost.id,status:'processing',commandIds:[]}));db2.close();
  app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:fake.wire}});
  const status=(await app.inject(`/api/scan/agent?placeId=${place}`)).json();assert.equal(status.turns.find((t:AgentTurn)=>t.id===lost.id).status,'error');assert.equal(fake.generations,1);
 }finally{await app.close();f.cleanup();}
});

const undoTurn=(app:App,id:string,revision:number,placeId=place,extra:Record<string,unknown>={},headers:Record<string,string>={})=>app.inject({method:'POST',url:`/api/scan/agent/turn/${encodeURIComponent(id)}/undo`,payload:{placeId,expectedRevision:revision,...extra},headers});
const compound=()=>transport({kind:'commands',scope:'selected',message:'ok',operations:[{type:'set-label',value:'Original label',groupId:null},{type:'create-group',value:'Kit',groupId:null},{type:'add-tag',value:'repair',groupId:null}]});

test('turn undo withdraws three operations once in reverse order; retry and disabled restart preserve turn and budget',async()=>{
 const f=fixture(),fake=compound();let app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:fake.wire}});try{
  const before=await view(app),body=input(before),applied=(await turnPost(app,body)).json<{turn:AgentTurn;view:ScanReviewView}>();
  const budget=(await app.inject(`/api/scan/agent?placeId=${place}`)).json().budget;
  const response=await undoTurn(app,body.id,applied.view.revision);assert.equal(response.statusCode,200,response.body);
  const result=response.json<{turn:AgentTurn;view:ScanReviewView}>();assert.deepEqual(result.turn,applied.turn);
  assert.deepEqual(result.view.claims.objects,before.claims.objects);assert.deepEqual(result.view.claims.groups,[]);
  assert.deepEqual(result.view.claims.commands.slice(-3).map(c=>c.command.action.type==='undo'?c.command.action.targetCommandId:null),[...applied.turn.commandIds].reverse());
  assert.ok(result.view.claims.commands.slice(0,3).every(c=>c.status==='undone'));
  assert.equal(result.view.revision,applied.view.revision+3);
  assert.deepEqual((await undoTurn(app,body.id,0)).json(),result);
  assert.deepEqual((await app.inject(`/api/scan/agent?placeId=${place}`)).json().budget,budget);
  await app.close();app=createScanReviewApp(f.directory,{agent:{testOnly:true,budgetDirectory:join(f.directory,'test-agent-budget')}});
  assert.equal((await app.inject(`/api/scan/agent?placeId=${place}`)).json().enabled,false);
  assert.deepEqual((await undoTurn(app,body.id,0)).json(),result);assert.equal(fake.counts,1);assert.equal(fake.generations,1);
 }finally{await app.close();f.cleanup();}
});

test('partial manual undo, stale revision, later rename and dependent group edits retain independent history',async()=>{
 const f=fixture(),fake=compound(),app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:fake.wire}});try{
  const body=input(await view(app)),applied=(await turnPost(app,body)).json<{turn:AgentTurn;view:ScanReviewView}>();
  let v=applied.view;const a=v.cards[0].candidateId,group=v.claims.groups[0].id;
  for(const c of [command('manual-undo-tag',{type:'undo',targetCommandId:applied.turn.commandIds[2]}),command('later-label',{type:'set-label',candidateIds:[a],label:'Later label'}),command('dependent-group-rename',{type:'rename-group',groupId:group,name:'Later kit'})]){assert.equal((await post(app,v.revision,c)).statusCode,200);v=await view(app);}
  const stale=await undoTurn(app,body.id,applied.view.revision);assert.equal(stale.statusCode,409);assert.deepEqual(await view(app),v);
  const response=await undoTurn(app,body.id,v.revision);assert.equal(response.statusCode,200,response.body);
  const final=response.json<{view:ScanReviewView}>().view;
  assert.equal(final.revision,v.revision+2);assert.equal(final.claims.objects[0].userLabel,'Later label');assert.deepEqual(final.claims.groups,[]);
  assert.equal(final.claims.commands.find(c=>c.commandId==='dependent-group-rename')!.status,'stale');
  assert.equal(final.claims.commands.find(c=>c.commandId==='later-label')!.status,'applied');assert.equal(fake.counts,1);assert.equal(fake.generations,1);
 }finally{await app.close();f.cleanup();}
});

test('undo rejects unknown/foreign/unapplied turns, arbitrary IDs and cross-origin or non-JSON bodies',async()=>{
 const f=fixture(),fake=compound(),app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:fake.wire}});try{
  const body=input(await view(app)),applied=(await turnPost(app,body)).json<{turn:AgentTurn;view:ScanReviewView}>(),v=applied.view;
  assert.equal((await undoTurn(app,'absent',v.revision)).statusCode,404);
  assert.equal((await undoTurn(app,body.id,v.revision,other)).statusCode,404);
  assert.equal((await undoTurn(app,body.id,v.revision,place,{targetCommandIds:['arbitrary']})).statusCode,400);
  assert.equal((await undoTurn(app,body.id,v.revision,place,{}, {origin:'https://foreign.example'})).statusCode,403);
  assert.equal((await undoTurn(app,body.id,v.revision,place,{}, {'sec-fetch-site':'cross-site'})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:`/api/scan/agent/turn/${body.id}/undo`,payload:JSON.stringify({placeId:place,expectedRevision:v.revision}),headers:{'content-type':'text/plain'}})).statusCode,415);
  assert.deepEqual(await view(app),v);assert.equal(fake.generations,1);
  // Corrupt saved command IDs cannot redirect the trusted persisted proposal.
  const db=new DatabaseSync(join(f.directory,'scan-agent-turns.sqlite'));
  db.prepare('UPDATE turns SET turn=? WHERE id=?').run(JSON.stringify({...applied.turn,commandIds:['later-manual-command']}),body.id);
  assert.equal((await undoTurn(app,body.id,v.revision)).statusCode,409);assert.deepEqual(await view(app),v);
  db.prepare('UPDATE turns SET turn=? WHERE id=?').run(JSON.stringify({...applied.turn,status:'clarify',commandIds:[]}),body.id);db.close();
  assert.equal((await undoTurn(app,body.id,v.revision)).statusCode,409);
 }finally{await app.close();f.cleanup();}
});

test('first turn withdrawal works after restart with disabled text generation and exhausted shared budget',async()=>{
 const f=fixture(),fake=compound(),budgetDirectory=join(f.directory,'shared-exhausted-budget');let app=createScanReviewApp(f.directory,{agent:{testOnly:true,transport:fake.wire,budgetDirectory}});try{
  const before=await view(app),body=input(before),applied=(await turnPost(app,body)).json<{turn:AgentTurn;view:ScanReviewView}>();
  // Exhaust this authored ledger through the actual provider seam, without resetting it.
  for(let index=0;index<4;index++)assert.equal((await turnPost(app,input(await view(app)))).statusCode,200);
  const state=(await app.inject(`/api/scan/agent?placeId=${place}`)).json();assert.equal(state.budget.requests,10);assert.equal(state.enabled,false);
  await app.close();app=createScanReviewApp(f.directory,{agent:{testOnly:true,budgetDirectory}});
  const v=await view(app),response=await undoTurn(app,body.id,v.revision);assert.equal(response.statusCode,200,response.body);
  const result=response.json<{turn:AgentTurn;view:ScanReviewView}>();assert.deepEqual(result.turn,applied.turn);
  assert.ok(applied.turn.commandIds.every(id=>result.view.claims.commands.find(c=>c.commandId===id)!.status==='undone'));
  assert.equal((await app.inject(`/api/scan/agent?placeId=${place}`)).json().budget.requests,10);assert.equal(fake.counts,5);assert.equal(fake.generations,5);
 }finally{await app.close();f.cleanup();}
});
