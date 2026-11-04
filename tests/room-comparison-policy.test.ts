import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {CaptureStore} from '../src/server/capture-store.ts';
import {RoomMemoryStore} from '../src/server/room-memory-store.ts';
import {parseRoomObserverOutput,roomObserverRequest} from '../src/server/room-observer-provider.ts';
import {validateRoomActionAssessments,type RoomObserverInput,type RoomObserverResult,type RoomActionNeeded} from '../src/domain/room-observer-contracts.ts';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'room-comparison-')),captures=new CaptureStore(root);
 const image=(shade:number)=>{const png=new PNG({width:4,height:4});png.data.fill(shade);return PNG.sync.write(png);},old=image(60),current=image(180),later=image(100);
 const frames=captures.import({importId:'sources',frames:[{id:'original',sessionId:'session',capturedAt:'2026-10-28T12:00:00Z',imageDataUrl:`data:image/png;base64,${old.toString('base64')}`},{id:'current',sessionId:'session',capturedAt:'2026-10-29T12:00:00Z',imageDataUrl:`data:image/png;base64,${current.toString('base64')}`},{id:'later-match',sessionId:'session',capturedAt:'2026-10-29T10:00:00Z',imageDataUrl:`data:image/png;base64,${later.toString('base64')}`}]});captures.close();
 const source={viewId:'original-view',frameId:frames[0].id,sourceHash:frames[0].sourceHash},store=new RoomMemoryStore(root);
 const room=store.importInitial({schemaVersion:1,importId:'initial',roomId:'room',label:'Workshop',graph:{scope:'Partial room',sourceViews:[source],nodes:[{id:'case',label:'Case',kind:'container',status:'provisional',attributes:[],evidence:[{viewId:source.viewId,basis:'Original construction visible'}]}],edges:[],identityGroups:[],unknowns:[],nodeOrigins:{},reviewNotes:[]}}).rooms[0];
 const input:RoomObserverInput={room,frame:frames[1],frameBytes:current,references:[{source:room.graph.sourceViews[0],bytes:old}],comparisonNodeIds:['case']};
 return {root,input,store,laterFrame:frames[2],laterReference:{source:{viewId:'later-view',frameId:frames[2].id,sourceHash:frames[2].sourceHash,capturedAt:frames[2].capturedAt,imageUrl:frames[2].imageUrl},bytes:later},cleanup:()=>{store.close();rmSync(root,{recursive:true,force:true});}};
}
function result(input:RoomObserverInput):RoomObserverResult{
 const sourceHash=input.references[0].source.sourceHash;
 return {protocolVersion:2,summary:'Current case construction comparison remains provisional.',observations:[{nodeId:'case',label:'Blue rectangular case',kind:'container',attributes:[],status:'likely-same',basis:'Inset construction and latch layout agree in these sources.',alternatives:'Physical identity and an identical replacement remain unresolved.',needs:'none',currentAppearance:{description:'Rectangular case with recessed front and two front latches.',features:[{feature:'front inset',description:'Visible recessed front panel.',visible:true},{feature:'latch layout',description:'Two front latches visible.',visible:true}]},comparison:{priorSourceHashes:[sourceHash],limitation:'none',adequateDiscriminatingEvidence:true,features:[{feature:'front inset',kind:'construction',result:'same',currentBasis:'Recessed front panel visible.',historicalBasis:'Recessed front panel visible in original.',priorSourceHash:sourceHash},{feature:'latch layout',kind:'part-layout',result:'same',currentBasis:'Two front latches visible.',historicalBasis:'Two front latches visible in original.',priorSourceHash:sourceHash}]}}]};
}
const parse=(value:unknown,input:RoomObserverInput)=>parseRoomObserverOutput(JSON.stringify(value),input);
test('new wire requires separated current pixels and exact original source comparisons; legacy fixtures are explicit',()=>{
 const f=fixture();try{const valid=result(f.input),parsed=parse(valid,f.input);assert.deepEqual(parsed,valid);const request=roomObserverRequest(f.input);assert.ok(request.text.format.schema.required.includes('protocolVersion'));
  const legacy={summary:'Saved old protocol',observations:valid.observations.map(({currentAppearance,comparison,...old})=>old)};
  assert.throws(()=>parse(legacy,f.input),/protocol version 2/);assert.equal(parseRoomObserverOutput(JSON.stringify(legacy),f.input,{testOnlyLegacyFixtures:true}).observations.length,1);
  for(const mutation of ['missing-current','wrong-hash','unseen','contradiction','wrong-feature'] as const){const bad=structuredClone(valid),o=bad.observations[0],c=o.comparison!;
   if(mutation==='missing-current')delete o.currentAppearance;
   if(mutation==='wrong-hash')c.features[0].priorSourceHash='a'.repeat(64);
   if(mutation==='unseen'){c.features.forEach(f=>f.result='not-visible');o.currentAppearance!.features.forEach(f=>f.visible=false);}
   if(mutation==='contradiction')c.features[0].result='different';
   if(mutation==='wrong-feature')c.features[0].feature='unreported feature';
   assert.throws(()=>parse(bad,f.input),mutation);
  }
 }finally{f.cleanup();}
});
test('insufficient current detail asks a targeted view while poor historical detail stops repeated current requests',()=>{
 const f=fixture();try{const uncertain=result(f.input),o=uncertain.observations[0];o.status='uncertain';o.needs='view';o.request='Show the front inset and latch arrangement straight on.';o.comparison!.limitation='current-detail';o.comparison!.adequateDiscriminatingEvidence=false;o.comparison!.features[0].result='not-visible';o.currentAppearance!.features[0].visible=false;assert.doesNotThrow(()=>parse(uncertain,f.input));
  const historyOnly=structuredClone(uncertain),h=historyOnly.observations[0];h.needs='none';delete h.request;h.comparison!.limitation='historical-detail';h.currentAppearance!.features[0].visible=true;h.basis='Current detail is visible, but the supplied original is too coarse for this comparison.';assert.doesNotThrow(()=>parse(historyOnly,f.input));
  const colourChange=result(f.input),colour=colourChange.observations[0];colour.comparison!.features[0].kind='colour';colour.comparison!.features[0].result='different';assert.throws(()=>parse(colourChange,f.input),/Likely-same/);colour.status='different';assert.doesNotThrow(()=>parse(colourChange,f.input));
  h.needs='view';h.request='Show it again.';assert.throws(()=>parse(historyOnly,f.input),/new view request/);
  const unmatched=structuredClone(uncertain),u=unmatched.observations[0];u.nodeId=null;u.comparison!.features=[];u.comparison!.priorSourceHashes=[];assert.throws(()=>parse(unmatched,f.input),/outside the requested comparison scope|Requested comparison nodes/);
 }finally{f.cleanup();}
});
test('persisted v2 comparison survives restart and does not replace original evidence',()=>{
 const f=fixture();try{const original=structuredClone(f.input.room.graph.nodeAnchorEvidence),value=result(f.input);f.store.publishObservation('comparison','room',f.input.frame,value,'agent-derived',[],undefined,['case'],f.input.references.map(r=>r.source.sourceHash));const room=f.store.read().rooms[0],proposal=room.visits[0].proposals[0];assert.deepEqual(proposal.currentAppearance,value.observations[0].currentAppearance);assert.deepEqual(proposal.comparison,value.observations[0].comparison);assert.deepEqual(room.graph.nodeAnchorEvidence,original);assert.equal(room.graph.nodes[0].status,'provisional');assert.equal(room.graph.nodes[0].evidence[0].viewId,'original-view');const reopened=new RoomMemoryStore(f.root);try{assert.deepEqual(reopened.read().rooms[0].visits[0].proposals[0].comparison,proposal.comparison);}finally{reopened.close();}
  assert.throws(()=>f.store.publishObservation('forged','room',f.input.frame,value,'agent-derived',[],undefined,['case'],[]),/actually supplied/);
 }finally{f.cleanup();}
});
test('visible detail can answer a view request independently of identity; current gaps and semantic meaning cannot',()=>{
 const f=fixture();try{const action:RoomActionNeeded={actionId:'request',jobId:'old',roomId:'room',nodeId:'case',kind:'view',request:'Show the latch layout',sourceHash:f.input.references[0].source.sourceHash,status:'open',createdAt:'2026-10-28T13:00:00Z'},value=result(f.input),o=value.observations[0];o.status='different';o.comparison!.features[0].result='different';value.actionAssessments=[{actionId:action.actionId,nodeId:'case',sourceHash:action.sourceHash,status:'addressed',basis:'The close image shows a flat front, answering the requested construction detail.'}];f.input.pendingActions=[action];assert.doesNotThrow(()=>parse(value,f.input));
  assert.throws(()=>validateRoomActionAssessments(value,[{...action,kind:'explanation'}],'room',f.input.frame.sourceHash),/semantic explanations/);
  o.semanticUnknown='The intended use is unknown.';assert.throws(()=>validateRoomActionAssessments(value,[action],'room',f.input.frame.sourceHash),/semantic explanations/);delete o.semanticUnknown;o.status='uncertain';assert.doesNotThrow(()=>validateRoomActionAssessments(value,[action],'room',f.input.frame.sourceHash));o.comparison!.limitation='current-detail';assert.throws(()=>validateRoomActionAssessments(value,[action],'room',f.input.frame.sourceHash),/usable current/);
 }finally{f.cleanup();}
});

