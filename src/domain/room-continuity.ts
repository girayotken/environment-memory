import {roomComparisonJudgmentProblem,roomComparisonJudgmentExclusion} from './room-comparison-judgment.ts';
import {roomContinuityExclusions} from './room-continuity-exclusions.ts';
import {RoomAppearanceComparisonSchema,RoomCurrentAppearanceSchema,type RoomContinuityLink,type RoomMemory,type RoomObservationView,type RoomSourceView} from './room-memory-contracts.ts';
import type {RoomObservationCandidate} from './room-observation-graph.ts';

/** Persisted once alongside publication. Replaying these decisions never reevaluates legacy reports. */
export type RoomContinuityDecision={decisionId:string;policyVersion:1|2|3;roomId:string;nodeId:string|null;observationId:string;source:RoomSourceView;basis:string;activate:boolean;withdrawLinkIds:string[]};
const discriminating=new Set(['silhouette','construction','part-layout','surface-detail','markings','contents-detail']);
const time=(source:RoomSourceView)=>Date.parse(source.capturedAt);

/**
 * A reversible assistant-memory policy over source-bound model assertions. No
 * probabilities or physical identity claims. Chronology is publication-monotone:
 * stale/equal-time and reused-image reports are audited but never alter links.
 */
export function evaluateRoomContinuity(room:RoomMemory,observation:RoomObservationView,candidate:RoomObservationCandidate,priorDecisions:RoomContinuityDecision[]=[]):RoomContinuityDecision{
 const decision:RoomContinuityDecision={decisionId:`continuity-${observation.observationId}`,policyVersion:candidate.comparisonJudgment?3:2,roomId:room.roomId,nodeId:candidate.candidateNodeId,observationId:observation.observationId,source:structuredClone(observation.source),basis:'No adequate source-bound provisional continuity agreement.',activate:false,withdrawLinkIds:[]};
 const reject=(basis:string)=>({...decision,basis});
 const node=room.graph.nodes.find(node=>node.id===candidate.candidateNodeId),now=time(observation.source);
 if(!node||observation.roomId!==room.roomId||!Number.isFinite(now)||observation.capturedAt!==observation.source.capturedAt)return reject('No valid existing candidate and saved current source in this room.');
 const excluded=roomContinuityExclusions(room,node.id).sourceHashes;
 if(excluded.has(observation.source.sourceHash))return reject('The user separated this source from the candidate memory.');
 const previous=priorDecisions.filter(item=>item.roomId===room.roomId&&item.nodeId===node.id);
 const reusedHistory=room.visits.some(visit=>visit.sourceViews.some(source=>source.sourceHash===observation.source.sourceHash)&&visit.proposals.some(proposal=>proposal.nodeId===node.id&&proposal.observationId!==observation.observationId));
 if(reusedHistory||previous.some(item=>item.source.sourceHash===observation.source.sourceHash))return reject('Reused source cannot strengthen or reactivate provisional continuity.');
 if(previous.some(item=>time(item.source)>=now))return reject('Out-of-order or equal-time observation cannot change provisional continuity history.');
 if(candidate.comparisonJudgment){
  decision.policyVersion=3;
  const problem=roomComparisonJudgmentProblem(room,node.id,candidate.comparisonJudgment,observation.source)??roomComparisonJudgmentExclusion(room,node.id,candidate.comparisonJudgment);
  if(problem)return reject(problem);
  if(candidate.status!=='likely-same'||JSON.stringify(observation.comparisonJudgment)!==JSON.stringify(candidate.comparisonJudgment)||observation.location!==candidate.comparisonJudgment.rawRow.current_location.trim())return reject('Comparison judgment and saved comparison observation must agree.');
  decision.activate=true;decision.basis='Reversible working assignment from the original context-conditioned comparator likely_same judgment. Historical metadata is inherited; no independent current appearance, typed visual cues or feature citations were asserted by code.';return decision;
 }
 const parsed=RoomAppearanceComparisonSchema.safeParse(candidate.comparison),appearance=RoomCurrentAppearanceSchema.safeParse(observation.currentAppearance);
 if(!parsed.success||!appearance.success)return reject('Structured current appearance and comparison are required.');
 const comparison=parsed.data,visible=new Map(appearance.data.features.map(feature=>[feature.feature,feature.visible]));
 if(visible.size!==appearance.data.features.length||new Set(comparison.priorSourceHashes).size!==comparison.priorSourceHashes.length||new Set(comparison.features.map(feature=>`${feature.feature}\0${feature.priorSourceHash}`)).size!==comparison.features.length)return reject('Repeated features or source references do not add independent evidence.');
 const sources=[...room.graph.sourceViews,...room.visits.flatMap(visit=>visit.sourceViews)];
 const anchors=new Set((room.graph.nodeAnchorEvidence?.[node.id]??node.evidence).map(item=>item.viewId));
 const candidateViews=new Set([...node.evidence,...room.visits.flatMap(visit=>visit.proposals.filter(proposal=>proposal.nodeId===node.id).flatMap(proposal=>proposal.evidence))].map(item=>item.viewId));
 const earlier=(source:RoomSourceView)=>Number.isFinite(time(source))&&time(source)<now&&source.sourceHash!==observation.source.sourceHash;
 const originalHashes=new Set(sources.filter(source=>anchors.has(source.viewId)&&earlier(source)).map(source=>source.sourceHash));
 const boundHashes=new Set(sources.filter(source=>candidateViews.has(source.viewId)&&earlier(source)).map(source=>source.sourceHash));
 if(!comparison.features.length||comparison.priorSourceHashes.some(hash=>!boundHashes.has(hash))||comparison.features.some(feature=>!boundHashes.has(feature.priorSourceHash)||!comparison.priorSourceHashes.includes(feature.priorSourceHash)||!visible.has(feature.feature)||feature.result!=='not-visible'&&!visible.get(feature.feature)))return reject('Comparison lacks an exact earlier candidate-bound, visibly comparable source.');
 const original=comparison.features.filter(feature=>originalHashes.has(feature.priorSourceHash));
 const matching=comparison.features.filter(feature=>feature.result==='same'&&visible.get(feature.feature)&&!['location','state'].includes(feature.kind));
 const originalMatching=original.filter(feature=>feature.result==='same'&&visible.get(feature.feature)&&!['location','state'].includes(feature.kind)&&!excluded.has(feature.priorSourceHash));
 const differences=comparison.features.filter(feature=>feature.result==='different'&&!['location','state'].includes(feature.kind));
 // The model owns the probable-same judgment. Missing fine detail and uncertain
 // physical identity do not prevent a useful, reversible working assignment.
 if(candidate.status==='likely-same'&&matching.length&&!differences.length&&comparison.limitation!=='history-conflict'&&!matching.some(feature=>excluded.has(feature.priorSourceHash))){
  decision.activate=true;decision.basis='Provisional continuity from a source-bound probable-same appearance judgment in remembered context. Missing fine detail may remain; this working assignment does not confirm physical identity.';
 }
 // A newly different object is not evidence against a correct earlier link. Only
 // explicit contradiction of that exact link source, plus original agreement,
 // retracts that historical working assignment.
 if(['likely-same','uncertain'].includes(candidate.status??'')&&originalMatching.length&&!original.some(feature=>feature.result==='different'&&!['location','state'].includes(feature.kind))&&differences.length){
  decision.withdrawLinkIds=(room.continuityLinks??[]).filter(link=>link.state==='active'&&link.roomId===room.roomId&&link.nodeId===node.id&&time(link.source)<now&&differences.some(feature=>feature.priorSourceHash===link.source.sourceHash&&discriminating.has(feature.kind))).map(link=>link.linkId);
  if(decision.withdrawLinkIds.length)decision.basis='Provisional retraction: visible discriminating contradiction explicitly targets an earlier linked source while current detail agrees with the original. This does not prove physical replacement.';
 }
 return decision;
}

/** Immutable decision log is the authority; link status is a deterministic projection. */
export function projectRoomContinuity(decisions:RoomContinuityDecision[]):RoomContinuityLink[]{
 const links:RoomContinuityLink[]=[];
 for(const decision of decisions){
  for(const link of links)if(link.state==='active'&&decision.withdrawLinkIds.includes(link.linkId)&&link.roomId===decision.roomId&&link.nodeId===decision.nodeId){link.state='withdrawn';link.withdrawal={observationId:decision.observationId,source:structuredClone(decision.source),basis:decision.basis};}
  if(decision.activate&&decision.nodeId&&!links.some(link=>link.linkId===decision.decisionId))links.push({linkId:decision.decisionId,roomId:decision.roomId,nodeId:decision.nodeId,observationId:decision.observationId,source:structuredClone(decision.source),state:'active',basis:decision.basis});
 }
 return links;
}
