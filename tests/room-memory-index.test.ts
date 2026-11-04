import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {RoomGraph,RoomMemory} from '../src/domain/room-memory-contracts.ts';
import {roomSections,roomLastObservation} from '../src/client/room-memory-index.ts';
const evidence=[{viewId:'first',basis:'Visible in saved view'}];
const node=(id:string,kind:RoomGraph['nodes'][number]['kind'])=>({id,label:id,kind,status:'provisional' as const,attributes:[],evidence});
const edge=(from:string,to:string,relation:RoomGraph['edges'][number]['relation'],status:'observed'|'inferred'='observed')=>({from,to,relation,status,evidence});
function room(nodes:RoomGraph['nodes'],edges:RoomGraph['edges']):RoomMemory{return {roomId:'room',label:'Workshop',provenance:'agent-derived',visits:[],graph:{scope:'Partial',sourceViews:[],nodes,edges,identityGroups:[],unknowns:[],nodeOrigins:{},reviewNotes:[]}};}
test('room index lists each canonical node once, following nested support ancestry',()=>{
 const result=roomSections(room([node('room','place'),node('bench','support'),node('tray','container'),node('hardware','contents_group'),node('shelf','support'),node('box','container'),node('window','fixture')],[edge('bench','room','part_of','inferred'),edge('tray','bench','on'),edge('hardware','tray','inside'),edge('shelf','bench','part_of'),edge('box','shelf','on')]));
 assert.deepEqual(result.map(section=>[section.label,section.nodes.map(n=>n.id)]),[['bench',['bench','tray','hardware','shelf','box']],['Around the room',['window']]]);
 const ids=result.flatMap(section=>section.nodes.map(n=>n.id));assert.equal(new Set(ids).size,ids.length);
});
test('inferred mounting organizes browsing while unrelated proximity does not merge objects',()=>{
 const result=roomSections(room([node('pegboard','support'),node('tools','contents_group'),node('stool','support')],[edge('tools','pegboard','mounted_on','inferred'),edge('stool','pegboard','near')]));
 assert.deepEqual(result.map(section=>section.nodes.map(n=>n.id)),[['pegboard','tools'],['stool']]);
});
test('cyclic placement falls back to room context instead of losing or duplicating nodes',()=>{
 const result=roomSections(room([node('a','container'),node('b','container')],[edge('a','b','inside'),edge('b','a','inside')]));
 assert.deepEqual(result[0].nodes.map(n=>n.id),['a','b']);
});

test('semantic unknowns use explicit description evidence, never identity uncertainty alone',async()=>{
 const {roomUnknownDescription}=await import('../src/domain/room-memory-contracts.ts');const {roomNodeLabel}=await import('../src/client/room-memory-index.ts');
 const known={...node('known','portable'),label:'Blue case',attributes:['Identity uncertain on return']};assert.equal(roomUnknownDescription(known),null);
 const descriptive={...node('shape','contents_group'),label:'Unclassified form',attributes:['Compact gray shape','Whether this is separate contents or part of container remains uncertain']};assert.equal(roomUnknownDescription(descriptive),descriptive.attributes.join(' · '));
 const explicit={...node('another','portable'),semantic:{status:'unknown' as const,description:'Small curved orange piece'}};assert.equal(roomUnknownDescription(explicit),'Small curved orange piece');
 const r=room([known,descriptive],[]);r.semanticRevisions=[{revisionId:'a',roomId:r.roomId,nodeId:'shape',label:'ユーザーの名前',attribution:'user',createdAt:'2026-10-29T00:00:00Z',withdrawn:false}];assert.equal(roomNodeLabel(r,descriptive),'ユーザーの名前');assert.equal(roomNodeLabel(r,known),'Blue case');r.semanticRevisions[0].withdrawn=true;assert.equal(roomNodeLabel(r,descriptive),'Unclassified form');
});