test('visible requested detail closes its exact action while an original detail gap preserves identity uncertainty',()=>{
 const f=fixture();try{
  const question=result(f.input),q=question.observations[0];q.status='uncertain';q.needs='view';q.request='Show the front inset and latch layout clearly.';q.comparison!.limitation='current-detail';q.comparison!.adequateDiscriminatingEvidence=false;q.comparison!.features[0].result='not-visible';q.currentAppearance!.features[0].visible=false;
  f.store.publishObservation('detail-question','room',f.laterFrame,question,'authored-test',[],undefined,['case'],f.input.references.map(r=>r.source.sourceHash));
  const action=f.store.actions()[0],answer=result(f.input),o=answer.observations[0];
  o.status='uncertain';o.comparison!.limitation='historical-detail';o.basis='The requested inset and latch layout are now visible, but the original does not resolve a separate lid seam; physical identity remains uncertain.';
  o.currentAppearance!.features.push({feature:'lid seam',description:'A narrow seam is visible along the upper edge.',visible:true});
  o.comparison!.features.push({feature:'lid seam',kind:'surface-detail',result:'not-visible',currentBasis:'Upper lid seam is visible in the current close view.',historicalBasis:'The original angle does not resolve this seam.',priorSourceHash:f.input.references[0].source.sourceHash});
  answer.actionAssessments=[{actionId:action.actionId,nodeId:action.nodeId,sourceHash:action.sourceHash,status:'addressed',basis:'The new close view exposes the recessed front and two front latches requested by this action; the separate historical seam comparison remains unresolved.'}];
  f.input.pendingActions=[action];
  const working=structuredClone(answer);working.observations[0].status='likely-same';assert.doesNotThrow(()=>parse(working,f.input));
  const parsed=parse(answer,f.input);assert.equal(parsed.observations[0].needs,'none');assert.equal(parsed.observations[0].request,undefined);
  const followup={actionId:action.actionId,nodeId:action.nodeId,request:action.request,sourceHash:action.sourceHash};
  f.store.publishObservation('detail-answer','room',f.input.frame,parsed,'authored-test',[action],followup,['case'],f.input.references.map(r=>r.source.sourceHash));
  const resolved=f.store.actions().find(item=>item.actionId===action.actionId)!,room=f.store.read().rooms[0];
  assert.equal(resolved.status,'resolved');assert.equal(resolved.resolution?.jobId,'detail-answer');assert.equal(resolved.resolution?.frameId,f.input.frame.id);assert.equal(resolved.resolution?.sourceHash,f.input.frame.sourceHash);
  assert.equal(room.graphHypotheses!.at(-1)!.evaluation.favoredHypothesis,'uncertain');
  assert.equal(room.visits.at(-1)!.proposals[0].comparison!.limitation,'historical-detail');assert.equal(room.visits.at(-1)!.proposals[0].comparison!.features.at(-1)!.result,'not-visible');
 }finally{f.cleanup();}
});

