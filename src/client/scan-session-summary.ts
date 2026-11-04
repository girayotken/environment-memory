import type {RoomAutomationJob} from '../domain/room-observer-contracts.ts';

/** Only this scan's persisted sources can count as its memory updates. */
export function scanSessionSummary(frameIds:string[],saved:Array<{id:string;sourceHash:string}>,jobs:RoomAutomationJob[],roomId:string|null){
 const selected=new Set(frameIds),sources=saved.filter(frame=>selected.has(frame.id));
 const counts={saved:sources.length,updated:0,checking:0,failed:0,unchecked:0,reused:0};
 for(const frame of sources){
  const job=jobs.find(item=>item.roomId===roomId&&item.frameId===frame.id&&item.sourceHash===frame.sourceHash);
  const reused=roomId&&jobs.some(item=>item.roomId===roomId&&item.sourceHash===frame.sourceHash&&item.status==='published'&&item.visitId);
  if(job?.status==='published')counts.updated++;
  else if(job&&['queued','running','staged'].includes(job.status))counts.checking++;
  else if(job&&['failed','interrupted','disabled'].includes(job.status))counts.failed++;
  else if(reused)counts.reused++;
  else counts.unchecked++;
 }
 return counts;
}
