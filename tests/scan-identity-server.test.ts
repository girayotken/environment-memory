import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {identityResponse,registerIdentityRoutes,type IdentitySource,type IdentityResponse} from '../src/server/scan-identity-routes.ts';
import {describeScanAppearance} from '../src/domain/scan-appearance.ts';
import {ScanIdentityStore} from '../src/server/scan-identity-store.ts';
import type {ScanClaimObject} from '../src/domain/scan-claims.ts';
import type {IdentityCommand} from '../src/domain/scan-identity.ts';
const at='2026-10-28T12:00:00.000Z';
function source(n:number,placeId=`place-${n}`,sourceHash=String(n).repeat(64)):IdentitySource {
 const candidateId=`candidate-${n}`,observationRef=`event-${n}/obs-${n}`,regionRef=`region-${n}`;
 const claim:ScanClaimObject={candidateId,userLabel:n===1?'My drill':null,tags:n===1?['repair']:[],groupIds:[],provenance:{labelCommandId:n===1?'label-1':null,tagCommandIds:n===1?{repair:['tag-1']}:{},groupCommandIds:{}}};
 return {anchor:{placeId,candidateId,observationRef,regionRef,sourceHash},
  card:{candidateId,observationRef,regionRef,cropUrl:`/crop-${n}`,sourceUrl:`/source-${n}`,sourceHash,cropHash:`crop-${n}`,observedAt:at,timeBasis:'capture',scope:'unknown',modelLabel:'Drill?',bounds:{left:0,top:0,right:2,bottom:2},sourceWidth:4,sourceHeight:4},
  claim,placeLabel:`Saved frame ${n}`,label:claim.userLabel??'Drill?',tags:claim.tags,provenance:'live-model',feature:{method:'foreground-rgb-histogram-8-v0',values:Array.from({length:24},(_,i)=>i===0?1:0)}};
}
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'scan-identity-test-'));
 const state={sources:[source(1),source(2),source(3)],workspaceRevision:6,placeIds:['place-1','place-2','place-3']};
 const create=()=>{const app=Fastify();registerIdentityRoutes(app,directory,()=>state);return app;};
 return {directory,state,create,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
const url='/api/scan/identity?placeId=place-2&candidateId=candidate-2';
const command=(id:string,a:IdentitySource,b:IdentitySource,decision:'same'|'different'|'unsure'='same'):IdentityCommand=>({id,placeId:a.anchor.placeId,actor:'user',createdAt:at,action:{type:'decide',a:a.anchor,b:b.anchor,decision}});
async function post(app:ReturnType<typeof Fastify>,c:IdentityCommand,expectedRevision=0,workspaceRevision=6,headers:Record<string,string>={}){
 return app.inject({method:'POST',url:'/api/scan/identity/commands',headers,payload:{expectedRevision,workspaceRevision,command:c}});
}

test('GET ranks source-bound different images, includes exact crops/times, and never writes',async()=>{
 const f=fixture(),app=f.create();try{
  const before=new ScanIdentityStore(f.directory);assert.equal(before.revision(),0);before.close();
  const r=await app.inject(url);assert.equal(r.statusCode,200);const v=r.json<IdentityResponse>();
  assert.equal(v.revision,0);assert.equal(v.workspaceRevision,6);assert.equal(v.proposals.length,2);
  assert.equal(v.proposals[0].uncalibrated,true);assert.equal(v.proposals[0].score,1);
  assert.equal(v.selected!.card.cropUrl,'/crop-2');assert.equal(v.proposals[0].endpoint.card.observedAt,at);
  const after=new ScanIdentityStore(f.directory);assert.equal(after.commands().length,0);after.close();
  f.state.sources.push(source(4,'place-1',f.state.sources[1].anchor.sourceHash),{...source(5),provenance:'authored-scenario'});
  assert.equal((await app.inject(url)).json<IdentityResponse>().proposals.length,2);
  assert.equal((await app.inject(`${url}&otherPlaceId=place-1`)).json<IdentityResponse>().proposals.length,1);
 }finally{await app.close();f.cleanup();}
});

test('same decision derives only direct attributed overlays; own edits win and undo preserves independent edits',async()=>{
 const f=fixture(),app=f.create();try{
  const [a,b,c]=f.state.sources,decision=command('same-1',a,b);
  const accepted=await post(app,decision);assert.equal(accepted.statusCode,200,accepted.body);assert.equal(accepted.json().acceptedRevision,1);
  let result=(await app.inject(url)).json<IdentityResponse>(),overlay=result.overlays[0];
  assert.equal(overlay.label,'My drill');assert.deepEqual(overlay.tags,['repair']);assert.equal(overlay.linked[0].decisionId,'same-1');assert.equal(overlay.linked[0].labelCommandId,'label-1');
  assert.equal((await post(app,command('chain',b,c),1)).statusCode,400);
  b.claim.userLabel='Different name';b.claim.tags=['my-tag'];f.state.workspaceRevision++;
  result=(await app.inject(url)).json<IdentityResponse>();assert.equal(result.overlays[0].label,'Different name');assert.deepEqual(result.overlays[0].conflicts,['Different name','My drill']);
  const undo:IdentityCommand={id:'undo-1',placeId:b.anchor.placeId,createdAt:at,actor:'user',action:{type:'undo',decisionId:'same-1'}};
  assert.equal((await post(app,undo,1,7)).statusCode,200);
  overlay=(await app.inject(url)).json<IdentityResponse>().overlays[0];
  assert.equal(overlay.label,'Different name');assert.deepEqual(overlay.tags,['my-tag']);assert.deepEqual(overlay.linked,[]);
  assert.equal(a.claim.userLabel,'My drill');assert.equal(b.claim.userLabel,'Different name');
 }finally{await app.close();f.cleanup();}
});

test('immutable retries survive restart, later edits and withdrawn evidence without revision growth',async()=>{
 const f=fixture();let app=f.create();try{
  const c=command('retry',f.state.sources[0],f.state.sources[1]);assert.equal((await post(app,c)).statusCode,200);
  await app.close();app=f.create();f.state.workspaceRevision=8;f.state.sources.shift();
  const retry=await post(app,c,0,6);assert.equal(retry.statusCode,200,retry.body);assert.equal(retry.json().acceptedRevision,1);assert.equal(retry.json().revision,1);
  assert.equal(retry.json().history[0].status,'stale');
  if(c.action.type==='decide'){
   const reverse={...c,action:{...c.action,a:c.action.b,b:c.action.a}};
   const reversed=await post(app,reverse,0,6);assert.equal(reversed.statusCode,200,reversed.body);assert.equal(reversed.json().acceptedRevision,1);
  }
  const changed={...c,action:{...c.action,decision:'different'}};assert.equal((await app.inject({method:'POST',url:'/api/scan/identity/commands',payload:{expectedRevision:1,workspaceRevision:8,command:changed}})).statusCode,409);
 }finally{await app.close();f.cleanup();}
});

test('stale workspace/identity/evidence and pair conflicts cannot append',async()=>{
 const f=fixture(),app=f.create();try{
  const c=command('first',f.state.sources[0],f.state.sources[1]);
  assert.equal((await post(app,c,0,5)).statusCode,409);assert.equal((await post(app,c,1)).statusCode,409);
  assert.equal((await post(app,{...c,action:{type:'decide',decision:'same',a:{...f.state.sources[0].anchor,regionRef:'changed'},b:f.state.sources[1].anchor}})).statusCode,409);
  assert.equal((await post(app,c)).statusCode,200);
  assert.equal((await post(app,command('duplicate-pair',f.state.sources[1],f.state.sources[0],'different'),1)).statusCode,400);
  assert.equal((await app.inject(url)).json<IdentityResponse>().revision,1);
 }finally{await app.close();f.cleanup();}
});

for(const decision of ['different','unsure'] as const)test(`${decision} persists history without propagating claims`,async()=>{
 const f=fixture(),app=f.create();try{
  assert.equal((await post(app,command(decision,f.state.sources[0],f.state.sources[1],decision))).statusCode,200);
  const v=(await app.inject(url)).json<IdentityResponse>();assert.equal(v.history[0].decision,decision);assert.equal(v.overlays[0].label,'Drill?');assert.deepEqual(v.overlays[0].tags,[]);assert.deepEqual(v.overlays[0].linked,[]);
 }finally{await app.close();f.cleanup();}
});

test('origin, JSON, same-source and authored/model guards reject without writes',async()=>{
 const f=fixture(),app=f.create();try{
  const c=command('guard',f.state.sources[0],f.state.sources[1]);
  assert.equal((await post(app,c,0,6,{origin:'https://outside.example'})).statusCode,403);
  assert.equal((await post(app,c,0,6,{'sec-fetch-site':'cross-site'})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/scan/identity/commands',headers:{'content-type':'text/plain'},payload:'{}'})).statusCode,415);
  f.state.sources[1].provenance='authored-scenario';assert.equal((await post(app,c)).statusCode,409);
  f.state.sources[1].provenance='live-model';f.state.sources[1].anchor.sourceHash=f.state.sources[0].anchor.sourceHash;
  assert.equal((await post(app,c)).statusCode,409);assert.equal((await app.inject(url)).json<IdentityResponse>().revision,0);
 }finally{await app.close();f.cleanup();}
});


test('decision response selects the command place endpoint even with reversed pair order',async()=>{
 const f=fixture(),app=f.create();try{
  const c=command('other-origin',f.state.sources[0],f.state.sources[1]);c.placeId=f.state.sources[1].anchor.placeId;
  const result=await post(app,c);assert.equal(result.statusCode,200,result.body);
  assert.equal((result.json() as IdentityResponse).selected!.anchor.candidateId,'candidate-2');
 }finally{await app.close();f.cleanup();}
});

const appearance=(rgb:number[])=>describeScanAppearance({width:2,height:2,data:new Uint8Array(Array.from({length:4},()=>[...rgb,255]).flat())})!;
test('pixel ranking uses one gallery basis and falls all candidates back when any descriptor is unavailable',()=>{
 const sources=[source(1),source(2),source(3)];
 sources[0].appearance=appearance([255,0,0]);sources[1].appearance=appearance([255,0,0]);sources[2].appearance=appearance([0,0,255]);
 const rank=()=>identityResponse(sources,[],0,6,'place-2','candidate-2',undefined,{appearanceMethod:'balanced'});
 const changed=rank();assert.equal(changed.rankingMethod,'foreground-colour-shape-v1:balanced');
 assert.equal(changed.proposals[0].endpoint.anchor.candidateId,'candidate-1');assert.ok(changed.proposals[0].score!>changed.proposals[1].score!);
 sources[2].appearance=null;
 assert.equal(identityResponse(sources,[],0,6,'place-2','candidate-2','place-1',{appearanceMethod:'balanced'}).rankingMethod,'foreground-colour-shape-v1:balanced');
 const legacy=rank();assert.equal(legacy.rankingMethod,'foreground-rgb-histogram-8-v0');assert.deepEqual(legacy.proposals.map(p=>p.score),[1,1]);
 sources[2].appearance={...appearance([0,0,255]),hueSaturation:[NaN]};
 assert.deepEqual(rank().proposals.map(p=>p.score),[1,1]);
 // Unconfigured routes retain the old score even when pixels are available.
 assert.equal(identityResponse(sources,[],0,6,'place-2','candidate-2').rankingMethod,'foreground-rgb-histogram-8-v0');
});
test('personal labels/tags and identity decisions cannot change pixel ranks or create automatic decisions',()=>{
 const sources=[source(1),source(2),source(3)];
 sources[0].appearance=appearance([255,0,0]);sources[1].appearance=appearance([255,0,0]);sources[2].appearance=appearance([0,0,255]);
 const scores=(commands:IdentityCommand[]=[])=>identityResponse(sources,commands,commands.length,6,'place-2','candidate-2',undefined,{appearanceMethod:'balanced'});
 const initial=scores(),ranking=initial.proposals.map(p=>[p.endpoint.anchor.candidateId,p.score]);
 assert.equal(initial.history.length,0);assert.ok(initial.proposals.every(p=>p.uncalibrated&&!p.decision));assert.ok(initial.overlays.every(o=>!o.linked.length));
 for(const s of sources){s.label='Misleading equal name';s.tags=['equal'];s.claim.userLabel='Misleading equal name';s.claim.tags=['equal'];s.card.modelLabel='Changed label';}
 assert.deepEqual(scores().proposals.map(p=>[p.endpoint.anchor.candidateId,p.score]),ranking);
 const decided=scores([command('different-pixels',sources[1],sources[2],'different')]);
 assert.deepEqual(decided.proposals.map(p=>[p.endpoint.anchor.candidateId,p.score]),ranking);assert.equal(decided.history[0].decision,'different');
});

test('GET experimental ranking is explicit, strictly validated, uniformly falls back and never accepts identity',async()=>{
 const f=fixture(),app=f.create();try{
  for(const [index,s] of f.state.sources.entries())s.appearance=appearance(index===2?[0,0,255]:[255,0,0]);
  const initial=(await app.inject(url)).json<IdentityResponse>();assert.equal(initial.rankingMethod,'foreground-rgb-histogram-8-v0');assert.deepEqual(initial.proposals.map(p=>p.score),[1,1]);
  const optIn=await app.inject(`${url}&ranking=balanced`);assert.equal(optIn.statusCode,200);const result=optIn.json<IdentityResponse>();
  assert.equal(result.rankingMethod,'foreground-colour-shape-v1:balanced');assert.ok(result.proposals[0].score!>result.proposals[1].score!);
  assert.equal(result.revision,0);assert.deepEqual(result.history,[]);assert.ok(result.proposals.every(p=>!p.decision));
  assert.equal((await app.inject(`${url}&ranking=legacy`)).json<IdentityResponse>().rankingMethod,'foreground-rgb-histogram-8-v0');
  for(const value of ['hue_shape','chroma_shape','unknown',''])assert.equal((await app.inject(`${url}&ranking=${value}`)).statusCode,400);
  f.state.sources[2].appearance=null;
  const fallback=(await app.inject(`${url}&ranking=balanced`)).json<IdentityResponse>();assert.equal(fallback.rankingMethod,'foreground-rgb-histogram-8-v0');assert.deepEqual(fallback.proposals.map(p=>p.score),[1,1]);
  const store=new ScanIdentityStore(f.directory);assert.equal(store.commands().length,0);store.close();
 }finally{await app.close();f.cleanup();}
});