test('later source-bound appearance can support a reversible working assignment',()=>{
 const f=fixture();try{const source=f.laterReference.source;f.input.room.visits.push({schemaVersion:1,importId:'later',roomId:'room',visitId:'later',label:'Later provisional check',summary:'Coarse case appearance',sourceViews:[source],provenance:'agent-derived',proposals:[{id:'later-proposal',nodeId:'case',observationId:'later-observation',status:'likely-same',basis:'Coarse appearance only',alternatives:'Identity unresolved',evidence:[{viewId:source.viewId,basis:'Case visible'}]}]});
  f.input.references=[f.laterReference];const value=result(f.input);assert.doesNotThrow(()=>parse(value,f.input));
  f.input.room.graph.nodeAnchorEvidence!.case=[{viewId:'original-view',basis:'Original case'}];f.input.room.graph.nodes[0].evidence.push({viewId:source.viewId,basis:'Later semantic update'});assert.doesNotThrow(()=>parse(value,f.input));
 }finally{f.cleanup();}
});

test('an answered different appearance remains usable resolved context in the next request',()=>{
 const f=fixture();try{
  const initial=result(f.input),needs=initial.observations[0];needs.status='uncertain';needs.needs='view';needs.request='Show the front inset clearly.';needs.comparison!.limitation='current-detail';needs.comparison!.adequateDiscriminatingEvidence=false;needs.comparison!.features[0].result='not-visible';needs.currentAppearance!.features[0].visible=false;
  f.store.publishObservation('needs-detail','room',f.laterFrame,initial,'authored-test',[],undefined,['case'],f.input.references.map(r=>r.source.sourceHash));
  const action=f.store.actions()[0],answer=result(f.input),answered=answer.observations[0];answered.status='different';answered.comparison!.features[0].result='different';answer.actionAssessments=[{actionId:action.actionId,nodeId:action.nodeId,sourceHash:action.sourceHash,status:'addressed',basis:'The new close view shows the front is flat, answering the inset question.'}];
  f.store.publishObservation('answered-detail','room',f.input.frame,answer,'authored-test',[action],undefined,['case'],f.input.references.map(r=>r.source.sourceHash));
  const resolved=f.store.actions()[0];assert.equal(resolved.status,'resolved');
  const png=new PNG({width:4,height:4});png.data.fill(210);const bytes=PNG.sync.write(png),captures=new CaptureStore(f.root);
  const frame=captures.import({importId:'next-source',frames:[{id:'next',sessionId:'session',capturedAt:'2026-10-30T12:00:00Z',imageDataUrl:`data:image/png;base64,${bytes.toString('base64')}`} ]}).find(item=>item.id==='next')!;captures.close();
  const room=f.store.read().rooms[0],answeredSource=room.visits.find(v=>v.visitId==='auto-visit-answered-detail')!.sourceViews[0];
  const request=roomObserverRequest({room,frame,frameBytes:bytes,references:[f.input.references[0],{source:answeredSource,bytes:f.input.frameBytes}],resolvedViewActions:[resolved]});
  const packet=JSON.parse((request.input[1].content[0] as {text:string}).text);assert.equal(packet.memory.resolvedViewDetails[0].answeredSource.sourceHash,f.input.frame.sourceHash);assert.equal(packet.memory.resolvedViewDetails[0].assessment,answer.actionAssessments[0].basis);
 }finally{f.cleanup();}
});

