import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import Fastify from 'fastify';
import {PNG} from 'pngjs';
import {CaptureStore} from '../src/server/capture-store.ts';
import {RoomMemoryStore} from '../src/server/room-memory-store.ts';
import {registerRoomMemoryRoutes} from '../src/server/room-memory-routes.ts';
import {roomLastObservation} from '../src/client/room-memory-index.ts';
import type {RoomObserverResult} from '../src/domain/room-observer-contracts.ts';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'room-correction-')),captures=new CaptureStore(root);
 const capture=(id:string,second:number,samePixelsAs?:number)=>{const image=new PNG({width:2,height:2});image.data.fill(210-(samePixelsAs??second));for(let i=3;i<image.data.length;i+=4)image.data[i]=255;captures.import({importId:id,frames:[{id,sessionId:'session',capturedAt:new Date(Date.parse('2026-10-29T00:00:00Z')+second*1000).toISOString(),imageDataUrl:`data:image/png;base64,${PNG.sync.write(image).toString('base64')}`}]});return captures.frames().find(frame=>frame.id===id)!;};
 const original=capture('original',0);let memory=new RoomMemoryStore(root);
 const initial={schemaVersion:1,importId:'initial',roomId:'room',label:'Workshop',graph:{scope:'Partial room',sourceViews:[{viewId:'original-view',frameId:original.id,sourceHash:original.sourceHash}],nodes:['object','other'].map(id=>({id,label:id,kind:'container',status:'provisional',attributes:[],evidence:[{viewId:'original-view',basis:'Original source',location:'Original shelf'}]})),edges:[],identityGroups:[],unknowns:[],nodeOrigins:{},reviewNotes:[]}};
 memory.importInitial(initial);memory.importInitial({...initial,importId:'other-initial',roomId:'other-room'});
 function report(reference=original.sourceHash,nodeId='object'):RoomObserverResult{return {protocolVersion:2,summary:'Authored source comparison',observations:[{nodeId,label:'Angular case',kind:'container',attributes:[],status:'likely-same',basis:'Visible same assembly',alternatives:'Similar replacement remains possible',needs:'none',location:'Lower shelf',currentAppearance:{description:'Angular body with offset latch',features:[{feature:'body',description:'Angular body',visible:true},{feature:'latch',description:'Offset latch',visible:true}]},comparison:{priorSourceHashes:[reference],adequateDiscriminatingEvidence:true,limitation:'none',features:[{feature:'body',kind:'silhouette',identityRelevance:'shared-design',result:'same',currentBasis:'Angular body',historicalBasis:'Angular body',priorSourceHash:reference},{feature:'latch',kind:'construction',identityRelevance:'shared-design',result:'same',currentBasis:'Offset latch',historicalBasis:'Offset latch',priorSourceHash:reference}]}}]};}
 const publish=(job:string,second:number,input=report(),references=[original.sourceHash])=>{const frame=capture(job,second);memory.publishObservation(job,'room',frame,input,'authored-test',[],undefined,undefined,references);return frame;};
 const correction=(operationId='correct')=>({operationId,roomId:'room',nodeId:'object',linkId:memory.read().rooms[0].continuityLinks!.filter(link=>link.nodeId==='object'&&link.state==='active').at(-1)!.linkId});
 return {root,original,capture,report,publish,correction,get memory(){return memory;},restart(){memory.close();memory=new RoomMemoryStore(root);},cleanup(){memory.close();captures.close();rmSync(root,{recursive:true,force:true});}};
}

