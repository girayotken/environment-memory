import {roomContinuityExclusions} from '../domain/room-continuity-exclusions.ts';
import type {RoomMemory,RoomSourceView} from '../domain/room-memory-contracts.ts';
import type {RoomActionNeeded,RoomFollowupScope} from '../domain/room-observer-contracts.ts';
import {priorUsefulRoomEvidence} from './room-followup-policy.ts';

/** Source-bound derived history as it existed before this capture, never fresh visual proof. */
export function roomContinuityContext(room:RoomMemory,nodeId:string,current:{sourceHash:string;capturedAt:string}){
 const cutoff=Date.parse(current.capturedAt),sources=[...room.graph.sourceViews,...room.visits.flatMap(visit=>visit.sourceViews)];
 const eligible=(source:RoomSourceView)=>Number.isFinite(Date.parse(source.capturedAt))&&Date.parse(source.capturedAt)<cutoff&&source.sourceHash!==current.sourceHash;
 const observations=new Map((room.observations??[]).map(observation=>[observation.observationId,observation]));
 const bound=(observationId:string,source:RoomSourceView)=>{const observation=observations.get(observationId);return sources.some(saved=>saved.viewId===source.viewId&&saved.frameId===source.frameId&&saved.sourceHash===source.sourceHash&&saved.capturedAt===source.capturedAt)&&observation?.roomId===room.roomId&&observation.source.viewId===source.viewId&&observation.source.frameId===source.frameId&&observation.source.sourceHash===source.sourceHash&&observation.source.capturedAt===source.capturedAt&&observation.capturedAt===source.capturedAt;};
 if(!Number.isFinite(cutoff))return [];
 return (room.continuityLinks??[]).filter(link=>link.roomId===room.roomId&&link.nodeId===nodeId&&eligible(link.source)&&bound(link.observationId,link.source)&&(link.state!=='withdrawn'||Boolean(link.withdrawal&&bound(link.withdrawal.observationId,link.withdrawal.source)&&Date.parse(link.withdrawal.source.capturedAt)>Date.parse(link.source.capturedAt)))).map(link=>{
  // A later withdrawal cannot leak into an older packet. A same-image replay
  // also cannot feed its own decision or withdrawal back as evidence.
  const withdrawal=link.withdrawal&&eligible(link.withdrawal.source)&&bound(link.withdrawal.observationId,link.withdrawal.source)?link.withdrawal:undefined;
  return {...link,state:withdrawal?'withdrawn' as const:'active' as const,withdrawal};
 }).sort((a,b)=>b.source.capturedAt.localeCompare(a.source.capturedAt)||a.linkId.localeCompare(b.linkId));
}

/** The store freezes this projection before semantic extensions append evidence. */
export function roomNodeAnchorEvidence(room:RoomMemory,nodeId:string){
 return room.graph.nodeAnchorEvidence?.[nodeId]??room.graph.nodes.find(n=>n.id===nodeId)?.evidence??[];
}

/** Declared partial coverage is a caveat, while unspecified coverage proves no image quality. */
export function roomNodeAnchorCandidates(room:RoomMemory,nodeId:string,current?:{sourceHash:string;capturedAt:string}){
 const excluded=roomContinuityExclusions(room,nodeId).sourceHashes;
 const byView=new Map(room.graph.sourceViews.map(source=>[source.viewId,source]));
 const sources=roomNodeAnchorEvidence(room,nodeId).map((evidence,index)=>({source:byView.get(evidence.viewId),evidence,index,partial:/\b(?:partial(?:ly)?|cropped|occluded|obscured)\b/i.test(`${evidence.basis} ${evidence.location??''}`)})).filter(item=>item.source&&!excluded.has(item.source.sourceHash)&&Number.isFinite(Date.parse(item.source.capturedAt))&&(!current||(item.source.sourceHash!==current.sourceHash&&Date.parse(item.source.capturedAt)<Date.parse(current.capturedAt))));
 const partialHashes=new Set(sources.filter(item=>item.partial).map(item=>item.source!.sourceHash));
 sources.sort((a,b)=>Number(partialHashes.has(a.source!.sourceHash))-Number(partialHashes.has(b.source!.sourceHash))||b.source!.capturedAt.localeCompare(a.source!.capturedAt)||b.index-a.index||a.source!.viewId.localeCompare(b.source!.viewId));
 const seen=new Set<string>();
 return sources.filter(item=>{if(seen.has(item.source!.sourceHash))return false;seen.add(item.source!.sourceHash);return true;}).map(item=>({sourceHash:item.source!.sourceHash,viewId:item.evidence.viewId,coverageAnnotation:partialHashes.has(item.source!.sourceHash)?'explicit-partial-or-obscured' as const:'unspecified' as const,basis:item.evidence.basis,...(item.evidence.location?{location:item.evidence.location}:{})}));
}