test('scoped requests explicitly reserve observations for exact targets and reject context extras',()=>{
 const f=fixture();try{const request=roomObserverRequest(f.input),instructions=String(request.input[0].content);assert.ok(instructions.includes('return exactly one observation for each requested node ID'));assert.ok(instructions.includes('Do not emit additional observations or null node IDs'));assert.ok(instructions.includes('Related supports and other nodes are comparison context only'));
  const extra=result(f.input),unmatched=structuredClone(extra.observations[0]);unmatched.nodeId=null;unmatched.status='uncertain';unmatched.comparison={priorSourceHashes:[],features:[],limitation:'historical-detail',adequateDiscriminatingEvidence:false};extra.observations.push(unmatched);assert.throws(()=>parse(extra,f.input),/outside the requested comparison scope/);
 }finally{f.cleanup();}
});

test('visible original agreement plus a later contradiction permits historical conflict without a new view',()=>{
 const f=fixture();try{
  const later=f.laterReference.source;f.input.room=f.store.importVisit({schemaVersion:1,importId:'later-check',roomId:'room',visitId:'later-check',label:'Later appearance',summary:'Later saved appearance',sourceViews:[{viewId:later.viewId,frameId:later.frameId,sourceHash:later.sourceHash}],proposals:[{id:'later-check',nodeId:'case',observationId:'later-check',status:'likely-same',basis:'A later yellow appearance',alternatives:'Identity provisional',evidence:[{viewId:later.viewId,basis:'Yellow housing visible'}]}]}).rooms[0];
  f.input.references.push(f.laterReference);const value=result(f.input),o=value.observations[0],c=o.comparison!;o.status='uncertain';o.needs='none';o.basis='Current construction agrees with the original, but the later yellow appearance conflicts with current blue colour.';o.currentAppearance!.features.push({feature:'body colour',description:'Blue body visible.',visible:true});c.limitation='history-conflict';c.priorSourceHashes.push(later.sourceHash);c.features.push({feature:'body colour',kind:'colour',result:'different',currentBasis:'Blue body visible.',historicalBasis:'Later saved appearance has a yellow body.',priorSourceHash:later.sourceHash});assert.doesNotThrow(()=>parse(value,f.input));
  f.store.publishObservation('conflict','room',f.input.frame,value,'authored-test',[],undefined,['case'],f.input.references.map(reference=>reference.source.sourceHash));assert.equal(f.store.read().rooms[0].visits.at(-1)!.proposals[0].comparison!.limitation,'history-conflict');
  for(const mutation of ['no-conflict','no-original','view-request'] as const){const bad=structuredClone(value),b=bad.observations[0];if(mutation==='no-conflict')b.comparison!.features.at(-1)!.result='same';if(mutation==='no-original')b.comparison!.features.splice(0,2);if(mutation==='view-request'){b.needs='view';b.request='Show it again.';}assert.throws(()=>parse(bad,f.input),mutation);}
 }finally{f.cleanup();}
});

