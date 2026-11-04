import type {CapturedFrame} from '../domain/capture-contracts.ts';
import type {RoomActionNeeded,RoomAutomationResponse} from '../domain/room-observer-contracts.ts';
import {activeRoomFollowup} from './room-memory-index.ts';

export type GuidedCheckState='checking'|'addressed'|'not-addressed';
/** The server reuses room/source checks even when a new capture has another frame ID. */
export function guidedFrameJob(state:RoomAutomationResponse|null,action:RoomActionNeeded,frame:CapturedFrame){
 const jobs=state?.jobs.filter(item=>item.roomId===action.roomId&&item.sourceHash===frame.sourceHash)??[];
 return jobs.find(item=>item.frameId===frame.id)??jobs[0];
}
/** UI success requires the server's exact action resolution from this saved check. */
export function guidedCheckState(state:RoomAutomationResponse|null,action:RoomActionNeeded,frame:CapturedFrame):GuidedCheckState {
 const job=guidedFrameJob(state,action,frame);
 if(!job)return 'checking';
 if(job.frameId!==frame.id)return 'not-addressed';
 if(job.followup?.actionId!==action.actionId)return 'not-addressed';
 const current=state?.actions.find(item=>item.roomId===action.roomId&&item.actionId===action.actionId);
 if(job.status==='published'){
  const resolution=current?.status==='resolved'?current.resolution:undefined;
  return resolution?.frameId===frame.id&&resolution.sourceHash===frame.sourceHash&&resolution.jobId===job.jobId?'addressed':'not-addressed';
 }
 return ['failed','disabled','interrupted'].includes(job.status)?'not-addressed':'checking';
}
export function canStartGuidedCapture(state:RoomAutomationResponse|null,action:RoomActionNeeded|null,ready:boolean,active:boolean,locked:boolean):boolean {
 return ready&&active&&!locked&&!!state?.provider.enabled&&!!activeRoomFollowup(state,action);
}