test('last-seen placement uses latest saved observation and survives a later unobserved visit',()=>{
 const remembered=node('case','portable'),r=room([remembered],[]);
 const source=(viewId:string,capturedAt:string)=>({viewId,frameId:viewId,sourceHash:viewId,imageUrl:`/${viewId}`,capturedAt});
 r.graph.sourceViews=[source('first','2026-10-29T00:00:00Z')];
 r.visits=[{schemaVersion:1,importId:'return',roomId:'room',visitId:'return',label:'Return',summary:'Partial view',sourceViews:[source('moved','2026-10-29T01:00:00Z')],provenance:'agent-derived',proposals:[{id:'p1',nodeId:'case',status:'likely-same',observationId:'o1',basis:'Matching blue case',alternatives:'Identity remains provisional',evidence:[{viewId:'moved',basis:'Visible on shelf',location:'Shelf'}]}]},{schemaVersion:1,importId:'hidden',roomId:'room',visitId:'hidden',label:'Later',summary:'Other wall',sourceViews:[source('later','2026-10-29T02:00:00Z')],provenance:'agent-derived',proposals:[{id:'p2',nodeId:'case',status:'not-observed',observationId:null,basis:'Outside view',alternatives:'May be elsewhere',evidence:[{viewId:'later',basis:'No new evidence'}]}]}];
 const latest=roomLastObservation(r,remembered);
 assert.equal(latest?.source.capturedAt,'2026-10-29T01:00:00Z');assert.equal(latest?.evidence.location,'Shelf');assert.equal(latest?.proposal?.status,'likely-same');
 assert.equal(r.visits[1].proposals[0].status,'not-observed');
});

test('different appearance stays in return history without advancing the remembered object last-seen',()=>{
 const remembered=node('case','portable'),r=room([remembered],[]);
 r.graph.sourceViews=[{viewId:'first',frameId:'first',sourceHash:'first',imageUrl:'/first',capturedAt:'2026-10-29T00:00:00Z'}];
 r.visits=[{schemaVersion:1,importId:'replacement',roomId:'room',visitId:'replacement',label:'Return',summary:'Different appearance',provenance:'agent-derived',sourceViews:[{viewId:'later',frameId:'later',sourceHash:'later',imageUrl:'/later',capturedAt:'2026-10-29T02:00:00Z'}],proposals:[{id:'changed',nodeId:'case',status:'different',observationId:'possible-replacement',basis:'Different case shape',alternatives:'May be another object',evidence:[{viewId:'later',basis:'Different case on shelf',location:'Shelf'}]}]}];
 const latest=roomLastObservation(r,remembered);
 assert.equal(latest?.source.capturedAt,'2026-10-29T00:00:00Z');
 assert.equal(latest?.source.viewId,'first');
 assert.equal(r.visits[0].proposals[0].status,'different');
 assert.equal(r.visits[0].proposals[0].evidence[0].location,'Shelf');
});

test('an uncertain candidate keeps its source and location without moving the remembered object',()=>{
 const remembered=node('case','portable'),r=room([remembered],[]);
 r.graph.sourceViews=[{viewId:'first',frameId:'first',sourceHash:'first',imageUrl:'/first',capturedAt:'2026-10-29T00:00:00Z'}];
 r.visits=[{schemaVersion:1,importId:'uncertain',roomId:'room',visitId:'uncertain',label:'Return',summary:'Partial comparison',provenance:'agent-derived',sourceViews:[{viewId:'later',frameId:'later',sourceHash:'later',imageUrl:'/later',capturedAt:'2026-10-29T02:00:00Z'}],proposals:[{id:'uncertain',nodeId:'case',status:'uncertain',observationId:'independent-candidate',basis:'Only a blue corner is visible',alternatives:'Could be another case',evidence:[{viewId:'later',basis:'Cropped blue corner',location:'Lower shelf'}]}]}];
 assert.equal(roomLastObservation(r,remembered)?.source.viewId,'first');
 assert.equal(r.visits[0].proposals[0].evidence[0].location,'Lower shelf');
 assert.equal(r.visits[0].proposals[0].observationId,'independent-candidate');
});

