import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FrameSchema, makeCapture } from '../src/domain/contracts.ts';
import { PairAnalysisSchema, projectVisitPair, pairContextError, type PairAnalysis, type VisitPair, type PairFrame } from '../src/domain/visit-pair.ts';
import { VisitPairStore } from '../src/server/visit-pair-store.ts';
import { Store } from '../src/server/store.ts';
import { pairRequest, observePair, type PairTransport } from '../src/server/visit-pair-observer.ts';
import { createApp } from '../src/server/app.ts';

const pixels = { bytes: Buffer.from([137,80,78,71,13,10,26,10]), mime: 'image/png' };
const temp = () => mkdtempSync(join(tmpdir(), 'environment-visits-'));
const object = (label: string, location = 'On bench') => ({label,appearance:'Distinct visible shape',locationDescription:location,uncertainty:'Identity remains tentative',bbox:null});
const analysis = (): PairAnalysis => ({summary:'Authored test only',before:{summary:'Earlier',objects:[object('Blue case'),object('Cordless drill'),object('Cardboard box')]},after:{summary:'Later',objects:[object('Blue toolbox','Lower shelf'),object('Red multimeter'),object('Cardboard box')]},links:[{beforeIndex:0,afterIndex:0,decision:'same_candidate',reason:'Matching blue shell ribs handle and latches'},{beforeIndex:2,afterIndex:2,decision:'same_candidate',reason:'Matching parcel folds and label'}]});
const frame = (minute: number): PairFrame => ({id:randomUUID(),capturedAt:`2026-10-27T12:${String(minute).padStart(2,'0')}:00.000Z`,zone:'bench',source:'virtual-camera',width:640,height:309,imageHash:`hash-${minute}`,imageUrl:'/api/frames/test/image',referenceView:'workshop-v2-bench'});
const pair = (): VisitPair => ({id:randomUUID(),createdAt:new Date().toISOString(),before:frame(1),after:frame(2),analysis:analysis(),source:'authored_fixture',model:'fixture',usage:{}});
const capture = (minute: number) => ({...makeCapture({imageDataUrl:`data:image/png;base64,${pixels.bytes.toString('base64')}`,width:640,height:309,referenceView:'workshop-v2-bench'},'bench'),capturedAt:frame(minute).capturedAt});
async function config(action: () => Promise<void>) {
  const keys=['MODEL_API_KEY','META_MODEL','ENABLE_LIVE_META_API','META_CREDITS_CONFIRMED','ENABLE_LIVE_VISIT_COMPARISON'];
  const old=keys.map(key=>process.env[key]);keys.forEach((key,i)=>process.env[key]=['test-placeholder','muse-spark-1.3','true','true','true'][i]);
  try { await action(); } finally {keys.forEach((key,i)=>{if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i];});}
}