test('user correction preserves immutable evidence, falls back last seen and shows a separate source-backed entry after restart',()=>{
 const f=fixture();try{
  f.publish('earlier',1);const wrong=f.publish('wrong',2),before=f.memory.read(),request=f.correction();
  const after=f.memory.correctContinuity(request),room=after.rooms[0],correction=room.continuityCorrections![0];
  assert.equal(correction.attribution,'user');assert.equal(correction.withdrawn,false);assert.equal(room.continuityLinks![1].withdrawal!.correctionId,request.operationId);
  assert.deepEqual(room.observations,before.rooms[0].observations);assert.deepEqual(room.visits,before.rooms[0].visits);assert.deepEqual(room.graphHypotheses,before.rooms[0].graphHypotheses);
  assert.deepEqual(after.rooms[1],before.rooms[1]);assert.deepEqual(room.graph.nodes.find(node=>node.id==='other'),before.rooms[0].graph.nodes.find(node=>node.id==='other'));
  assert.equal(roomLastObservation(room,room.graph.nodes[0])!.source.frameId,'earlier');
  const separated=room.graph.nodes.find(node=>node.id===correction.separatedNodeId)!;assert.ok(separated);assert.equal(roomLastObservation(room,separated)!.source.sourceHash,wrong.sourceHash);assert.equal(roomLastObservation(room,separated)!.evidence.location,'Lower shelf');
  assert.deepEqual(f.memory.correctContinuity(request),after);assert.throws(()=>f.memory.correctContinuity({...request,nodeId:'other'}),/collision/);
  f.restart();assert.deepEqual(f.memory.read(),after);
  const undo={operationId:'undo',roomId:'room',nodeId:'object',correctionId:correction.correctionId},undone=f.memory.undoContinuityCorrection(undo);
  assert.equal(undone.rooms[0].continuityCorrections![0].withdrawn,true);assert.deepEqual(undone.rooms[0].graph,before.rooms[0].graph);assert.deepEqual(undone.rooms[0].continuityLinks,before.rooms[0].continuityLinks);
  assert.deepEqual(f.memory.undoContinuityCorrection(undo),undone);assert.deepEqual(f.memory.correctContinuity(request),undone);f.restart();assert.deepEqual(f.memory.read(),undone);
 }finally{f.cleanup();}
});

test('correction and undo roll back fully when operation journaling fails, then retry exactly once',()=>{
 const f=fixture();try{f.publish('wrong',1);const before=f.memory.read(),request=f.correction(),db=new DatabaseSync(join(f.root,'room-memory.sqlite'));
  try{
   db.exec("CREATE TRIGGER fail_correction_commit BEFORE INSERT ON room_imports WHEN NEW.import_id IN ('correct','undo') BEGIN SELECT RAISE(ABORT,'authored correction failure');END");
   assert.throws(()=>f.memory.correctContinuity(request),/authored correction failure/);assert.deepEqual(f.memory.read(),before);
   db.exec('DROP TRIGGER fail_correction_commit');const corrected=f.memory.correctContinuity(request);
   db.exec("CREATE TRIGGER fail_undo_commit BEFORE INSERT ON room_imports WHEN NEW.import_id='undo' BEGIN SELECT RAISE(ABORT,'authored undo failure');END");
   const undo={operationId:'undo',roomId:'room',nodeId:'object',correctionId:'correct'};assert.throws(()=>f.memory.undoContinuityCorrection(undo),/authored undo failure/);assert.deepEqual(f.memory.read(),corrected);
   db.exec('DROP TRIGGER fail_undo_commit');f.restart();f.memory.undoContinuityCorrection(undo);assert.equal(f.memory.read().rooms[0].continuityCorrections!.length,1);
  }finally{db.close();}
 }finally{f.cleanup();}
});

test('target scope rejects foreign assignments and undo never removes newer separated evidence',()=>{
 const f=fixture();try{f.publish('wrong',1);const request=f.correction(),before=f.memory.read();
  for(const invalid of [{...request,roomId:'other-room'},{...request,nodeId:'other'},{...request,linkId:'absent'}])assert.throws(()=>f.memory.correctContinuity(invalid),/Unknown/);assert.deepEqual(f.memory.read(),before);
  const corrected=f.memory.correctContinuity(request),separated=corrected.rooms[0].continuityCorrections![0].separatedNodeId;
  f.memory.importVisit({schemaVersion:1,importId:'separate-evidence',roomId:'room',visitId:'separate-evidence',label:'Another look',summary:'Keep separate',sourceViews:[{viewId:'separate-evidence-view',frameId:f.original.id,sourceHash:f.original.sourceHash}],proposals:[{id:'separate-proposal',nodeId:separated,status:'uncertain',observationId:'separate-observation',basis:'Additional retained evidence',evidence:[{viewId:'separate-evidence-view',basis:'Visible source'}],alternatives:'Unconfirmed'}]});
  const newer=f.memory.read();assert.throws(()=>f.memory.undoContinuityCorrection({operationId:'undo',roomId:'room',nodeId:'other',correctionId:'correct'}),/Unknown/);
  assert.throws(()=>f.memory.undoContinuityCorrection({operationId:'undo',roomId:'room',nodeId:'object',correctionId:'correct'}),/newer evidence/);assert.deepEqual(f.memory.read(),newer);f.restart();assert.deepEqual(f.memory.read(),newer);
 }finally{f.cleanup();}
});

