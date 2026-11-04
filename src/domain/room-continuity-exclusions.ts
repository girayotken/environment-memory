import type {RoomMemory} from './room-memory-contracts.ts';

/** User separation applies to this candidate/source lineage, never the whole node. */
export function roomContinuityExclusions(room:RoomMemory,nodeId:string){
 const corrections=(room.continuityCorrections??[]).filter(correction=>correction.roomId===room.roomId&&correction.nodeId===nodeId&&!correction.withdrawn);
 const sourceHashes=new Set(corrections.map(correction=>correction.source.sourceHash));
 const sources=[...room.graph.sourceViews,...room.visits.flatMap(visit=>visit.sourceViews)];
 const descendants=new Set<string>(),pending=corrections.map(correction=>correction.separatedNodeId);
 while(pending.length){
  const separatedNodeId=pending.pop()!;if(descendants.has(separatedNodeId))continue;descendants.add(separatedNodeId);
  // A later user separation extends the original exclusion through every child
  // branch. Undo removes only that active edge; visited nodes prevent cycles.
  for(const correction of room.continuityCorrections??[])if(correction.roomId===room.roomId&&correction.nodeId===separatedNodeId&&!correction.withdrawn){sourceHashes.add(correction.source.sourceHash);pending.push(correction.separatedNodeId);}
 }
 for(const separatedNodeId of descendants){
  const separate=room.graph.nodes.find(node=>node.id===separatedNodeId);
  const views=new Set([...(separate?room.graph.nodeAnchorEvidence?.[separate.id]??separate.evidence:[]),...room.visits.flatMap(visit=>visit.proposals.filter(proposal=>proposal.nodeId===separatedNodeId).flatMap(proposal=>proposal.evidence))].map(evidence=>evidence.viewId));
  for(const source of sources)if(views.has(source.viewId))sourceHashes.add(source.sourceHash);
  for(const link of room.continuityLinks??[])if(link.roomId===room.roomId&&link.nodeId===separatedNodeId)sourceHashes.add(link.source.sourceHash);
 }
 return {sourceHashes,corrections};
}
