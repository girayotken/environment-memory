import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {RoomMemory,RoomObservationView,RoomSourceView} from '../src/domain/room-memory-contracts.ts';
import {evaluateRoomObservationGraph,type RoomObservationCandidate} from '../src/domain/room-observation-graph.ts';
import {RoomObservationGraph} from '../src/client/RoomObservationGraph.tsx';
import {roomLastObservation,roomProposalLabel} from '../src/client/room-memory-index.ts';

function fixture(){
 const original:RoomSourceView={viewId:'original',frameId:'original',sourceHash:'a'.repeat(64),imageUrl:'/original.png',capturedAt:'2026-10-28T10:00:00Z'};
 const current:RoomSourceView={viewId:'current',frameId:'current',sourceHash:'b'.repeat(64),imageUrl:'/current.png',capturedAt:'2026-10-29T10:00:00Z'};
 const room:RoomMemory={roomId:'room',label:'Workshop',provenance:'agent-derived',graph:{scope:'Partial',sourceViews:[original],nodes:[{id:'remembered',label:'Remembered case',kind:'container',status:'provisional',attributes:[],evidence:[{viewId:'original',basis:'Original visible',location:'Tabletop'}]}],edges:[],identityGroups:[],unknowns:[],nodeOrigins:{},reviewNotes:[]},visits:[]};
 const observation:RoomObservationView={observationId:'observation',jobId:'job',roomId:'room',source:current,capturedAt:current.capturedAt,provenance:'authored-test',label:'Current blue container',kind:'container',attributes:[],basis:'Current image',location:'Lower shelf',currentAppearance:{description:'Blue container with a visible mark',features:[{feature:'front mark',description:'One short diagonal mark',visible:true}]}};
 const candidate:RoomObservationCandidate={candidateNodeId:'remembered',status:'likely-same',comparison:{priorSourceHashes:[original.sourceHash],adequateDiscriminatingEvidence:true,limitation:'none',features:[{feature:'front mark',kind:'markings',identityRelevance:'potentially-instance-specific',result:'same',currentBasis:'One diagonal mark',historicalBasis:'One diagonal mark',priorSourceHash:original.sourceHash}]}};
 room.observations=[observation];
 room.graphHypotheses=[{hypothesisId:'hypothesis',jobId:'job',roomId:'room',observationId:observation.observationId,candidate,evaluation:evaluateRoomObservationGraph(room,observation,candidate)}];
 room.visits=[{schemaVersion:1,importId:'visit',visitId:'visit',roomId:'room',label:'Return',summary:'Current frame',sourceViews:[current],provenance:'authored-test',proposals:[{id:'proposal',nodeId:'remembered',observationId:observation.observationId,status:'likely-same',basis:'Model proposed a link',alternatives:'Possible other',evidence:[{viewId:'current',basis:'Visible on lower shelf',location:'Lower shelf'}]}]}];
 return {room,observation,candidate};
}
const render=(room:RoomMemory)=>renderToStaticMarkup(createElement(RoomObservationGraph,{room}));
test('saved observations render every hypothesis and source evidence without confirming identity',()=>{
 const {room}=fixture(),html=render(room);
 for(const text of ['Current saved observation','Current blue container','Lower shelf','Identity alternatives','Same object','Similar other object','Uncertain','Supporting evidence','Evidence against','Missing evidence','Favored · provisional','Physical identity remains provisional','memory context'])assert.ok(html.includes(text),text);
 assert.ok(html.includes('href="/original.png"'));assert.ok(html.includes('href="/current.png"'));
 assert.ok(html.includes('Authored test · no model observation'));assert.equal(/\d(?:\.\d+)?%/.test(html),false);
 assert.equal(html.includes('Same object confirmed'),false);
});
test('a failed association retains the standalone observation and source; legacy rooms remain untouched',()=>{
 const {room}=fixture();room.graphHypotheses=[];
 const html=render(room);assert.ok(html.includes('No association evaluation is saved'));assert.ok(html.includes('Current blue container'));assert.ok(html.includes('/current.png'));
 delete room.observations;assert.equal(render(room),'');
});
test('independent evidence wording requires explicit independent conditioning',()=>{
 const {room,observation,candidate}=fixture();candidate.conditioning='independent';room.graphHypotheses![0].evaluation=evaluateRoomObservationGraph(room,observation,candidate);
 assert.ok(render(room).includes('recorded separately before comparison'));
 assert.equal(render(room).includes('does not make perception independent'),false);
});
test('the shared graph controls last-seen attribution and preserves a useful positive',()=>{
 const {room}=fixture(),node=room.graph.nodes[0],proposal=room.visits[0].proposals[0];
 assert.equal(roomLastObservation(room,node)?.evidence.location,'Lower shelf');assert.equal(roomProposalLabel(proposal,room),'Probably the same');
 room.graphHypotheses![0].evaluation.favoredHypothesis='uncertain';
 assert.equal(roomLastObservation(room,node)?.evidence.location,'Tabletop');assert.equal(roomProposalLabel(proposal,room),'Match uncertain');
 assert.ok(render(room).includes('Lower shelf'));
 room.graphHypotheses![0].evaluation.favoredHypothesis='similar-other';
 assert.equal(roomLastObservation(room,node)?.source.viewId,'original');assert.equal(roomProposalLabel(proposal,room),'May be a different object');
 assert.equal(proposal.status,'likely-same');
});