test('undo retains newer original evidence instead of restoring its earlier last-seen location',()=>{
 const f=fixture();try{f.publish('wrong',1);f.memory.correctContinuity(f.correction());f.publish('true-original',2);const before=f.memory.read().rooms[0];assert.equal(before.continuityLinks!.at(-1)!.state,'active');
  const after=f.memory.undoContinuityCorrection({operationId:'undo',roomId:'room',nodeId:'object',correctionId:'correct'}).rooms[0];assert.equal(roomLastObservation(after,after.graph.nodes[0])!.source.frameId,'true-original');assert.deepEqual(after.observations,before.observations);assert.deepEqual(after.visits,before.visits);
 }finally{f.cleanup();}
});

test('user separation survives restart, blocks corrected source and separated lineage, and permits true original evidence',()=>{
 const f=fixture();try{
  const wrong=f.publish('wrong',1);f.memory.correctContinuity(f.correction());f.restart();
  const alias=f.capture('wrong-alias',2,1);f.memory.publishObservation('wrong-alias','room',alias,f.report(),'authored-test',[],undefined,undefined,[f.original.sourceHash]);
  let room=f.memory.read().rooms[0];assert.equal(room.continuityLinks!.filter(link=>link.nodeId==='object'&&link.state==='active').length,0);
  const separated=room.continuityCorrections![0].separatedNodeId,separateFrame=f.publish('separate-new',3,f.report(wrong.sourceHash,separated),[wrong.sourceHash]);
  room=f.memory.read().rooms[0];assert.equal(room.continuityLinks!.filter(link=>link.nodeId===separated&&link.state==='active').length,1);
  assert.throws(()=>f.publish('rejoin-wrong',4,f.report(wrong.sourceHash),[wrong.sourceHash]),/User-separated/);
  const lineageAlias=f.capture('lineage-alias',5,3);f.memory.publishObservation('lineage-alias','room',lineageAlias,f.report(),'authored-test',[],undefined,undefined,[f.original.sourceHash]);
  room=f.memory.read().rooms[0];assert.equal(room.continuityLinks!.filter(link=>link.nodeId==='object'&&link.state==='active').length,0);
  assert.equal(room.observations!.find(observation=>observation.observationId==='auto-observation-lineage-alias-0')!.source.sourceHash,separateFrame.sourceHash);
  f.publish('true-original',6);room=f.memory.read().rooms[0];assert.equal(room.continuityLinks!.filter(link=>link.nodeId==='object'&&link.state==='active').length,1);assert.equal(roomLastObservation(room,room.graph.nodes[0])!.source.frameId,'true-original');
  const saved=f.memory.read();f.restart();assert.deepEqual(f.memory.read(),saved);
 }finally{f.cleanup();}
});

test('undo cannot revive a corrected assignment contradicted by newer original-source evidence',()=>{
 const f=fixture();try{
  const wrong=f.publish('wrong',1);f.memory.correctContinuity(f.correction());
  const result=f.report(),observation=result.observations[0];observation.status='uncertain';observation.comparison!.limitation='history-conflict';observation.comparison!.priorSourceHashes.push(wrong.sourceHash);
  observation.currentAppearance!.features.push({feature:'wrong-latch',description:'Offset latch',visible:true});
  observation.comparison!.features.push({feature:'wrong-latch',kind:'construction',identityRelevance:'shared-design',result:'different',currentBasis:'Offset latch',historicalBasis:'Centered latch',priorSourceHash:wrong.sourceHash});
  f.publish('contradiction',2,result,[f.original.sourceHash,wrong.sourceHash]);const saved=f.memory.read();
  assert.throws(()=>f.memory.undoContinuityCorrection({operationId:'undo',roomId:'room',nodeId:'object',correctionId:'correct'}),/Newer evidence contradicts/);assert.deepEqual(f.memory.read(),saved);f.restart();assert.deepEqual(f.memory.read(),saved);
 }finally{f.cleanup();}
});

