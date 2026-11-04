import type {RoomActionNeeded,RoomAutomationResponse} from '../domain/room-observer-contracts.ts';
import type {CaptureFrameInput} from '../domain/capture-contracts.ts';
import type {RoomGraph,RoomMemory,RoomMemoryVisit,RoomSourceView} from '../domain/room-memory-contracts.ts';
type Node=RoomGraph['nodes'][number];
const placement=new Set(['on','inside','part_of','mounted_on']);
type Proposal=RoomMemoryVisit['proposals'][number];

export function roomProposalEvaluation(room:RoomMemory,proposal:Proposal){
 return [...(room.graphHypotheses??[])].reverse().find(item=>item.observationId===proposal.observationId&&item.candidate.candidateNodeId===proposal.nodeId)?.evaluation;
}
/** A reversible appearance overlay is separate from the physical-identity alternatives. */
export function roomProposalContinuity(room:RoomMemory,proposal:Proposal){
 return [...(room.continuityLinks??[])].reverse().find(link=>link.roomId===room.roomId&&link.nodeId===proposal.nodeId&&link.observationId===proposal.observationId);
}
export function roomProposalSupportsContinuity(room:RoomMemory,proposal:Proposal){
 if(proposal.viewDeferral)return false;
 const link=roomProposalContinuity(room,proposal);
 if(link)return link.state==='active';
 // A saved policy rejection must not regain eligibility through a raw/legacy graph label.
 if(proposal.observationId&&room.continuityEvaluatedObservationIds?.includes(proposal.observationId))return false;
 const evaluation=roomProposalEvaluation(room,proposal);
 return evaluation?evaluation.favoredHypothesis==='same-object':proposal.status==='likely-same';
}

/** A canonical node appears once; support ancestry gives its browsing location. */
export function roomSections(room:RoomMemory){
 const {nodes,edges}=room.graph;
 const supports=nodes.filter(node=>node.kind==='support'&&edges.some(edge=>edge.to===node.id&&placement.has(edge.relation)));
 const roots=supports.filter(node=>!edges.some(edge=>edge.from===node.id&&placement.has(edge.relation)&&supports.some(parent=>parent.id===edge.to)));
 function rootFor(node:Node){const visited=new Set<string>();let id=node.id;while(!visited.has(id)){visited.add(id);if(roots.some(root=>root.id===id))return id;const edge=edges.find(edge=>edge.from===id&&placement.has(edge.relation));if(!edge)break;id=edge.to;}return 'other';}
 const sections=[...roots.map(node=>({id:node.id,label:node.label,nodes:[] as Node[]})),{id:'other',label:'Around the room',nodes:[] as Node[]}];
 for(const node of nodes.filter(node=>node.kind!=='place'))sections.find(section=>section.id===rootFor(node))!.nodes.push(node);
 return sections.filter(section=>section.nodes.length);
}

/** Names are user meaning for exactly one node, never identity evidence. */
export function roomUserEdit(room:RoomMemory,nodeId:string){return (room as RoomMemory & {userEdits?:Array<{nodeId:string;revision:number;name:string|null;groups:string[];tags:string[];lastRevisionId:string|null}>}).userEdits?.find(edit=>edit.nodeId===nodeId);}
export function roomNodeLabel(room:RoomMemory,node:Node){return roomUserEdit(room,node.id)?.name??[...(room.semanticRevisions??[])].reverse().find(r=>r.nodeId===node.id&&!r.withdrawn)?.label??node.label;}

/** Revoking one observation leaves earlier valid continuity and the original evidence intact. */
export function roomLastObservation(room:RoomMemory,node:Node){
 type Observation={source:RoomSourceView;evidence:Node['evidence'][number];proposal?:RoomMemoryVisit['proposals'][number];continuityLink?:NonNullable<RoomMemory['continuityLinks']>[number]};
 const observations:Observation[]=[];
 // Later semantic details may append node evidence; only frozen anchors are original fallback.
 for(const evidence of room.graph.nodeAnchorEvidence?.[node.id]??node.evidence){const source=room.graph.sourceViews.find(item=>item.viewId===evidence.viewId);if(source)observations.push({source,evidence});}
 for(const visit of room.visits)for(const proposal of visit.proposals.filter(item=>item.nodeId===node.id&&roomProposalSupportsContinuity(room,item)))for(const evidence of proposal.evidence){const source=visit.sourceViews.find(item=>item.viewId===evidence.viewId);if(source)observations.push({source,evidence,proposal,continuityLink:roomProposalContinuity(room,proposal)});}
 // Immutable observations keep their own source even if the visit projection is absent.
 for(const link of room.continuityLinks??[]){
  if(link.roomId!==room.roomId||link.nodeId!==node.id||link.state!=='active')continue;
  const observation=room.observations?.find(item=>item.observationId===link.observationId);
  if(observation)observations.push({source:observation.source,evidence:{viewId:observation.source.viewId,basis:observation.basis,...(observation.location?{location:observation.location}:{})},continuityLink:link});
 }
 return observations.sort((a,b)=>Date.parse(b.source.capturedAt)-Date.parse(a.source.capturedAt))[0];
}

/** Only an open view request in the explicitly selected room can focus new captures. */
export function activeRoomFollowup(state:RoomAutomationResponse|null,selection:Pick<RoomActionNeeded,'roomId'|'actionId'>|null){
 if(!state||!selection||state.declaration.roomId!==selection.roomId)return null;
 return state.actions.find(action=>action.actionId===selection.actionId&&action.roomId===selection.roomId&&action.kind==='view'&&action.status==='open')??null;
}
/** Snapshot at capture time; later focus changes never rewrite buffered frames. */
export function focusedRoomFrame<T extends CaptureFrameInput>(frame:T,focus:RoomActionNeeded|null):T & CaptureFrameInput{
 return focus?{...frame,roomFollowup:{roomId:focus.roomId,actionId:focus.actionId}}:frame;
}
export function roomProposalLabel(proposal:Proposal,room?:RoomMemory){
 const link=room&&roomProposalContinuity(room,proposal);
 if(link)return link.state==='active'?'Probably the same':'Match removed · earlier location kept';
 const evaluation=room&&roomProposalEvaluation(room,proposal);
 if(evaluation&&!proposal.viewDeferral)return evaluation.favoredHypothesis==='same-object'?'Probably the same':evaluation.favoredHypothesis==='similar-other'?'May be a different object':'Match uncertain';
 return proposal.viewDeferral?'Partial detail · earlier location kept':proposal.status==='likely-same'?'Probably the same':proposal.status==='not-observed'?'No new evidence':proposal.status==='different'?'Different appearance':'Match uncertain';
}