test('two visits keep candidate identity, first-seen and retained last-seen evidence distinct',()=>{
  const p=pair(),rows=projectVisitPair(p);
  assert.equal(rows.filter(row=>row.kind==='same_candidate').length,2);
  const moved=rows.find(row=>row.label==='Blue toolbox')!;
  assert.equal(moved.id,`item:${p.id}:before:0`);assert.equal(moved.beforeIndex,0);assert.equal(moved.afterIndex,0);assert.equal(moved.lastSeen.frameId,p.after.id);
  assert.equal(rows.find(row=>row.label==='Red multimeter')?.kind,'newly_observed');
  const unseen=rows.find(row=>row.label==='Cordless drill')!;
  assert.equal(unseen.kind,'not_observed');assert.equal(unseen.lastSeen.frameId,p.before.id);assert.match(unseen.reason,/does not mean missing/);
  assert.match(rows.find(row=>row.label==='Red multimeter')!.reason,/arrival is not established/);
});
test('competing same-colour case instances remain unresolved even when model chooses one',()=>{
  const p=pair();p.analysis!.after.objects.push(object('Blue case right'));
  const rows=projectVisitPair(p).filter(row=>/blue/i.test(row.label));
  assert.equal(rows.length,3);assert.ok(rows.every(row=>row.kind==='unresolved'));assert.equal(rows.filter(row=>row.candidateIds.length).length,2);
});
test('non-bijective links, incompatible kinds and group descriptions cannot become individual matches',()=>{
  const p=pair();p.analysis!.links.push({beforeIndex:0,afterIndex:1,decision:'same_candidate',reason:'Conflicting proposal'});
  assert.ok(!projectVisitPair(p).some(row=>row.kind==='same_candidate'&&row.beforeIndex===0));
  const wrong=pair();wrong.analysis!.links=[{beforeIndex:0,afterIndex:1,decision:'same_candidate',reason:'Unsupported case-to-tool link'}];
  assert.ok(!projectVisitPair(wrong).some(row=>row.kind==='same_candidate'));
  const grouped=pair();grouped.analysis!.before.objects[0].label='Storage boxes';grouped.analysis!.after.objects[0].label='Storage boxes';
  assert.ok(!projectVisitPair(grouped).some(row=>row.kind==='same_candidate'&&row.beforeIndex===0));
  grouped.analysis!.before.objects[0].label='Orange trays';grouped.analysis!.after.objects[0].label='Orange trays';
  assert.ok(!projectVisitPair(grouped).some(row=>row.kind==='same_candidate'&&row.beforeIndex===0));
});
test('identical pixels with changed wording cannot create new or absent claims',()=>{
  const p=pair();p.after.imageHash=p.before.imageHash;
  assert.ok(projectVisitPair(p).every(row=>row.kind==='unresolved'));
});
test('comparison scopes reference view, dimensions, chronology and valid observation references',()=>{
  const p=pair();assert.equal(pairContextError(p.before,p.after),null);
  for(const after of [{...p.after,referenceView:undefined},{...p.after,referenceView:'workshop-v2-parts' as const},{...p.after,width:320},{...p.after,capturedAt:p.before.capturedAt}])assert.ok(pairContextError(p.before,after));
  const output=analysis();output.links[0].afterIndex=12;assert.equal(PairAnalysisSchema.safeParse(output).success,false);
  assert.equal(PairAnalysisSchema.safeParse({...analysis(),simulatorTruth:'forbidden'}).success,false);
  assert.equal(FrameSchema.safeParse({...capture(1),zone:'parts'}).success,false);
});
test('pair persistence is idempotent, source-explicit and immutable across reopening',()=>{
  const directory=temp();let store=new VisitPairStore(directory);
  try{
    const p=pair(),created=store.create(p.before,p.after);assert.equal(store.create(p.before,p.after).id,created.id);
    store.authored(created.id,analysis());assert.throws(()=>store.authored(created.id,analysis()));
    store.close();store=new VisitPairStore(directory);
    assert.equal(store.get(created.id)?.source,'authored_fixture');assert.deepEqual(store.get(created.id)?.analysis,analysis());
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
test('comparison reservations survive failures/reopen and stop at three across different pairs',()=>{
  const directory=temp();let store=new VisitPairStore(directory);
  try{
    const p=pair(),first=store.create(p.before,p.after),a=store.reserve(first.id,4096);a.status='provider_error';store.finish(a);
    store.close();store=new VisitPairStore(directory);assert.equal(store.attempts()[0].status,'provider_error');assert.throws(()=>store.reserve(first.id,100));
    for(let i=0;i<2;i++)store.reserve(store.create(frame(3+i*2),frame(4+i*2)).id,4096);
    assert.throws(()=>store.reserve(store.create(frame(9),frame(10)).id,100),/budget/);
    assert.equal(store.attempts().length,3);assert.ok(store.usage().reservedUsd<.05);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
test('pair payload contains pixels/public capture context, never hidden scene fields',()=>{
  const p=pair();Object.assign(p.before,{objects:'HIDDEN_OBJECT_IDS',transforms:'HIDDEN_TRANSFORMS'});Object.assign(p,{scenario:'HIDDEN_EXPECTED_CHANGES'});
  const request=pairRequest(p,[pixels,pixels]),text=JSON.stringify(request);
  for(const secret of ['HIDDEN_OBJECT_IDS','HIDDEN_TRANSFORMS','HIDDEN_EXPECTED_CHANGES'])assert.ok(!text.includes(secret));
  assert.equal(request.input[0].content.filter(item=>item.type==='input_image').length,2);assert.equal(request.store,false);
});
test('actual transport boundary commits complete pair once and reuses cached evidence without a new call',async()=>config(async()=>{
  const directory=temp(),frames=new Store(directory),store=new VisitPairStore(directory);let calls=0;
  const transport:PairTransport={count:async()=>1500,generate:async()=>{calls++;return{model:'stub-model',status:'completed',output_text:JSON.stringify(analysis()),usage:{input_tokens:900,output_tokens:1000,total_tokens:1900,output_tokens_details:{reasoning_tokens:400}}};}};
  try{
    const a=frames.saveFrame(capture(1)),b=frames.saveFrame(capture(2)),p=store.create(a,b);
    const result=await observePair(p,frames,store,transport);assert.equal(result.source,'live_model');assert.equal(result.usage.outputTokens,1000);assert.equal(result.usage.visibleOutputTokens,600);
    assert.equal((await observePair(result,frames,store,transport)).id,result.id);assert.equal(calls,1);assert.equal(store.attempts().length,1);
  }finally{frames.close();store.close();rmSync(directory,{recursive:true,force:true});}
}));
test('incomplete pair and invalid references retain reservations and never replace prior evidence',async()=>config(async()=>{
  const directory=temp(),frames=new Store(directory),store=new VisitPairStore(directory);let calls=0;
  const transport:PairTransport={count:async()=>1000,generate:async()=>{calls++;return{model:'stub',status:'incomplete',output_text:'{"partial":',usage:{input_tokens:600,output_tokens:2400,total_tokens:3000}};}};
  try{
    const p=store.create(frames.saveFrame(capture(1)),frames.saveFrame(capture(2)));
    await assert.rejects(()=>observePair(p,frames,store,transport),/incomplete/);assert.equal(store.get(p.id)?.analysis,null);
    await assert.rejects(()=>observePair(p,frames,store,transport),/already attempted/);assert.equal(calls,1);
    const invalid=analysis();invalid.links[0].beforeIndex=99;
    const second=store.create(frames.saveFrame(capture(3)),frames.saveFrame(capture(4)));
    await assert.rejects(()=>observePair(second,frames,store,{count:async()=>1000,generate:async()=>({model:'stub',status:'completed',output_text:JSON.stringify(invalid)})}),/validation/);
    assert.equal(store.get(second.id)?.analysis,null);assert.deepEqual(store.attempts().map(a=>a.status),['incomplete','invalid_output']);
  }finally{frames.close();store.close();rmSync(directory,{recursive:true,force:true});}
}));
test('HTTP pair accepts only comparable saved evidence, labels authored data and survives app restart',async()=>{
  const directory=temp();let app=createApp(directory);
  try{
    const saved=[];for(const minute of [1,2])saved.push((await app.inject({method:'POST',url:'/api/frames',payload:capture(minute)})).json());
    const created=await app.inject({method:'POST',url:'/api/visit-pairs',payload:{beforeFrameId:saved[0].id,afterFrameId:saved[1].id}});assert.equal(created.statusCode,200);
    const id=created.json().id;
    const fixture=await app.inject({method:'POST',url:`/api/visit-pairs/${id}/authored`,payload:{provenance:'authored_fixture',analysis:analysis()}});
    assert.equal(fixture.json().source,'authored_fixture');assert.equal(fixture.json().items.find((row:{label:string})=>row.label==='Cordless drill').lastSeen.frameId,saved[0].id);
    assert.equal((await app.inject({method:'POST',url:`/api/visit-pairs/${id}/authored`,payload:{provenance:'authored_fixture',analysis:analysis()}})).statusCode,409);
    const legacy=(await app.inject({method:'POST',url:'/api/frames',payload:{...capture(3),referenceView:undefined}})).json();
    assert.equal((await app.inject({method:'POST',url:'/api/visit-pairs',payload:{beforeFrameId:saved[0].id,afterFrameId:legacy.id}})).statusCode,422);
    await app.close();app=createApp(directory);
    const listing=(await app.inject('/api/visit-pairs')).json();assert.equal(listing.pairs[0].id,id);assert.equal(listing.trial.attempts.length,0);
    assert.equal((await app.inject({method:'POST',url:'/api/visit-pairs',headers:{origin:'https://example.invalid'},payload:{}})).statusCode,403);
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
