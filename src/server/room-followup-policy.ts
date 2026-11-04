import type {RoomMemory,RoomGraph} from '../domain/room-memory-contracts.ts';
import type {RoomObserverResult,RoomFollowupScope,RoomActionNeeded} from '../domain/room-observer-contracts.ts';

/** A follow-up is selected by the user and frozen with the job, never inferred from a crop. */
export function validateRoomFollowup(followup:RoomFollowupScope|undefined,pendingActions:RoomActionNeeded[],roomId:string){
 if(!followup)return;
 const action=pendingActions.find(a=>a.actionId===followup.actionId);
 if(!action||action.roomId!==roomId||action.status!=='open'||action.kind!=='view'||action.nodeId!==followup.nodeId||action.sourceHash!==followup.sourceHash||action.request!==followup.request)throw new Error('Focused follow-up must match an open view action in this room');
}

/** Last useful evidence is separate from a partial current observation. A later contradiction or
 * unresolved correspondence blocks fallback; history is never promoted into a current match. */
export function priorUsefulRoomEvidence(room:RoomMemory,nodeId:string,currentCapturedAt:string):RoomGraph['nodes'][number]['evidence']{
 const cutoff=Date.parse(currentCapturedAt),times=new Map([...room.graph.sourceViews,...room.visits.flatMap(v=>v.sourceViews)].map(s=>[s.viewId,Date.parse(s.capturedAt)]));
 if(!Number.isFinite(cutoff))return [];
 const earlier=(e:{viewId:string})=>Number.isFinite(times.get(e.viewId))&&times.get(e.viewId)! < cutoff;
 const history=room.visits.flatMap(v=>v.proposals.filter(p=>p.nodeId===nodeId&&p.status!=='not-observed'&&p.evidence.every(earlier)).map(p=>({p,time:Math.max(...p.evidence.map(e=>times.get(e.viewId)!))}))).sort((a,b)=>b.time-a.time);
 const latest=history[0]?.p;
 if(history.some(h=>h.time===history[0]?.time&&h.p.status!=='likely-same'&&!h.p.viewDeferral))return [];
 if(latest){
  if(latest.viewDeferral)return latest.viewDeferral.priorEvidence.filter(earlier);
  return latest.status==='likely-same'?latest.evidence:[];
 }
 return room.graph.nodes.find(n=>n.id===nodeId)?.evidence.filter(earlier)??[];
}

/** Direct containment/part relations only; shared supports and transitive room context stay peripheral. */
export function roomFollowupNodes(room:RoomMemory,followup:RoomFollowupScope){
 const ids=new Set([followup.nodeId]);
 for(const edge of room.graph.edges)if((edge.relation==='inside'||edge.relation==='part_of')&&(edge.from===followup.nodeId||edge.to===followup.nodeId)){ids.add(edge.from);ids.add(edge.to);}
 return ids;
}

export function roomViewDeferral(room:RoomMemory,observation:RoomObserverResult['observations'][number],followup:RoomFollowupScope|undefined,currentCapturedAt:string){
 if(!observation.viewDeferral)return undefined;
 const priorEvidence=observation.nodeId?priorUsefulRoomEvidence(room,observation.nodeId,currentCapturedAt):[];
 if(!followup||!observation.nodeId||roomFollowupNodes(room,followup).has(observation.nodeId)||observation.status!=='uncertain'||observation.needs!=='view'||observation.semanticUnknown||!priorEvidence.length)return undefined;
 return {...observation.viewDeferral,priorEvidence};
}
