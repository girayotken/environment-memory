import {roomContinuityExclusions} from '../src/domain/room-continuity-exclusions.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRoomContinuity,projectRoomContinuity,type RoomContinuityDecision} from '../src/domain/room-continuity.ts';
import {evaluateRoomObservationGraph,type RoomObservationCandidate} from '../src/domain/room-observation-graph.ts';
import type {RoomMemory,RoomObservationView,RoomSourceView} from '../src/domain/room-memory-contracts.ts';

const source=(letter:string,hour:number):RoomSourceView=>({viewId:`view-${letter}`,frameId:`frame-${letter}`,sourceHash:letter.repeat(64),capturedAt:`2026-10-29T${String(hour).padStart(2,'0')}:00:00Z`,imageUrl:`/${letter}.png`});
function fixture(){
 const original=source('a',1),current=source('b',2);
 const room:RoomMemory={roomId:'room',label:'Room',provenance:'agent-derived',graph:{scope:'Authored',sourceViews:[original],nodes:[{id:'object',label:'Object',kind:'portable',status:'provisional',attributes:[],evidence:[{viewId:original.viewId,basis:'Original'}]}],edges:[],identityGroups:[],unknowns:[],nodeOrigins:{},reviewNotes:[],nodeAnchorEvidence:{object:[{viewId:original.viewId,basis:'Original immutable anchor'}]}},visits:[]};
 const observation:RoomObservationView={observationId:'observation-b',jobId:'job-b',roomId:'room',source:current,capturedAt:current.capturedAt,provenance:'authored-test',label:'Current',kind:'portable',attributes:[],basis:'Visible details',currentAppearance:{description:'Separate current detail',features:[{feature:'outline',description:'Angular silhouette',visible:true},{feature:'assembly',description:'Offset latch assembly',visible:true}]}};
 const candidate:RoomObservationCandidate={candidateNodeId:'object',status:'likely-same',comparison:{priorSourceHashes:[original.sourceHash],adequateDiscriminatingEvidence:true,limitation:'none',features:[{feature:'outline',kind:'silhouette',identityRelevance:'shared-design',result:'same',currentBasis:'Current angular outline',historicalBasis:'Original angular outline',priorSourceHash:original.sourceHash},{feature:'assembly',kind:'construction',identityRelevance:'shared-design',result:'same',currentBasis:'Current offset latch',historicalBasis:'Original offset latch',priorSourceHash:original.sourceHash}]}};
 return {room,observation,candidate,original};
}
function append(f:ReturnType<typeof fixture>,decisions:RoomContinuityDecision[],letter:string,hour:number){
 const decision=evaluateRoomContinuity(f.room,f.observation,f.candidate,decisions);decisions.push(decision);f.room.continuityLinks=projectRoomContinuity(decisions);
 f.room.visits.push({schemaVersion:1,importId:`import-${letter}`,roomId:'room',visitId:`visit-${letter}`,label:'Authored',summary:'History',sourceViews:[f.observation.source],provenance:'authored-test',proposals:[{id:`proposal-${letter}`,nodeId:'object',status:'uncertain',observationId:f.observation.observationId,basis:'Appearance',alternatives:'Replacement possible',evidence:[{viewId:f.observation.source.viewId,basis:'Current visible'}]}]});
 const next=source(letter,hour);f.observation={...f.observation,observationId:`observation-${letter}`,jobId:`job-${letter}`,source:next,capturedAt:next.capturedAt};return decision;
}
test('unchanged and moved visible agreement activates separate continuity while physical graph stays uncertain',()=>{
 for(const moved of [false,true]){const f=fixture();if(moved){f.observation.currentAppearance!.features.push({feature:'position',description:'New shelf',visible:true});f.candidate.comparison!.features.push({feature:'position',kind:'location',result:'different',currentBasis:'Right shelf',historicalBasis:'Left shelf',priorSourceHash:f.original.sourceHash});}
 const before=structuredClone(f),decision=evaluateRoomContinuity(f.room,f.observation,f.candidate);assert.equal(decision.activate,true);assert.equal(evaluateRoomObservationGraph(f.room,f.observation,f.candidate).favoredHypothesis,'uncertain');assert.deepEqual(f,before);assert.match(decision.basis,/does not confirm physical identity/);assert.equal('probability' in decision,false);assert.equal(decision.policyVersion,2);}
});
test('a model probable-same assertion can use one shared feature without unique marks',()=>{
 const f=fixture();f.observation.currentAppearance!.features.splice(1);f.candidate.comparison!.features.splice(1);const mark=f.candidate.comparison!.features[0];mark.kind='markings';mark.identityRelevance='shared-design';assert.equal(evaluateRoomContinuity(f.room,f.observation,f.candidate).activate,true);mark.identityRelevance='potentially-instance-specific';assert.equal(evaluateRoomContinuity(f.room,f.observation,f.candidate).activate,true);
});
test('later strong original agreement extends history; exact contradiction retracts only its target with fallback',()=>{
 const f=fixture(),decisions:RoomContinuityDecision[]=[];append(f,decisions,'c',3);const earlier=source('b',2);append(f,decisions,'d',4);
 f.observation.currentAppearance!.features.push({feature:'later-latch',description:'Current offset latch',visible:true});f.candidate.status='uncertain';f.candidate.comparison!.limitation='history-conflict';f.candidate.comparison!.priorSourceHashes.push(source('c',3).sourceHash);f.candidate.comparison!.features.push({feature:'later-latch',kind:'part-layout',result:'different',currentBasis:'Offset latch',historicalBasis:'Centered latch in linked view',priorSourceHash:source('c',3).sourceHash});
 const snapshot=structuredClone(f.room),decision=evaluateRoomContinuity(f.room,f.observation,f.candidate,decisions);assert.deepEqual(decision.withdrawLinkIds,[decisions[1].decisionId]);assert.equal(decision.activate,false);decisions.push(decision);const links=projectRoomContinuity(decisions);assert.equal(links[0].state,'active');assert.equal(links[0].source.sourceHash,earlier.sourceHash);assert.equal(links[1].state,'withdrawn');assert.equal(links[1].withdrawal!.source.sourceHash,f.observation.source.sourceHash);assert.match(links[1].withdrawal!.basis,/does not prove physical replacement/);assert.deepEqual(f.room,snapshot);assert.deepEqual(projectRoomContinuity(decisions),links);
});
test('a newly different object never withdraws earlier correct links, even when later detail differs',()=>{
 const f=fixture(),decisions:RoomContinuityDecision[]=[];append(f,decisions,'c',3);f.candidate.status='different';f.candidate.comparison!.features[0].result='different';f.candidate.comparison!.priorSourceHashes.push(source('b',2).sourceHash);f.observation.currentAppearance!.features.push({feature:'later',description:'Different assembly',visible:true});f.candidate.comparison!.features.push({feature:'later',kind:'construction',result:'different',currentBasis:'Current new layout',historicalBasis:'Earlier old layout',priorSourceHash:source('b',2).sourceHash});const decision=evaluateRoomContinuity(f.room,f.observation,f.candidate,decisions);assert.equal(decision.activate,false);assert.deepEqual(decision.withdrawLinkIds,[]);assert.equal(projectRoomContinuity([...decisions,decision])[0].state,'active');
});
test('malformed, unbound, contradictory and unknown-candidate reports never activate',()=>{
 for(const mode of ['invisible','malformed','unbound','different','unknown-node','duplicate-feature','future-anchor'] as const){const f=fixture(),comparison=f.candidate.comparison!;
 if(mode==='invisible')f.observation.currentAppearance!.features[0].visible=false;if(mode==='malformed')(comparison.features[0] as unknown as {kind:string}).kind='invented';if(mode==='unbound')comparison.features[0].priorSourceHash='f'.repeat(64);if(mode==='different')comparison.features[1].result='different';if(mode==='unknown-node')f.candidate.candidateNodeId='missing';if(mode==='duplicate-feature')comparison.features[1].feature=comparison.features[0].feature;if(mode==='future-anchor')f.room.graph.sourceViews[0].capturedAt=source('a',9).capturedAt;
 assert.equal(evaluateRoomContinuity(f.room,f.observation,f.candidate).activate,false,mode);}
});
test('stale, equal-time and replayed images cannot strengthen or reactivate, including prior rejected source',()=>{
 const f=fixture(),decisions:RoomContinuityDecision[]=[];append(f,decisions,'c',3);const active=structuredClone(f.room.continuityLinks!);
 for(const mode of ['stale','equal','duplicate'] as const){const current=mode==='duplicate'?{...source('c',4),sourceHash:source('b',2).sourceHash}:source('d',mode==='stale'?1:2);f.observation={...f.observation,source:current,capturedAt:current.capturedAt};const decision=evaluateRoomContinuity(f.room,f.observation,f.candidate,decisions);assert.equal(decision.activate,false,mode);assert.deepEqual(decision.withdrawLinkIds,[]);assert.deepEqual(projectRoomContinuity([...decisions,decision]),active);}
 const g=fixture();g.candidate.status='uncertain';const rejected=evaluateRoomContinuity(g.room,g.observation,g.candidate);g.candidate.status='likely-same';assert.equal(evaluateRoomContinuity(g.room,g.observation,g.candidate,[rejected]).activate,false);
});