test('source-bound semantic uncertainty and pending explanation follow the separated observation and undo restores them',()=>{
 const f=fixture();try{
  const result=f.report(),observation=result.observations[0];observation.semanticUnknown='Exact contents remain unknown';observation.needs='explanation';observation.request='What does this case contain?';
  f.publish('wrong',1,result);const before=f.memory.read().rooms[0],actions=f.memory.actions();assert.ok(before.graph.nodes[0].semantic);
  assert.equal(before.graphHypotheses![0].evaluation.favoredHypothesis,'uncertain');
  const corrected=f.memory.correctContinuity(f.correction()).rooms[0],separated=corrected.continuityCorrections![0].separatedNodeId;
  assert.equal(corrected.graph.nodes[0].semantic,undefined);assert.deepEqual(corrected.graph.nodes[0].evidence,corrected.graph.nodeAnchorEvidence!.object);assert.equal(corrected.graph.nodes.find(node=>node.id===separated)!.semantic!.description,'Exact contents remain unknown');
  assert.equal(f.memory.actions()[0].nodeId,separated);
  const undone=f.memory.undoContinuityCorrection({operationId:'undo',roomId:'room',nodeId:'object',correctionId:'correct'}).rooms[0];assert.deepEqual(undone.graph,before.graph);assert.deepEqual(f.memory.actions(),actions);
  const separatedAgain=f.memory.correctContinuity(f.correction('correct-again')).rooms[0].continuityCorrections!.at(-1)!.separatedNodeId;
  f.memory.answerSemantic({operationId:'separate-answer',roomId:'room',nodeId:separatedAgain,label:'My parts case'});assert.equal(f.memory.actions()[0].status,'resolved');
  assert.throws(()=>f.memory.undoContinuityCorrection({operationId:'undo-again',roomId:'room',nodeId:'object',correctionId:'correct-again'}),/newer evidence/);
 }finally{f.cleanup();}
});

test('ordinary protocol2 uncertainty can publish without creating a user question',()=>{
 const f=fixture();try{
  const result=f.report();result.observations[0].status='uncertain';result.observations[0].comparison!.adequateDiscriminatingEvidence=false;
  f.publish('uncertain-no-question',1,result);const room=f.memory.read().rooms[0];assert.equal(room.visits.length,1);assert.equal(room.continuityLinks!.length,0);assert.deepEqual(f.memory.actions(),[]);
 }finally{f.cleanup();}
});

test('later semantic explanation can update a separated entry, while corrected-source aliases cannot mutate the original',()=>{
 const f=fixture();try{
  const wrong=f.publish('wrong',1);const separated=f.memory.correctContinuity(f.correction()).rooms[0].continuityCorrections![0].separatedNodeId;
  const later=f.report(wrong.sourceHash,separated);later.observations[0].semanticUnknown='Which parts belong in this separate case?';later.observations[0].needs='explanation';later.observations[0].request='What is kept here?';
  const separateFrame=f.publish('separate-semantic',2,later,[wrong.sourceHash]);let room=f.memory.read().rooms[0];assert.equal(room.graph.nodes.find(node=>node.id===separated)!.semantic!.description,'Which parts belong in this separate case?');assert.equal(f.memory.actions()[0].nodeId,separated);
  for(const [job,second,pixels] of [['wrong-alias-semantic',3,1],['lineage-alias-semantic',4,2]] as const){
   const frame=f.capture(job,second,pixels),alias=f.report();alias.observations[0].semanticUnknown='This must not mutate the original';alias.observations[0].needs='explanation';alias.observations[0].request='What is this?';
   f.memory.publishObservation(job,'room',frame,alias,'authored-test',[],undefined,undefined,[f.original.sourceHash]);room=f.memory.read().rooms[0];assert.equal(room.graph.nodes[0].semantic,undefined);assert.deepEqual(room.graph.nodes[0].evidence,room.graph.nodeAnchorEvidence!.object);
   assert.equal(f.memory.actions().filter(action=>action.nodeId==='object').length,0);assert.equal(f.memory.actions().filter(action=>action.jobId===job).length,0);
  }
  assert.ok(room.observations!.some(observation=>observation.source.sourceHash===separateFrame.sourceHash));const saved=f.memory.read();f.restart();assert.deepEqual(f.memory.read(),saved);
 }finally{f.cleanup();}
});

