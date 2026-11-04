import test from 'node:test';
import assert from 'node:assert/strict';
import type {CapturedFrame} from '../src/domain/capture-contracts.ts';
import type {RoomActionNeeded,RoomAutomationJob,RoomAutomationResponse} from '../src/domain/room-observer-contracts.ts';
import {canStartGuidedCapture,guidedCheckState,guidedFrameJob} from '../src/client/guided-capture-state.ts';
const action:RoomActionNeeded={actionId:'detail',jobId:'old-job',roomId:'room',nodeId:'target',kind:'view',request:'Show the tool from closer',sourceHash:'old-source',status:'open',createdAt:'2026-10-29T00:00:00Z'};
const frame:CapturedFrame={id:'new-frame',sessionId:'guide',capturedAt:'2026-10-29T01:00:00Z',sourceHash:'new-source',width:1280,height:720,imageUrl:'/source',analysisStatus:'not-analyzed',roomFollowup:{roomId:'room',actionId:'detail'}};
const job:RoomAutomationJob={jobId:'guide-job',roomId:'room',frameId:frame.id,sourceHash:frame.sourceHash,provenance:'agent-derived',trigger:'manual',status:'published',provider:'local',createdAt:frame.capturedAt,updatedAt:frame.capturedAt,error:null,visitId:'visit',followup:{actionId:action.actionId,nodeId:action.nodeId,request:action.request,sourceHash:action.sourceHash}};
const state:RoomAutomationResponse={declaration:{roomId:'room',enabled:false,afterSequence:0},provider:{name:'local',enabled:true,reason:null},jobs:[job],actions:[action]};
const resolution={jobId:job.jobId,frameId:frame.id,sourceHash:frame.sourceHash,viewId:'view',basis:'Requested detail is visible',capturedAt:frame.capturedAt,resolvedAt:frame.capturedAt};
test('guided capture needs one open focused request, ready active pixels and an available checking model',()=>{
 assert.equal(canStartGuidedCapture(state,action,true,true,false),true,'explicit guided consent works while ordinary automatic checks are off');
 assert.equal(canStartGuidedCapture(state,null,true,true,false),false);
 assert.equal(canStartGuidedCapture(state,action,false,true,false),false);
 assert.equal(canStartGuidedCapture(state,action,true,false,false),false);
 assert.equal(canStartGuidedCapture(state,action,true,true,true),false);
 assert.equal(canStartGuidedCapture({...state,provider:{name:null,enabled:false,reason:'off'}},action,true,true,false),false);
 assert.equal(canStartGuidedCapture({...state,declaration:{...state.declaration,roomId:'elsewhere'}},action,true,true,false),false);
 assert.equal(canStartGuidedCapture({...state,actions:[{...action,status:'resolved'}]},action,true,true,false),false);
});
test('saved frame and published job alone never imply that the requested detail was addressed',()=>{
 assert.equal(guidedCheckState(state,action,frame),'not-addressed');
 assert.equal(guidedCheckState({...state,jobs:[]},action,frame),'checking');
 for(const status of ['queued','running','staged'] as const)assert.equal(guidedCheckState({...state,jobs:[{...job,status}]},action,frame),'checking');
 for(const status of ['failed','disabled','interrupted'] as const)assert.equal(guidedCheckState({...state,jobs:[{...job,status}]},action,frame),'not-addressed');
});
test('an already queued check remains watchable when its allowance makes new checks unavailable',()=>{
 const queued={...state,provider:{name:'local',enabled:false,reason:'No more new checks'},jobs:[{...job,status:'queued' as const}]};
 assert.equal(guidedFrameJob(queued,action,frame)?.jobId,job.jobId);
 assert.equal(guidedCheckState(queued,action,frame),'checking');
 assert.equal(canStartGuidedCapture(queued,action,true,true,false),false);
 const completed={...queued,jobs:[job],actions:[{...action,status:'resolved' as const,resolution}]};
 assert.equal(guidedCheckState(completed,action,frame),'addressed');
});
test('identical pixels reused from another frame terminate without claiming this capture addressed the request',()=>{
 for(const status of ['queued','running','staged','published','failed','disabled','interrupted'] as const){
  const earlier={...job,frameId:'earlier-frame',status};
  const reused={...state,jobs:[earlier],actions:[{...action,status:'resolved' as const,resolution:{...resolution,frameId:'earlier-frame'}}]};
  assert.equal(guidedFrameJob(reused,action,frame)?.frameId,'earlier-frame');
  assert.equal(guidedCheckState(reused,action,frame),'not-addressed',status);
  assert.equal(guidedCheckState({...reused,jobs:[{...earlier,followup:{...earlier.followup!,actionId:'other-scope'}}]},action,frame),'not-addressed','another scope cannot address the new capture');
 }
 assert.equal(guidedCheckState({...state,jobs:[{...job,roomId:'other-room',frameId:'earlier-frame'}]},action,frame),'checking','another room does not deduplicate this room check');
 assert.equal(guidedFrameJob({...state,jobs:[{...job,frameId:'earlier-frame'},job]},action,frame)?.frameId,frame.id,'prefer exact-frame job when present');
});
test('addressed status requires exact source, frame, job, room and action resolution',()=>{
 const resolved={...action,status:'resolved' as const,resolution};
 const current={...state,actions:[resolved]};
 assert.equal(guidedCheckState(current,action,frame),'addressed');
 for(const other of [{frameId:'other'},{sourceHash:'other'},{jobId:'other'}])assert.equal(guidedCheckState({...current,actions:[{...resolved,resolution:{...resolution,...other}}]},action,frame),'not-addressed');
 assert.equal(guidedCheckState({...current,actions:[{...resolved,actionId:'other'}]},action,frame),'not-addressed');
 assert.equal(guidedCheckState({...current,actions:[{...resolved,roomId:'other'}]},action,frame),'not-addressed');
 assert.equal(guidedCheckState({...current,jobs:[{...job,followup:{...job.followup!,actionId:'other'}}]},action,frame),'not-addressed');
});
