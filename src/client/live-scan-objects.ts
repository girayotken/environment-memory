import type {RoomMemory} from '../domain/room-memory-contracts.ts';
import type {RoomAutomationJob} from '../domain/room-observer-contracts.ts';
import {roomNodeLabel,roomProposalSupportsContinuity} from './room-memory-index.ts';

type Frame={id:string;sourceHash:string};
export type LiveObject={roomId:string;nodeId:string;label:string;imageUrl:string;location?:string;status:'Added'|'Updated'|'Probably the same'};
/** Only a published job's matching visit and source can contribute entries. */
export function liveScanObjects(frameIds:string[],saved:Frame[],jobs:RoomAutomationJob[],rooms:RoomMemory[],roomId:string|null):LiveObject[]{
 const ids=new Set(frameIds), result=new Map<string,LiveObject>();
 for(const job of [...jobs].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){
  if(!roomId||job.roomId!==roomId||job.status!=='published'||!job.visitId||!saved.some(f=>ids.has(f.id)&&f.sourceHash===job.sourceHash))continue;
  const room=rooms.find(r=>r.roomId===job.roomId),visit=room?.visits.find(v=>v.roomId===job.roomId&&v.visitId===job.visitId);
  const source=visit?.sourceViews.find(s=>s.frameId===job.frameId&&s.sourceHash===job.sourceHash);
  if(!room||!visit||!source)continue;
  for(const proposal of visit.proposals){
   if(!proposal.evidence.some(e=>e.viewId===source.viewId))continue;
   const correction=room.continuityCorrections?.find(c=>!c.withdrawn&&c.observationId===proposal.observationId&&c.nodeId===proposal.nodeId&&c.source.frameId===job.frameId&&c.source.sourceHash===job.sourceHash);
   const node=room.graph.nodes.find(n=>n.id===(correction?.separatedNodeId??proposal.nodeId));if(!node||node.kind==='place')continue;
   const added=!!correction||((room.graph.nodeAnchorEvidence?.[node.id]??node.evidence).some(e=>e.viewId===source.viewId)&&room.graph.sourceViews.some(s=>s.viewId===source.viewId&&s.frameId===job.frameId&&s.sourceHash===job.sourceHash));
   if(!added&&!roomProposalSupportsContinuity(room,proposal))continue;
   const key=JSON.stringify([room.roomId,node.id]),previous=result.get(key);
   result.set(key,{roomId:room.roomId,nodeId:node.id,label:roomNodeLabel(room,node),imageUrl:source.imageUrl,location:proposal.evidence.find(e=>e.viewId===source.viewId)?.location??node.evidence.find(e=>e.viewId===source.viewId)?.location,status:added?(previous?'Updated':'Added'):'Probably the same'});
  }
 }
 return [...result.values()];
}