test('missing fine detail and one-kind agreement preserve an explicit probable-same working judgment',()=>{
 for(const limitation of ['none','current-detail','historical-detail','both'] as const){
  const f=fixture(),comparison=f.candidate.comparison!;comparison.adequateDiscriminatingEvidence=false;comparison.limitation=limitation;
  comparison.features[0].kind='colour';comparison.features[1].result='not-visible';f.observation.currentAppearance!.features[1].visible=false;
  assert.equal(evaluateRoomContinuity(f.room,f.observation,f.candidate).activate,true,limitation);
  f.candidate.status='uncertain';assert.equal(evaluateRoomContinuity(f.room,f.observation,f.candidate).activate,false,'uncertain is never auto-promoted');
  comparison.features[0].result='not-visible';f.observation.currentAppearance!.features[0].visible=false;f.candidate.status='likely-same';assert.equal(evaluateRoomContinuity(f.room,f.observation,f.candidate).activate,false,'no visible agreement');
 }
});
test('policy versions preserve old persisted decisions without reevaluating historical reports',()=>{
 const f=fixture(),legacy:RoomContinuityDecision={...evaluateRoomContinuity(f.room,f.observation,f.candidate),policyVersion:1,activate:false,basis:'Rejected by previous detail policy.'};
 assert.deepEqual(projectRoomContinuity([legacy]),[]);assert.equal(legacy.policyVersion,1);assert.equal(evaluateRoomContinuity(f.room,f.observation,f.candidate).policyVersion,2);
});
test('user-separated source lineage cannot reactivate or become a positive reference for the old memory',()=>{
 const f=fixture(),separated=source('c',1),other=source('d',1);
 f.room.continuityCorrections=[{correctionId:'correction',roomId:'room',nodeId:'object',linkId:'wrong-link',observationId:'wrong-observation',separatedNodeId:'separate',source:separated,attribution:'user',createdAt:'2026-10-29T01:30:00Z',withdrawn:false}];
 f.room.graph.nodes.push({...structuredClone(f.room.graph.nodes[0]),id:'separate',evidence:[{viewId:other.viewId,basis:'Separated lineage'}]});f.room.graph.sourceViews.push(separated,other);
 f.room.visits.push({schemaVersion:1,importId:'wrong',roomId:'room',visitId:'wrong',label:'Wrong prior link',summary:'Retained source',sourceViews:[separated,other],provenance:'authored-test',proposals:[{id:'wrong',nodeId:'object',status:'likely-same',observationId:'wrong-observation',basis:'Prior claim',alternatives:'Retained',evidence:[{viewId:separated.viewId,basis:'Prior appearance'},{viewId:other.viewId,basis:'Prior appearance'}]}]});
 assert.equal(evaluateRoomContinuity(f.room,f.observation,f.candidate).activate,true,'true original remains available');
 for(const sourceHash of [separated.sourceHash,other.sourceHash]){f.candidate.comparison!.priorSourceHashes=[sourceHash];f.candidate.comparison!.features.forEach(feature=>feature.priorSourceHash=sourceHash);assert.equal(evaluateRoomContinuity(f.room,f.observation,f.candidate).activate,false);}
 f.observation.source={...f.observation.source,sourceHash:separated.sourceHash};assert.match(evaluateRoomContinuity(f.room,f.observation,f.candidate).basis,/user separated/);
});