/** No text length or source timestamp is an image-quality/identity score. */
export function roomNodeAnchorSourceHashes(room:RoomMemory,nodeId:string,current?:{sourceHash:string;capturedAt:string}):string[]{
 return roomNodeAnchorCandidates(room,nodeId,current).map(candidate=>candidate.sourceHash);
}

/** Latest answered detail per node; older answers remain in immutable room history. */
export function latestResolvedRoomViews(actions:RoomActionNeeded[],roomId:string,currentCapturedAt:string):RoomActionNeeded[]{
 const latest=new Map<string,RoomActionNeeded>();
 for(const action of actions.filter(a=>a.roomId===roomId&&a.kind==='view'&&a.status==='resolved'&&a.resolution&&Date.parse(a.resolution.capturedAt)<Date.parse(currentCapturedAt)).sort((a,b)=>b.resolution!.capturedAt.localeCompare(a.resolution!.capturedAt)||b.resolution!.resolvedAt.localeCompare(a.resolution!.resolvedAt)||a.actionId.localeCompare(b.actionId))){if(!latest.has(action.nodeId))latest.set(action.nodeId,action);}
 return [...latest.values()].slice(0,2);
}

/** Reserve original comparison evidence; remaining capacity uses relevant questions/latest context. */
export function selectRoomObserverSources(room:RoomMemory,current:{sourceHash:string;capturedAt:string},pending:RoomActionNeeded[],resolved:RoomActionNeeded[],followup?:RoomFollowupScope,comparisonNodeIds?:string[]):RoomSourceView[]{
 const sources=[...room.graph.sourceViews,...room.visits.flatMap(v=>v.sourceViews)].filter(s=>s.sourceHash!==current.sourceHash&&Date.parse(s.capturedAt)<Date.parse(current.capturedAt));
 const distinct=[...new Map(sources.slice().sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)).map(s=>[s.sourceHash,s])).values()];
 const targetIds=comparisonNodeIds??(followup?[followup.nodeId]:room.graph.nodes.map(node=>node.id));
 const continuity=targetIds.flatMap(nodeId=>roomContinuityContext(room,nodeId,current));
 const pair=(link:typeof continuity[number])=>`${link.nodeId}\0${link.source.sourceHash}`;
 const withdrawnPairs=new Set(continuity.filter(link=>link.state==='withdrawn').map(pair));
 const latestActive=continuity.filter(link=>link.state==='active'&&!withdrawnPairs.has(pair(link))).sort((a,b)=>b.source.capturedAt.localeCompare(a.source.capturedAt)||a.linkId.localeCompare(b.linkId));
 const activeHashes=new Set(latestActive.map(link=>link.source.sourceHash));
 // Retraction concerns one node/source pair. The same pixels can remain useful
 // positive context for another requested node with a still-active link.
 const withdrawnHashes=new Set(continuity.filter(link=>link.state==='withdrawn'&&!activeHashes.has(link.source.sourceHash)).map(link=>link.source.sourceHash));
 const detail=resolved.filter(a=>a.kind==='view'&&a.status==='resolved'&&a.resolution).sort((a,b)=>b.resolution!.capturedAt.localeCompare(a.resolution!.capturedAt))[0];
 const coverage=new Map<string,Set<string>>(),byView=new Map(sources.map(source=>[source.viewId,source]));
 const addEvidence=(nodeId:string,evidence:Array<{viewId:string}>)=>{for(const item of evidence){const source=byView.get(item.viewId);if(!source)continue;const nodes=coverage.get(source.sourceHash)??new Set<string>();nodes.add(nodeId);coverage.set(source.sourceHash,nodes);}};
 for(const node of room.graph.nodes){
  addEvidence(node.id,priorUsefulRoomEvidence(room,node.id,current.capturedAt));
  // Retrieval breadth includes visible uncertain evidence; it does not grant
  // identity fallback. Not-observed/deferred crops retain their earlier source.
  const latest=room.visits.flatMap(visit=>visit.proposals.filter(p=>p.nodeId===node.id&&p.status!=='not-observed'&&p.evidence.length&&p.evidence.every(e=>byView.has(e.viewId))).map(proposal=>({proposal,time:Math.max(...proposal.evidence.map(e=>Date.parse(byView.get(e.viewId)!.capturedAt)))}))).sort((a,b)=>b.time-a.time)[0];
  if(latest&&!latest.proposal.viewDeferral)addEvidence(node.id,latest.proposal.evidence);
 }
 // Experimental retrieval heuristic: preserve broad coverage while preferring
 // freshness within 50% of the largest latest-node breadth. This is not an
 // identity score; a newer one-node crop cannot replace a ten-node wider view.
 const breadth=(source:RoomSourceView)=>coverage.get(source.sourceHash)?.size??0,minBroad=Math.ceil(Math.max(0,...[...coverage.values()].map(nodes=>nodes.size))*.5);
 distinct.sort((a,b)=>Number(breadth(b)>=minBroad)-Number(breadth(a)>=minBroad)||(breadth(a)>=minBroad?b.capturedAt.localeCompare(a.capturedAt):breadth(b)-breadth(a)||b.capturedAt.localeCompare(a.capturedAt))||a.sourceHash.localeCompare(b.sourceHash));
 const chosen:RoomSourceView[]=[];
 const blockedForEveryTarget=(hash:string)=>targetIds.length>0&&targetIds.every(nodeId=>roomContinuityExclusions(room,nodeId).sourceHashes.has(hash));
 const add=(hash:string|undefined)=>{const source=distinct.find(s=>s.sourceHash===hash);if(source&&!blockedForEveryTarget(source.sourceHash)&&!chosen.some(s=>s.sourceHash===hash)&&chosen.length<2)chosen.push(source);};
 if(followup)add(followup.sourceHash);
 else add(pending.find(action=>action.kind==='view'&&(!comparisonNodeIds||comparisonNodeIds.includes(action.nodeId)))?.sourceHash);

 // An unconfirmed later match cannot replace the object's original comparison.
 // Explicit object scope ranks each node's last distinct original view; a general
 // check preserves one original image with the broadest original-node coverage.
 const anchorCounts=new Map<string,number>(),preferredCounts=new Map<string,number>();
 for(const nodeId of comparisonNodeIds??(followup?[followup.nodeId]:room.graph.nodes.map(n=>n.id))){
  const hashes=roomNodeAnchorSourceHashes(room,nodeId,current).filter(hash=>distinct.some(source=>source.sourceHash===hash));
  if(hashes[0])preferredCounts.set(hashes[0],(preferredCounts.get(hashes[0])??0)+1);
  for(const hash of hashes)anchorCounts.set(hash,(anchorCounts.get(hash)??0)+1);
 }
 const anchors=distinct.filter(source=>anchorCounts.has(source.sourceHash)).sort((a,b)=>
  (comparisonNodeIds?(preferredCounts.get(b.sourceHash)??0)-(preferredCounts.get(a.sourceHash)??0):0)||
  (anchorCounts.get(b.sourceHash)??0)-(anchorCounts.get(a.sourceHash)??0)||b.capturedAt.localeCompare(a.capturedAt)||a.sourceHash.localeCompare(b.sourceHash));
 add(anchors[0]?.sourceHash);
 if(comparisonNodeIds){
  // Cover another target before spending the final slot on latest context.
  const uncovered=comparisonNodeIds.filter(nodeId=>!roomNodeAnchorSourceHashes(room,nodeId,current).some(hash=>chosen.some(source=>source.sourceHash===hash)));
  const additional=anchors.find(source=>uncovered.some(nodeId=>roomNodeAnchorSourceHashes(room,nodeId,current).includes(source.sourceHash)));
  add(additional?.sourceHash);
 }

 // Preserve a useful linked source beside its immutable original when the two
 // image slots permit it. Withdrawal never silently supplies a positive anchor.
 add(latestActive[0]?.source.sourceHash);

 // Resolved requested detail remains useful history. With two image slots, the
 // original baseline and this answer take precedence over a later coarse match.
 if(!followup&&!comparisonNodeIds)add(detail?.resolution?.sourceHash);
 const recent=distinct.find(s=>!withdrawnHashes.has(s.sourceHash)&&s.sourceHash!==detail?.resolution?.sourceHash&&!chosen.some(old=>old.sourceHash===s.sourceHash));add(recent?.sourceHash);
 if(!followup)add(detail?.resolution?.sourceHash);
 for(const source of distinct)if(!withdrawnHashes.has(source.sourceHash))add(source.sourceHash);
 return chosen;
}
