import test from 'node:test';
import assert from 'node:assert/strict';
import type {RoomAutomationJob,RoomAutomationResponse} from '../src/domain/room-observer-contracts.ts';
import {ROOM_STATUS_CHECK_LIMIT,canCheckRoomFrame,canPollRoomJobs,roomFrameJob,roomJobLabel,roomJobOrigin,showRoomWatchTimeout} from '../src/client/room-automation-state.ts';
const job=(status:RoomAutomationJob['status'],other:Partial<RoomAutomationJob>={}):RoomAutomationJob=>({jobId:'one',roomId:'room',frameId:'frame',sourceHash:'same-pixels',provenance:'authored-test',trigger:'manual',status,provider:null,createdAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-29T00:00:00Z',error:null,visitId:null,...other});
const state=(jobs:RoomAutomationJob[]=[]):RoomAutomationResponse=>({declaration:{roomId:'room',enabled:false,afterSequence:0},provider:{name:'authored',enabled:true,reason:null},jobs,actions:[]});
test('saved results block a second paid check for every job outcome and alias of the same source',()=>{
 for(const status of ['queued','running','staged','published','failed','interrupted','disabled'] as const){
  const current=state([job(status)]);
  assert.equal(canCheckRoomFrame(current,'frame'),false,status);
  assert.equal(canCheckRoomFrame(current,'new-frame','same-pixels'),false,status);
  assert.equal(roomFrameJob(current,'new-frame','same-pixels')?.status,status);
 }
 assert.equal(canCheckRoomFrame(state([job('published',{roomId:'other-room'})]),'frame'),true,'room choice keeps source comparisons separate');
});
test('a saved-frame action needs an available provider and deliberate room selection',()=>{
 assert.equal(canCheckRoomFrame(null,'frame'),false);
 assert.equal(canCheckRoomFrame({...state(),declaration:{roomId:null,enabled:false,afterSequence:0}},'frame'),false);
 assert.equal(canCheckRoomFrame({...state(),provider:{name:null,enabled:false,reason:'Unavailable'}},'frame'),false);
 assert.equal(canCheckRoomFrame(state(),'frame',undefined,true),false);
 assert.equal(canCheckRoomFrame(state(),'frame'),true,'manual checking works with automation off');
});
test('status watching ends on terminal outcomes, hidden views and its bounded read allowance',()=>{
 for(const status of ['queued','running','staged'] as const)assert.equal(canPollRoomJobs([job(status)],true,false,0),true);
 for(const status of ['published','failed','interrupted','disabled'] as const)assert.equal(canPollRoomJobs([job(status)],true,false,0),false);
 assert.equal(canPollRoomJobs([job('running')],false,false,0),false);
 assert.equal(canPollRoomJobs([job('running')],true,true,0),false);
 assert.equal(canPollRoomJobs([job('running')],true,false,ROOM_STATUS_CHECK_LIMIT),false);
 assert.equal(canPollRoomJobs([job('running')],true,false,ROOM_STATUS_CHECK_LIMIT-1),true);
});
test('job presentation uses newest server result and keeps successful updates distinct from waiting or failure',()=>{
 const current=state([job('published',{jobId:'new'}),job('failed',{jobId:'old'})]);
 assert.equal(roomFrameJob(current,'frame')?.jobId,'new');
 assert.equal(roomJobLabel(job('published')),'Memory updated');
 assert.equal(roomJobLabel(job('queued')),'Waiting to check');
 assert.equal(roomJobLabel(job('failed')),'Memory check failed');
});

test('authored runtime checks remain visibly separate from model observations',()=>{
 assert.equal(roomJobOrigin(job('published')),'Authored test · no model observation');
 assert.equal(roomJobOrigin(job('published',{provenance:'agent-derived'})),'Model check · identity provisional');
 assert.equal(roomJobOrigin(job('published',{provenance:'agent-derived',provider:'Sol 6.1 subagent · local file relay'})),'Sol 6.1 subagent · local file relay · identity provisional');
});


test('a manual status refresh removes the old timeout notice after the last pending job completes',()=>{
 // The read allowance elapsed while inference was running; Check status later
 // receives a terminal job. A stale stopped-watcher flag must not outlive it.
 const timedOut=true;
 assert.equal(showRoomWatchTimeout([job('running')],timedOut),true);
 for(const terminal of ['published','failed','interrupted','disabled'] as const){
  const refreshed=state([job(terminal)]);
  assert.equal(showRoomWatchTimeout(refreshed.jobs,timedOut),false,terminal);
  assert.equal(canPollRoomJobs(refreshed.jobs,true,false,ROOM_STATUS_CHECK_LIMIT),false);
 }
 assert.equal(showRoomWatchTimeout([],timedOut),false);
 assert.equal(showRoomWatchTimeout([job('published'),job('queued',{jobId:'other'})],timedOut),true,'another unfinished check still justifies the notice');
 assert.equal(showRoomWatchTimeout([job('running')],false),false,'a fresh watcher has not timed out');
});
