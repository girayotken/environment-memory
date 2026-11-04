import test from 'node:test';
import assert from 'node:assert/strict';
import type {RoomActionNeeded,RoomAutomationResponse} from '../src/domain/room-observer-contracts.ts';
import type {RoomMemory,RoomMemoryVisit} from '../src/domain/room-memory-contracts.ts';
import {activeRoomFollowup,focusedRoomFrame,roomLastObservation,roomProposalLabel} from '../src/client/room-memory-index.ts';
const action:RoomActionNeeded={actionId:'tray-detail',jobId:'job',roomId:'workshop',nodeId:'tray',kind:'view',request:'Show the tray from above',sourceHash:'wide',status:'open',createdAt:'2026-10-29T00:00:00Z'};
const state:RoomAutomationResponse={declaration:{roomId:'workshop',enabled:true,afterSequence:0},provider:{name:'authored',enabled:true,reason:null},jobs:[],actions:[action]};
test('camera focus needs the exact open view request in the explicitly selected room',()=>{
 assert.equal(activeRoomFollowup(state,action),action);
 assert.equal(activeRoomFollowup(state,null),null);
 assert.equal(activeRoomFollowup({...state,declaration:{...state.declaration,roomId:'elsewhere'}},action),null);
 assert.equal(activeRoomFollowup({...state,actions:[{...action,status:'resolved'}]},action),null);
 assert.equal(activeRoomFollowup({...state,actions:[]},action),null);
 assert.equal(activeRoomFollowup({...state,actions:[{...action,kind:'explanation'}]},action),null);
 assert.equal(activeRoomFollowup(state,{roomId:'elsewhere',actionId:action.actionId}),null);
});
test('focus is stamped on new capture only and stays immutable through later selection changes',()=>{
 const frame={id:'close',sessionId:'session',capturedAt:'2026-10-29T01:00:00Z',imageDataUrl:'data:image/png;base64,AA=='};
 const general=focusedRoomFrame(frame,null),focused=focusedRoomFrame(frame,action);
 assert.equal('roomFollowup' in general,false);
 assert.deepEqual(focused.roomFollowup,{roomId:'workshop',actionId:'tray-detail'});
 assert.equal('roomFollowup' in frame,false,'old buffered frames are untouched');
 const other=focusedRoomFrame({...frame,id:'other'},{...action,actionId:'case-detail'});
 assert.deepEqual(other.roomFollowup,{roomId:'workshop',actionId:'case-detail'});
 assert.deepEqual(focused.roomFollowup,{roomId:'workshop',actionId:'tray-detail'},'earlier capture retains exact request');
});
test('incidental deferral remains separate from identity uncertainty and retains useful last-seen evidence',()=>{
 const evidence={viewId:'wide',basis:'Blue case on shelf',location:'Shelf'};
 const node={id:'case',label:'Blue case',kind:'container' as const,status:'provisional' as const,attributes:[],evidence:[evidence]};
 const source=(viewId:string,capturedAt:string)=>({viewId,frameId:viewId,sourceHash:viewId,imageUrl:`/${viewId}`,capturedAt});
 const proposal:RoomMemoryVisit['proposals'][number]={id:'partial',nodeId:'case',status:'uncertain',observationId:'partial-case',basis:'Only a corner visible',alternatives:'Match uncertain',evidence:[{viewId:'close',basis:'Cropped corner'}],viewDeferral:{reason:'peripheral-partial-view',basis:'Outside the tray question',priorEvidence:[evidence]}};
 const room:RoomMemory={roomId:'workshop',label:'Workshop',provenance:'agent-derived',graph:{scope:'Workshop',nodes:[node],edges:[],sourceViews:[source('wide','2026-10-29T00:00:00Z')],identityGroups:[],unknowns:[],nodeOrigins:{},reviewNotes:[]},visits:[{schemaVersion:1,importId:'visit',roomId:'workshop',visitId:'visit',label:'Tray follow-up',summary:'Partial view',provenance:'agent-derived',sourceViews:[source('close','2026-10-29T01:00:00Z')],proposals:[proposal]}]};
 assert.equal(roomLastObservation(room,node)?.source.viewId,'wide');
 assert.equal(roomLastObservation(room,node)?.evidence.location,'Shelf');
 assert.equal(roomProposalLabel(proposal),'Partial detail · earlier location kept');
 assert.equal(roomProposalLabel({...proposal,viewDeferral:undefined}),'Match uncertain');
 assert.equal(proposal.status,'uncertain');
 assert.equal(room.visits[0].proposals[0].evidence[0].viewId,'close','partial evidence remains inspectable');
});