function continuityFixture(){
 const remembered=node('case','container'),r=room([remembered],[]);
 const source=(viewId:string,hour:string)=>({viewId,frameId:viewId,sourceHash:viewId,imageUrl:`/${viewId}`,capturedAt:`2026-10-29T${hour}:00:00Z`});
 const original=source('first','00'),earlier=source('earlier','01'),recent=source('recent','02'),correction=source('correction','03');
 r.graph.sourceViews=[original];
 for(const [id,view,location] of [['earlier',earlier,'Tabletop'],['recent',recent,'Lower shelf']] as const){
  r.visits.push({schemaVersion:1,importId:id,roomId:r.roomId,visitId:id,label:id,summary:'Appearance report',provenance:'authored-test',sourceViews:[view],proposals:[{id,nodeId:remembered.id,observationId:id,status:'likely-same',basis:`Raw ${id} comparison`,alternatives:'Another instance remains possible',evidence:[{viewId:view.viewId,basis:`Visible ${id}`,location}]}]});
  (r.observations??=[]).push({observationId:id,jobId:id,roomId:r.roomId,source:view,capturedAt:view.capturedAt,provenance:'authored-test',label:'Blue case',kind:'container',attributes:[],basis:`Visible ${id}`,location});
 }
 r.continuityLinks=[{linkId:'earlier-link',roomId:r.roomId,nodeId:remembered.id,observationId:'earlier',source:earlier,state:'active',basis:'Matching design; provisional'}, {linkId:'recent-link',roomId:r.roomId,nodeId:remembered.id,observationId:'recent',source:recent,state:'active',basis:'Matching appearance; provisional'}];
 return {r,remembered,correction};
}
test('active provisional continuity advances last seen while physical alternatives remain uncertain',async()=>{
 const {evaluateRoomObservationGraph}=await import('../src/domain/room-observation-graph.ts');
 const {roomProposalSupportsContinuity,roomProposalLabel}=await import('../src/client/room-memory-index.ts');
 const {r,remembered}=continuityFixture(),observation=r.observations![1],proposal=r.visits[1].proposals[0];
 const candidate={candidateNodeId:remembered.id,status:'likely-same' as const};
 r.graphHypotheses=[{hypothesisId:'h',jobId:'recent',roomId:r.roomId,observationId:observation.observationId,candidate,evaluation:evaluateRoomObservationGraph(r,observation,candidate)}];
 assert.equal(r.graphHypotheses[0].evaluation.favoredHypothesis,'uncertain');
 assert.equal(roomProposalSupportsContinuity(r,proposal),true);
 assert.equal(roomProposalLabel(proposal,r),'Probably the same');
 assert.equal(roomLastObservation(r,remembered)?.evidence.location,'Lower shelf');
 delete r.continuityLinks;
 assert.equal(roomProposalSupportsContinuity(r,proposal),false);
 assert.equal(roomLastObservation(r,remembered)?.source.viewId,'earlier');
 assert.equal(proposal.status,'likely-same');
});
test('withdrawal vetoes the exact observation and falls back through valid history to the original',async()=>{
 const {roomProposalSupportsContinuity}=await import('../src/client/room-memory-index.ts');
 const {evaluateRoomObservationGraph}=await import('../src/domain/room-observation-graph.ts');
 const {r,remembered,correction}=continuityFixture();
 const candidate={candidateNodeId:remembered.id,status:'likely-same' as const},evaluation=evaluateRoomObservationGraph(r,r.observations![1],candidate);
 evaluation.favoredHypothesis='same-object';
 r.graphHypotheses=[{hypothesisId:'legacy-positive',jobId:'recent',roomId:r.roomId,observationId:'recent',candidate,evaluation}];
 r.continuityLinks![1]={...r.continuityLinks![1],state:'withdrawn',withdrawal:{observationId:'correction',source:correction,basis:'Fresh detail contradicts the recent link'}};
 assert.equal(roomProposalSupportsContinuity(r,r.visits[1].proposals[0]),false);
 assert.equal(roomLastObservation(r,remembered)?.source.viewId,'earlier');
 r.continuityLinks![0]={...r.continuityLinks![0],state:'withdrawn',withdrawal:{observationId:'correction',source:correction,basis:'Earlier link also contradicted'}};
 assert.equal(roomLastObservation(r,remembered)?.source.viewId,'first');
 assert.equal(r.visits[1].proposals[0].basis,'Raw recent comparison');
 assert.equal(r.observations![1].location,'Lower shelf');
});
test('a different current object leaves earlier provisional continuity valid',()=>{
 const {r,remembered,correction}=continuityFixture();
 r.visits.push({schemaVersion:1,importId:'different',roomId:r.roomId,visitId:'different',label:'Different current case',summary:'Another object',provenance:'authored-test',sourceViews:[correction],proposals:[{id:'different',nodeId:remembered.id,observationId:'different',status:'different',basis:'Current case has a different feature',alternatives:'Original may be elsewhere',evidence:[{viewId:correction.viewId,basis:'Current view',location:'Floor'}]}]});
 assert.equal(roomLastObservation(r,remembered)?.source.viewId,'recent');
 assert.equal(r.continuityLinks!.filter(link=>link.state==='active').length,2);
 r.visits=[];
 assert.equal(roomLastObservation(r,remembered)?.source.viewId,'recent','standalone immutable observation remains usable');
});

