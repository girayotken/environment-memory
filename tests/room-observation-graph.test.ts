import test from 'node:test';
import assert from 'node:assert/strict';
import type {RoomMemory,RoomObservationView,RoomSourceView,RoomFeatureComparisonSchema} from '../src/domain/room-memory-contracts.ts';
import type {z} from 'zod';
import {evaluateRoomObservationGraph,type RoomObservationCandidate} from '../src/domain/room-observation-graph.ts';

const original:RoomSourceView={viewId:'original-view',frameId:'original-frame',sourceHash:'a'.repeat(64),capturedAt:'2026-10-28T10:00:00Z',imageUrl:'/original.png'};
const current:RoomSourceView={viewId:'current-view',frameId:'current-frame',sourceHash:'b'.repeat(64),capturedAt:'2026-10-29T10:00:00Z',imageUrl:'/current.png'};
function fixture(kinds:Array<z.infer<typeof RoomFeatureComparisonSchema>['kind']>=['construction','part-layout']){
 const room:RoomMemory={roomId:'room',label:'Workshop',provenance:'agent-derived',graph:{scope:'Partial room',sourceViews:[original],nodes:[{id:'candidate',label:'Object',kind:'container',status:'provisional',attributes:[],evidence:[{viewId:original.viewId,basis:'Original object appearance'}]},{id:'support',label:'Support',kind:'support',status:'provisional',attributes:[],evidence:[{viewId:original.viewId,basis:'Support visible'}]}],edges:[{from:'candidate',to:'support',relation:'on',status:'observed',evidence:[{viewId:original.viewId,basis:'Object rests on support'}]}],identityGroups:[],unknowns:[],nodeOrigins:{},reviewNotes:[],nodeAnchorEvidence:{candidate:[{viewId:original.viewId,basis:'Original anchor'}]}},visits:[]};
 const observation:RoomObservationView={observationId:'observation',jobId:'job',roomId:'room',source:current,capturedAt:current.capturedAt,provenance:'authored-test',label:'Current object',kind:'container',attributes:[],basis:'Visible current appearance',currentAppearance:{description:'Current object details',features:kinds.map((kind,index)=>({feature:`detail-${index}`,description:`Current ${kind} detail`,visible:true}))}};
 const candidate:RoomObservationCandidate={candidateNodeId:'candidate',status:'likely-same',alternatives:'Identity provisional',comparison:{priorSourceHashes:[original.sourceHash],adequateDiscriminatingEvidence:true,limitation:'none',features:kinds.map((kind,index)=>({feature:`detail-${index}`,kind,identityRelevance:kind==='markings'?'potentially-instance-specific' as const:'shared-design' as const,result:'same',currentBasis:kind==='markings'?'Current authored serial reads QX-907':`Current ${kind}`,historicalBasis:kind==='markings'?'Original authored serial reads QX-907':`Original ${kind}`,priorSourceHash:original.sourceHash}))}};
 return {room,observation,candidate};
}
test('generic multi-feature matches stay uncertain while retaining three sourced alternatives',()=>{
 const f=fixture(),evaluation=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.equal(evaluation.favoredHypothesis,'uncertain');assert.equal(evaluation.appearance,'matching');assert.equal(evaluation.identityStatus,'provisional');
 assert.equal(evaluation.evidenceConditioning,'context-conditioned');
 assert.deepEqual(evaluation.alternatives.map(alternative=>alternative.hypothesis),['same-object','similar-other','uncertain']);
 assert.ok(evaluation.alternatives.every(alternative=>alternative.support.length&&alternative.missingEvidence.length));
 assert.ok(evaluation.alternatives[0].support.some(item=>item.sources.some(source=>source.sourceHash===original.sourceHash)));
 assert.equal('nodeId' in f.observation,false);assert.equal('raw' in f.observation,false);
});
test('authored instance-specific serial may favor same-object provisionally; contradictory detail stays unresolved',()=>{
 const f=fixture(['markings','construction']);let result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.equal(result.favoredHypothesis,'same-object');assert.equal(result.identityStatus,'provisional');assert.ok(result.alternatives[1].support.length);
 f.candidate.comparison!.features[1].result='different';result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.equal(result.favoredHypothesis,'uncertain');assert.equal(result.appearance,'conflicting');
});
test('shared logos, unassessed markings and absent legacy identity relevance never favor same-object',()=>{
 for(const relevance of ['shared-design','unassessed',undefined] as const){
  const f=fixture(['markings']),feature=f.candidate.comparison!.features[0];
  feature.currentBasis='Generic logo visible';feature.historicalBasis='The same generic logo visible';
  if(relevance===undefined)delete feature.identityRelevance;else feature.identityRelevance=relevance;
  const result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
  assert.equal(result.favoredHypothesis,'uncertain');assert.equal(result.appearance,'matching');
  assert.ok(result.alternatives[0].support.some(item=>item.basis.includes(`identity relevance: ${relevance??'unassessed'}`)));
 }
});
test('authored potentially instance-specific scuff supports only provisional same-object',()=>{
 const f=fixture(['markings']),feature=f.candidate.comparison!.features[0];
 feature.currentBasis='Authored diagonal scuff crosses the serial plate';feature.historicalBasis='Authored diagonal scuff crosses the serial plate';
 const result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.equal(result.favoredHypothesis,'same-object');assert.equal(result.identityStatus,'provisional');
 assert.ok(result.alternatives[0].support.some(item=>item.basis.includes('model assertion, not proof of uniqueness')));
 assert.equal(result.alternatives[1].assessment,'possible');
});
test('original visible contradiction favors similar-other despite generic matches and retains object-change alternative',()=>{
 const f=fixture();f.candidate.comparison!.features[1].result='different';
 const result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.equal(result.favoredHypothesis,'similar-other');assert.equal(result.identityStatus,'provisional');
 assert.ok(result.alternatives[0].counterEvidence.some(item=>item.kind==='original-comparison'));
 assert.ok(result.alternatives[1].counterEvidence.some(item=>item.basis.includes('change on the same object')));
});
test('movement and graph relations are context, never identity proof',()=>{
 const f=fixture(['location','category']);f.candidate.comparison!.features[0].result='different';
 const before=structuredClone(f),result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.equal(result.favoredHypothesis,'uncertain');assert.equal(result.appearance,'matching');
 assert.equal(result.contextRelations[0].relation,'on');assert.ok(result.contextRelations[0].evidence[0].basis.includes('context only'));
 assert.deepEqual(f,before);
});
test('tentative later matches cannot be recycled into independent original support',()=>{
 const f=fixture(['markings']);const later={...original,viewId:'later-view',frameId:'later-frame',sourceHash:'c'.repeat(64),capturedAt:'2026-10-28T16:00:00Z'};
 f.room.visits.push({schemaVersion:1,importId:'later-import',roomId:'room',visitId:'later-visit',label:'Tentative visit',summary:'A tentative match',sourceViews:[later],provenance:'authored-test',proposals:[{id:'later-proposal',nodeId:'candidate',observationId:'later-observation',status:'likely-same',basis:'Tentative same',alternatives:'Could be a replacement',evidence:[{viewId:later.viewId,basis:'Later appearance'}]}]});
 f.candidate.comparison!.features[0].priorSourceHash=later.sourceHash;f.candidate.comparison!.priorSourceHashes=[later.sourceHash];
 const result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.equal(result.favoredHypothesis,'uncertain');assert.equal(result.appearance,'insufficient');
 assert.ok(result.alternatives[2].support.some(item=>item.kind==='later-comparison'));
});
test('unbound, future, self-source and invisible comparisons cannot favor an identity',()=>{
 for(const mode of ['unbound','future','self-source','invisible'] as const){
  const f=fixture(['markings']);
  if(mode==='unbound')f.candidate.comparison!.features[0].priorSourceHash='d'.repeat(64);
  if(mode==='future')f.room.graph.sourceViews=[{...original,capturedAt:'2026-10-30T10:00:00Z'}];
  if(mode==='self-source'){f.observation.source={...current,sourceHash:original.sourceHash};}
  if(mode==='invisible')f.observation.currentAppearance!.features[0].visible=false;
  const result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);assert.equal(result.favoredHypothesis,'uncertain',mode);
 }
});
test('unassigned and other-candidate evaluations preserve one observation and expose missing comparison',()=>{
 const f=fixture(['markings']),snapshot=structuredClone(f.observation);
 const unmatched=evaluateRoomObservationGraph(f.room,f.observation,{candidateNodeId:null});
 const other=evaluateRoomObservationGraph(f.room,f.observation,{candidateNodeId:'support'});
 assert.equal(unmatched.favoredHypothesis,'uncertain');assert.equal(other.favoredHypothesis,'uncertain');
 assert.equal(unmatched.observationId,other.observationId);assert.deepEqual(f.observation,snapshot);
 assert.ok(unmatched.alternatives[0].missingEvidence.length);
});
test('the same records and candidate yield the same evaluation without percentages or mutation',()=>{
 const f=fixture(['markings']),before=structuredClone(f);
 const a=evaluateRoomObservationGraph(f.room,f.observation,f.candidate),b=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.deepEqual(a,b);assert.deepEqual(f,before);assert.equal('probability' in a,false);assert.equal('confidence' in a,false);
 a.alternatives[0].support[0].sources[0].sourceHash='changed';assert.deepEqual(f,before);
});
test('a distinctive match cannot override an explicitly inadequate comparison',()=>{
 const f=fixture(['markings']);f.candidate.comparison!.adequateDiscriminatingEvidence=false;
 const result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.equal(result.favoredHypothesis,'uncertain');assert.equal(result.appearance,'matching');
 assert.ok(result.alternatives[0].missingEvidence.some(item=>item.basis.includes('does not assert adequate')));
});
test('actual later appearance contradiction blocks same-object despite declared no limitation',()=>{
 const f=fixture(['markings','construction']);const later={...original,viewId:'later-view',frameId:'later-frame',sourceHash:'c'.repeat(64),capturedAt:'2026-10-28T16:00:00Z'};
 f.room.visits.push({schemaVersion:1,importId:'later-import',roomId:'room',visitId:'later-visit',label:'Tentative visit',summary:'A tentative match',sourceViews:[later],provenance:'authored-test',proposals:[{id:'later-proposal',nodeId:'candidate',observationId:'later-observation',status:'likely-same',basis:'Tentative same',alternatives:'Could be a replacement',evidence:[{viewId:later.viewId,basis:'Later appearance'}]}]});
 const comparison=f.candidate.comparison!;comparison.priorSourceHashes.push(later.sourceHash);comparison.features[1].priorSourceHash=later.sourceHash;comparison.features[1].result='different';
 const result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.equal(result.favoredHypothesis,'uncertain');assert.equal(result.appearance,'conflicting');
 assert.ok(result.alternatives[0].counterEvidence.some(item=>item.kind==='later-comparison'));
});
test('an earlier tentative alias of a future original hash cannot become original evidence',()=>{
 const f=fixture(['markings']);f.room.graph.sourceViews=[{...original,capturedAt:'2026-10-30T10:00:00Z'}];
 const alias={...original,viewId:'earlier-alias-view',frameId:'alias-frame',capturedAt:'2026-10-28T16:00:00Z'};
 f.room.visits.push({schemaVersion:1,importId:'alias-import',roomId:'room',visitId:'alias-visit',label:'Tentative visit',summary:'A tentative same-hash alias',sourceViews:[alias],provenance:'authored-test',proposals:[{id:'alias-proposal',nodeId:'candidate',observationId:'alias-observation',status:'likely-same',basis:'Tentative same',alternatives:'Could be a replacement',evidence:[{viewId:alias.viewId,basis:'Tentative alias appearance'}]}]});
 const result=evaluateRoomObservationGraph(f.room,f.observation,f.candidate);
 assert.equal(result.favoredHypothesis,'uncertain');assert.equal(result.appearance,'insufficient');
 assert.equal(result.alternatives[0].support.filter(item=>item.kind==='original-comparison').length,0);
 assert.ok(result.alternatives[0].missingEvidence.some(item=>item.basis.includes('No earlier original')));
});