test('correction HTTP enforces same origin, explicit target and idempotent user attribution',async()=>{
 const f=fixture();f.publish('wrong',1);const app=Fastify();registerRoomMemoryRoutes(app,f.root);
 try{const request=f.correction(),send=(payload:Record<string,unknown>,headers={})=>app.inject({method:'POST',url:'/api/scan/room-memory/continuity/correct',payload,headers});
  assert.equal((await send(request,{origin:'http://elsewhere'})).statusCode,403);assert.equal((await send(request,{'sec-fetch-site':'cross-site'})).statusCode,403);
  assert.equal((await send({...request,nodeId:'other'})).statusCode,400);assert.equal((await send({...request,attribution:'agent'})).statusCode,400);
  const accepted=await send(request,{origin:'http://localhost:80'});assert.equal(accepted.statusCode,200);assert.equal(accepted.json().rooms[0].continuityCorrections[0].attribution,'user');assert.deepEqual((await send(request)).json(),accepted.json());
  assert.equal((await send({...request,operationId:'second'})).statusCode,409);
  assert.equal((await app.inject({method:'POST',url:'/api/scan/room-memory/continuity/undo',payload:{operationId:'undo',roomId:'room',nodeId:'object',correctionId:'correct'}})).statusCode,200);
 }finally{await app.close();f.cleanup();}
});

test('correction undo protects active personal metadata but permits fully undone edits',()=>{
 const f=fixture();try{f.publish('wrong',1);const separated=f.memory.correctContinuity(f.correction()).rooms[0].continuityCorrections![0].separatedNodeId;
  const edit={operationId:'personal-edit',roomId:'room',nodeId:separated,expectedRevision:0,text:'Name it Özel'};
  f.memory.applyUserEdit(edit,{status:'apply',reply:'Saved',changes:[{kind:'name',value:'Özel'}]});const undo={operationId:'undo-correction',roomId:'room',nodeId:'object',correctionId:'correct'};
  assert.throws(()=>f.memory.undoContinuityCorrection(undo),/newer evidence/);
  f.memory.undoUserEdit({operationId:'undo-personal',roomId:'room',nodeId:separated,expectedRevision:1,revisionId:'personal-edit'});f.restart();
  assert.equal(f.memory.undoContinuityCorrection(undo).rooms[0].continuityCorrections![0].withdrawn,true);
 }finally{f.cleanup();}
});

test('visual containment follows identity corrections to either endpoint and restores on undo',()=>{
 for(const correctedNode of ['object','other']){const f=fixture();try{
  const frame=f.publish('inside',1,f.report(f.original.sourceHash,correctedNode));let room=f.memory.read().rooms[0];
  const source=room.visits[0].sourceViews[0],record={operationId:'visual',roomId:'room',itemId:'object',containerId:'other',action:'put-in',statement:'Visible item inside box',attribution:'model',recordedAt:frame.capturedAt,source};
  const db=new DatabaseSync(join(f.root,'room-memory.sqlite'));db.prepare('INSERT INTO room_containment_ops VALUES(?,?,?,?)').run('visual','room',JSON.stringify(record),JSON.stringify(record));db.close();room=f.memory.read().rooms[0];assert.equal(room.containment!.active.length,1);assert.equal(room.containment!.events.length,1);
  const link=room.continuityLinks!.find(l=>l.nodeId===correctedNode&&l.state==='active')!;assert.ok(link);
  room=f.memory.correctContinuity({operationId:'correct',roomId:'room',nodeId:correctedNode,linkId:link.linkId}).rooms[0];assert.equal(room.containment!.active.length,0);assert.equal(room.containment!.events.length,1);assert.equal(room.containment!.events[0].withdrawn,false);
  room=f.memory.undoContinuityCorrection({operationId:'undo',roomId:'room',nodeId:correctedNode,correctionId:'correct'}).rooms[0];assert.equal(room.containment!.active.length,1);
 }finally{f.cleanup();}}
});