test('a policy-rejected alias of a withdrawn source cannot regain legacy eligibility',async()=>{
 const {evaluateRoomObservationGraph}=await import('../src/domain/room-observation-graph.ts');
 const {roomProposalSupportsContinuity}=await import('../src/client/room-memory-index.ts');
 const {r,remembered,correction}=continuityFixture();
 r.continuityLinks![1]={...r.continuityLinks![1],state:'withdrawn',withdrawal:{observationId:'correction',source:correction,basis:'New detail refutes the recent correspondence'}};
 const source={...r.observations![1].source,viewId:'rejected-alias'},alias={...r.observations![1],observationId:'rejected-alias',source};
 const proposal={...r.visits[1].proposals[0],id:'rejected-alias',observationId:alias.observationId,evidence:[{viewId:source.viewId,basis:'Replayed recent pixels',location:'Lower shelf'}]};
 r.observations!.push(alias);
 r.visits.push({...r.visits[1],visitId:'rejected-alias',sourceViews:[source],proposals:[proposal]});
 const candidate={candidateNodeId:remembered.id,status:'likely-same' as const},evaluation=evaluateRoomObservationGraph(r,alias,candidate);
 evaluation.favoredHypothesis='same-object';
 r.graphHypotheses=[{hypothesisId:'rejected-alias',jobId:'alias',roomId:r.roomId,observationId:alias.observationId,candidate,evaluation}];
 r.continuityEvaluatedObservationIds=['earlier','recent',alias.observationId];
 assert.equal(source.sourceHash,r.continuityLinks![1].source.sourceHash);
 assert.equal(roomProposalSupportsContinuity(r,proposal),false);
 assert.equal(roomLastObservation(r,remembered)?.source.viewId,'earlier');
 r.graphHypotheses=[];
 assert.equal(roomProposalSupportsContinuity(r,proposal),false,'a raw likely-same report also cannot bypass the saved rejection');
 const fresh={...alias,observationId:'fresh-valid',source:correction,capturedAt:correction.capturedAt,location:'Workbench'};
 r.observations!.push(fresh);r.continuityEvaluatedObservationIds.push(fresh.observationId);
 r.continuityLinks!.push({linkId:'fresh-valid',roomId:r.roomId,nodeId:remembered.id,observationId:fresh.observationId,source:correction,state:'active',basis:'New source supports provisional continuity'});
 assert.equal(roomLastObservation(r,remembered)?.source.viewId,'correction','a genuinely new active link remains eligible');
});

test('appended semantic evidence cannot resurrect a withdrawn observation through original fallback',()=>{
 const {r,remembered,correction}=continuityFixture();
 r.graph.nodeAnchorEvidence={[remembered.id]:[...remembered.evidence]};
 const revokedSource=r.observations![1].source;
 r.graph.sourceViews.push(revokedSource);
 r.graph.nodes[0].evidence=[...remembered.evidence,{viewId:revokedSource.viewId,basis:'Later semantic detail attached to remembered entry',location:'Lower shelf'}];
 for(const link of r.continuityLinks!)Object.assign(link,{state:'withdrawn',withdrawal:{observationId:'correction',source:correction,basis:'Later evidence retracts correspondence'}});
 assert.equal(roomLastObservation(r,remembered)?.source.viewId,'first');
 assert.equal(remembered.evidence.at(-1)?.viewId,'recent','raw semantic evidence remains available');
 const unknown={...node('unknown-extension','portable'),evidence:[{viewId:revokedSource.viewId,basis:'This independent unknown first appears here',location:'Shelf'}]};
 r.graph.nodes.push(unknown);r.graph.nodeAnchorEvidence[unknown.id]=[...unknown.evidence];
 assert.equal(roomLastObservation(r,unknown)?.source.viewId,'recent','an extension retains its own original anchor');
});
