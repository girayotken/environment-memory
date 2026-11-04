import type {RoomMemory,RoomGraph} from './room-memory-contracts.ts';
import {roomLastObservation,roomNodeLabel} from '../client/room-memory-index.ts';
/** Removal is a dated user claim. A newer item sighting remains separate evidence. */
export function roomContainmentRemoval(room:RoomMemory,node:RoomGraph['nodes'][number]){
 if(room.containment?.active.some(event=>event.itemId===node.id))return null;
 const event=[...(room.containment?.events??[])].reverse().find(event=>event.itemId===node.id&&!event.withdrawn&&!event.invalidated);
 if(!event||event.action!=='remove')return null;
 const container=room.graph.nodes.find(item=>item.id===event.containerId),last=roomLastObservation(room,node);
 return {containerId:event.containerId,containerLabel:container?roomNodeLabel(room,container):event.containerId,recordedAt:event.recordedAt,source:event.source,statement:event.statement,attribution:event.attribution,itemSeenAfterRemoval:!!last&&Date.parse(last.source.capturedAt)>Date.parse(event.recordedAt)};
}

/** A visual contradiction is provisional and distinct from a user's removal claim. */
export function roomContainmentOutsideEvidence(room:RoomMemory,node:RoomGraph['nodes'][number]){
 if(room.containment?.active.some(event=>event.itemId===node.id))return null;
 const event=[...(room.containment?.events??[])].reverse().find(event=>event.itemId===node.id&&!event.withdrawn&&!event.invalidated);
 if(!event||event.action!=='outside')return null;
 const container=room.graph.nodes.find(item=>item.id===event.containerId);
 return {operationId:event.operationId,containerId:event.containerId,containerLabel:container?roomNodeLabel(room,container):event.containerId,recordedAt:event.recordedAt,source:event.source,statement:event.statement,attribution:'model' as const};
}