test('continuity presentation retains raw link and new withdrawal reasons with both exact sources',async()=>{
 const {registerHooks}=await import('node:module');
 const hooks=registerHooks({load(url,context,nextLoad){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:nextLoad(url,context);}});
 try{
  const {RoomContinuityHistory}=await import('../src/client/RoomMemoryPanel.tsx');
  const {room,observation}=fixture();
  room.continuityLinks=[{linkId:'link',roomId:room.roomId,nodeId:'remembered',observationId:observation.observationId,source:observation.source,state:'active',basis:'Visible form and placement support provisional continuity'}];
  const renderHistory=()=>renderToStaticMarkup(createElement(RoomContinuityHistory,{room,nodeId:'remembered'}));
  const active=renderHistory();assert.ok(active.includes('Probably the same'));assert.ok(active.includes('Memory update history'));assert.ok(active.includes('href="/current.png"'));
  room.continuityLinks[0].state='withdrawn';room.continuityLinks[0].withdrawal={observationId:'new-detail',source:{...observation.source,viewId:'new-detail',sourceHash:'c'.repeat(64),imageUrl:'/new-detail.png',capturedAt:'2026-10-29T11:00:00Z'},basis:'A new close view contradicts the earlier correspondence'};
  const withdrawn=renderHistory();
  for(const text of ['Match removed','Original link reason','Visible form and placement support provisional continuity','Withdrawal reason','A new close view contradicts the earlier correspondence','Earlier valid evidence is kept'])assert.ok(withdrawn.includes(text),text);
  assert.ok(withdrawn.includes('href="/current.png"'));assert.ok(withdrawn.includes('href="/new-detail.png"'));
  assert.equal(/\d(?:\.\d+)?%/.test(withdrawn),false);assert.equal(withdrawn.includes('Same object confirmed'),false);
  assert.equal(room.graphHypotheses![0].evaluation.favoredHypothesis,'same-object','overlay presentation preserves the physical graph');
 }finally{hooks.deregister();}
});


test('remembered location offers a correction for the latest working match and retains reversible user history',async()=>{
 const {registerHooks}=await import('node:module');
 const hooks=registerHooks({load(url,context,nextLoad){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:nextLoad(url,context);}});
 try{
  const {ObjectDetail}=await import('../src/client/RoomMemoryPanel.tsx');
  const {room,observation}=fixture(),node=room.graph.nodes.find(item=>item.id==='remembered')!;
  room.continuityLinks=[{linkId:'link',roomId:room.roomId,nodeId:node.id,observationId:observation.observationId,source:observation.source,state:'active',basis:'Matching visible details'}];
  const renderDetail=(locked=false)=>renderToStaticMarkup(createElement(ObjectDetail,{room,node,locked,onSemantic:async()=>{},onContinuity:async()=>{}}));
  const active=renderDetail();
  assert.ok(active.includes('aria-label="Remembered location"'));
  assert.ok(active.includes('Lower shelf'));
  assert.ok(active.includes('Probably the same'));
  assert.ok(active.includes('Not the same object'));
  assert.equal(active.includes('Last seen evidence · identity provisional'),false);
  assert.match(renderDetail(true),/button disabled="">Not the same object/);
  room.continuityLinks[0].state='withdrawn';
  room.continuityCorrections=[{correctionId:'correction',roomId:room.roomId,nodeId:node.id,linkId:'link',observationId:observation.observationId,separatedNodeId:'separate-object',source:observation.source,attribution:'user',createdAt:observation.capturedAt,withdrawn:false}];
  const corrected=renderDetail();
  assert.equal(corrected.includes('Not the same object'),false);
  assert.ok(corrected.includes('Saved as a separate object'));
  assert.ok(corrected.includes('Undo correction'));
  assert.ok(corrected.includes('Open corrected observation'));
  room.continuityCorrections[0].withdrawn=true;
  const undone=renderDetail();
  assert.ok(undone.includes('Correction undone'));
  assert.equal(undone.includes('Undo correction'),false);
 }finally{hooks.deregister();}
});
