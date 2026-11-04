import type {RoomMemory} from './room-memory-contracts.ts';

/** Rebuild the reversible user overlay without rewriting evidence or model decisions. */
export function applyRoomContinuityCorrections(room:RoomMemory):RoomMemory{
 for(const correction of room.continuityCorrections??[]){
  if(correction.withdrawn)continue;
  const link=room.continuityLinks?.find(item=>item.linkId===correction.linkId&&item.nodeId===correction.nodeId&&item.observationId===correction.observationId);
  const observation=room.observations?.find(item=>item.observationId===correction.observationId);
  if(!link||!observation||observation.source.sourceHash!==correction.source.sourceHash)throw new Error('Invalid user continuity correction reference');
  link.state='withdrawn';
  link.withdrawal={observationId:observation.observationId,source:structuredClone(correction.source),basis:'User correction: not the same object. This observation is kept as a separate memory entry.',attribution:'user',correctionId:correction.correctionId};
  const evidence=[{viewId:observation.source.viewId,basis:observation.basis,...(observation.location?{location:observation.location}:{})}];
  if(room.graph.nodes.some(node=>node.id===correction.separatedNodeId))throw new Error('Duplicate separated memory node');
  room.graph.nodes.push({id:correction.separatedNodeId,label:observation.label,kind:observation.kind,status:'provisional',attributes:[...observation.attributes],...(observation.semanticUnknown?{semantic:{status:'unknown',description:observation.semanticUnknown}}:{}),evidence});
  (room.graph.nodeAnchorEvidence??={})[correction.separatedNodeId]=structuredClone(evidence);
  room.graph.nodeOrigins[correction.separatedNodeId]=[observation.observationId];
  if(!room.graph.sourceViews.some(source=>source.viewId===observation.source.viewId))room.graph.sourceViews.push(structuredClone(observation.source));
 }
 return room;
}