test('active nested separations exclude later descendant sources and undo removes that branch',()=>{
 const f=fixture(),first=source('c',1),child=source('d',2),later=source('e',3);
 const correction=(nodeId:string,separatedNodeId:string,source:RoomSourceView)=>({correctionId:`correction-${nodeId}`,roomId:'room',nodeId,linkId:`link-${nodeId}`,observationId:`observation-${nodeId}`,separatedNodeId,source,attribution:'user' as const,createdAt:source.capturedAt,withdrawn:false});
 f.room.continuityCorrections=[correction('object','child',first),correction('child','grandchild',child)];
 f.room.graph.nodes.push({...structuredClone(f.room.graph.nodes[0]),id:'child',evidence:[{viewId:first.viewId,basis:'First separation'}]},{...structuredClone(f.room.graph.nodes[0]),id:'grandchild',evidence:[{viewId:child.viewId,basis:'Nested separation'}]});
 f.room.graph.sourceViews.push(first,child);
 f.room.visits.push({schemaVersion:1,importId:'descendant',roomId:'room',visitId:'descendant',label:'Later descendant',summary:'Source on nested separate memory',provenance:'authored-test',sourceViews:[later],proposals:[{id:'descendant',nodeId:'grandchild',status:'likely-same',observationId:'descendant',basis:'Visible later source',alternatives:'Retained',evidence:[{viewId:later.viewId,basis:'Later descendant'}]}]});
 assert.deepEqual(roomContinuityExclusions(f.room,'object').sourceHashes,new Set([first.sourceHash,child.sourceHash,later.sourceHash]));
 const alias={...source('f',4),sourceHash:later.sourceHash};f.observation={...f.observation,source:alias,capturedAt:alias.capturedAt};
 assert.match(evaluateRoomContinuity(f.room,f.observation,f.candidate).basis,/user separated/);
 f.room.continuityCorrections[1].withdrawn=true;
 assert.ok(!roomContinuityExclusions(f.room,'object').sourceHashes.has(later.sourceHash));assert.equal(evaluateRoomContinuity(f.room,f.observation,f.candidate).activate,true);
 // Malformed in-memory cycles cannot make exclusion traversal loop forever.
 f.room.continuityCorrections[1].withdrawn=false;f.room.continuityCorrections.push(correction('grandchild','object',child));assert.ok(roomContinuityExclusions(f.room,'object').sourceHashes.has(later.sourceHash));
});

test('reversible state is context, neither identity agreement nor a withdrawal contradiction',()=>{
 const f=fixture(),decisions:RoomContinuityDecision[]=[];append(f,decisions,'c',3);
 const later=source('b',2);f.candidate.comparison!.priorSourceHashes.push(later.sourceHash);f.observation.currentAppearance!.features.push({feature:'lid state',description:'Closed',visible:true});f.candidate.comparison!.features.push({feature:'lid state',kind:'state',result:'different',currentBasis:'Closed',historicalBasis:'Open',priorSourceHash:later.sourceHash});
 const decision=evaluateRoomContinuity(f.room,f.observation,f.candidate,decisions);assert.equal(decision.activate,true);assert.deepEqual(decision.withdrawLinkIds,[]);assert.notEqual(evaluateRoomObservationGraph(f.room,f.observation,f.candidate).appearance,'conflicting');
 const only=fixture();only.candidate.comparison!.features.splice(1);only.candidate.comparison!.features[0].kind='state';assert.equal(evaluateRoomContinuity(only.room,only.observation,only.candidate).activate,false);assert.equal(evaluateRoomObservationGraph(only.room,only.observation,only.candidate).appearance,'insufficient');
});