test('normal probable-same keeps partial detail without a question or physical identity assertion',()=>{
 const f=fixture();try{for(const limitation of ['none','current-detail','historical-detail','both'] as const){
  const value=result(f.input),o=value.observations[0];o.comparison!.adequateDiscriminatingEvidence=false;o.comparison!.limitation=limitation;o.comparison!.features[0].kind='colour';o.comparison!.features[1].result='not-visible';o.currentAppearance!.features[1].visible=false;
  const parsed=parse(value,f.input);assert.equal(parsed.observations[0].status,'likely-same');assert.equal(parsed.observations[0].needs,'none');assert.equal(parsed.observations[0].comparison!.features[1].result,'not-visible');
  o.status='uncertain';assert.equal(parse(value,f.input).observations[0].status,'uncertain','no forced question or promotion');
 }}finally{f.cleanup();}
});

test('reversible state changes preserve probable continuity but cannot support it alone',()=>{
 const f=fixture();try{const value=result(f.input),o=value.observations[0],hash=f.input.references[0].source.sourceHash;
 o.currentAppearance!.features.push({feature:'lid position',description:'Lid closed',visible:true});o.comparison!.features.push({feature:'lid position',kind:'state',result:'different',currentBasis:'Closed lid',historicalBasis:'Open lid',priorSourceHash:hash});
 assert.doesNotThrow(()=>parse(value,f.input));
 o.comparison!.features[0].result='different';assert.throws(()=>parse(value,f.input),/Likely-same/);
 o.comparison!.features=o.comparison!.features.filter(feature=>feature.kind==='state');o.comparison!.features[0].result='same';assert.throws(()=>parse(value,f.input),/Likely-same/);
 }finally{f.cleanup();}
});
