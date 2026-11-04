import type {RoomAutomationJob,RoomAutomationResponse} from '../domain/room-observer-contracts.ts';
export const ROOM_STATUS_CHECK_LIMIT=30;
export const pendingRoomJob=(job:RoomAutomationJob)=>['queued','running','staged'].includes(job.status);
export function roomJobLabel(job:RoomAutomationJob):string {
 return {queued:'Waiting to check',running:'Checking saved view',staged:'Preparing memory update',published:'Memory updated',failed:'Memory check failed',interrupted:'Memory check interrupted',disabled:'Memory check unavailable'}[job.status];
}
export function roomFrameJob(state:RoomAutomationResponse|null,frameId:string,sourceHash?:string):RoomAutomationJob|undefined {
 return state?.jobs.find(job=>job.roomId===state.declaration.roomId&&(job.frameId===frameId||!!sourceHash&&job.sourceHash===sourceHash));
}

/** Retrying a status read is safe; a saved job of any outcome must not trigger another check. */
export function canCheckRoomFrame(state:RoomAutomationResponse|null,frameId:string,sourceHash?:string,locked=false):boolean {
 return !locked&&!!state?.provider.enabled&&!!state.declaration.roomId&&!roomFrameJob(state,frameId,sourceHash);
}
/** A stopped watcher is only a delay while some saved observation is still pending. */
export const showRoomWatchTimeout=(jobs:RoomAutomationJob[],watchStopped:boolean)=>watchStopped&&jobs.some(pendingRoomJob);
export const canPollRoomJobs=(jobs:RoomAutomationJob[],active:boolean,hidden:boolean,checks:number)=>active&&!hidden&&checks<ROOM_STATUS_CHECK_LIMIT&&jobs.some(pendingRoomJob);

export const roomJobOrigin=(job:RoomAutomationJob)=>job.provenance==='authored-test'?'Authored test · no model observation':`${job.provider??'Model check'} · identity provisional`;
