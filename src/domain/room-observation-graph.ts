import type {RoomComparisonJudgment} from './room-comparison-judgment.ts';
import type {RoomMemory,RoomSourceView,RoomObservationView,RoomAppearanceComparisonSchema} from './room-memory-contracts.ts';
import type {z} from 'zod';

export type RoomObservationCandidate={candidateNodeId:string|null;comparisonJudgment?:RoomComparisonJudgment;comparison?:z.infer<typeof RoomAppearanceComparisonSchema>;status?:'likely-same'|'uncertain'|'different'|'not-observed';basis?:string;alternatives?:string;conditioning?:'context-conditioned'|'independent'};
export type RoomObservationHypothesis='same-object'|'similar-other'|'uncertain';
export type RoomObservationGraphEvidence={
 kind:'comparison-judgment'|'current-observation'|'original-comparison'|'later-comparison'|'relation-context'|'identity-gap';
 basis:string;sources:RoomSourceView[];
};
export type RoomObservationAlternative={
 hypothesis:RoomObservationHypothesis;assessment:'possible'|'supported'|'unresolved';
 support:RoomObservationGraphEvidence[];counterEvidence:RoomObservationGraphEvidence[];missingEvidence:RoomObservationGraphEvidence[];
};
export type RoomObservationGraphEvaluation={
 protocolVersion:1;observationId:string;candidateNodeId:string|null;favoredHypothesis:RoomObservationHypothesis;identityStatus:'provisional';evidenceConditioning:'context-conditioned'|'independent';
 appearance:'matching'|'different'|'insufficient'|'conflicting';
 alternatives:[RoomObservationAlternative,RoomObservationAlternative,RoomObservationAlternative];
 contextRelations:Array<{from:string;to:string;relation:string;status:'observed'|'inferred';evidence:RoomObservationGraphEvidence[]}>;
};

/**
 * Inspectable v0 over existing source-bound reports. It assesses appearance, not
 * pixels or calibrated probability. The v2 report has no continuity observation
 * or verified identity evidence: hypotheses can be favored, never confirmed.
 * A candidate can be reconsidered without changing the saved observation.
 */
export function evaluateRoomObservationGraph(room:RoomMemory,observation:RoomObservationView,candidate:RoomObservationCandidate):RoomObservationGraphEvaluation{
 const source=observation.source,raw=observation,candidateNodeId=candidate.candidateNodeId;
 const allSources=[...room.graph.sourceViews,...room.visits.flatMap(visit=>visit.sourceViews)];
 const node=room.graph.nodes.find(item=>item.id===candidateNodeId);
 const originalViews=new Set((room.graph.nodeAnchorEvidence?.[candidateNodeId??'']??node?.evidence??[]).map(evidence=>evidence.viewId));
 const originalSources=allSources.filter(item=>originalViews.has(item.viewId));
 const earlier=(item:RoomSourceView)=>item.sourceHash!==source.sourceHash&&Number.isFinite(Date.parse(item.capturedAt))&&Date.parse(item.capturedAt)<Date.parse(source.capturedAt);
 const unique=(items:RoomSourceView[])=>[...new Map(items.map(item=>[item.viewId,item])).values()];
 const evidence=(kind:RoomObservationGraphEvidence['kind'],basis:string,sources:RoomSourceView[]=[source]):RoomObservationGraphEvidence=>({kind,basis,sources:structuredClone(unique(sources))});
 const same:RoomObservationAlternative={hypothesis:'same-object',assessment:'possible',support:[],counterEvidence:[],missingEvidence:[]};
 const other:RoomObservationAlternative={hypothesis:'similar-other',assessment:'possible',support:[],counterEvidence:[],missingEvidence:[]};
 const uncertain:RoomObservationAlternative={hypothesis:'uncertain',assessment:'supported',support:[],counterEvidence:[],missingEvidence:[]};
 const missing=(basis:string,sources:RoomSourceView[]=[source])=>{
  const item=evidence('identity-gap',basis,sources);same.missingEvidence.push(item);other.missingEvidence.push(structuredClone(item));uncertain.support.push(structuredClone(item));
 };
 const current=evidence(candidate.comparisonJudgment?'comparison-judgment':'current-observation',raw.currentAppearance?.description??raw.basis);
 if(candidate.comparisonJudgment)missing('Context-conditioned comparator judgment has no independently described current appearance or feature-level source citations.');
 same.support.push(current);other.support.push(structuredClone(current));
 if(observation.roomId!==room.roomId||!node)missing('No existing candidate in this room is established for this independent observation.');
 if(!raw.currentAppearance)missing('The saved report does not separate visible current appearance from its assignment hypothesis.');
 const comparison=candidate.comparison;
 const matches:RoomObservationGraphEvidence[]=[],differences:RoomObservationGraphEvidence[]=[],distinctMatches:RoomObservationGraphEvidence[]=[];
 let unresolvedDetail=false,laterAppearanceContradiction=false;
 const compared=new Set<string>();
 // Comparison statements describe the originally proposed candidate only.
 if(comparison&&node&&observation.roomId===room.roomId){
  const visible=new Map(raw.currentAppearance?.features.map(feature=>[feature.feature,feature.visible])??[]);
  const candidateViews=new Set([...node.evidence,...room.visits.flatMap(visit=>visit.proposals.filter(proposal=>proposal.nodeId===node.id).flatMap(proposal=>proposal.evidence))].map(item=>item.viewId));
  for(const feature of comparison.features){
   const key=feature.feature+'\0'+feature.priorSourceHash;
   if(compared.has(key)){unresolvedDetail=true;missing(`Repeated comparison of ${feature.feature} does not add independent evidence.`);continue;}
   compared.add(key);
   const prior=allSources.find(item=>item.sourceHash===feature.priorSourceHash&&candidateViews.has(item.viewId)&&earlier(item));
   if(!prior||!comparison.priorSourceHashes.includes(feature.priorSourceHash)){
    unresolvedDetail=true;missing(`Comparison of ${feature.feature} lacks an exact, earlier candidate-bound historical source.`);continue;
   }
   const original=originalSources.some(item=>item.sourceHash===prior.sourceHash&&earlier(item));
   const identityRelevance=feature.identityRelevance??'unassessed';
   const item=evidence(original?'original-comparison':'later-comparison',`${feature.feature} (${feature.kind}; identity relevance: ${identityRelevance}): ${feature.result}. Current: ${feature.currentBasis} Historical: ${feature.historicalBasis} Identity relevance is a model assertion, not proof of uniqueness.`,[source,prior]);
   if(!original){
    uncertain.support.push(item);
    if(feature.result==='different'&&visible.get(feature.feature)&&!['category','location','state'].includes(feature.kind)){
     laterAppearanceContradiction=true;same.counterEvidence.push(structuredClone(item));
     missing('A visible later appearance contradiction leaves the candidate history in conflict.',[source,prior]);
    }
    missing('A later tentative assignment supplies historical context but cannot independently establish the original object identity.',[source,prior]);continue;
   }
   if(feature.result==='not-visible'||!visible.get(feature.feature)){
    unresolvedDetail=true;missing(`The current report cannot visibly compare ${feature.feature}.`,[source,prior]);continue;
   }
   if(feature.result==='same'){
    same.support.push(item);other.support.push(evidence('identity-gap',`Shared ${feature.kind} appearance is also compatible with a similar other object.`,[source,prior]));
    // Location agreements are context, not appearance discrimination.
    if(!['location','state'].includes(feature.kind))matches.push(item);
    if(feature.kind==='markings'&&identityRelevance==='potentially-instance-specific')distinctMatches.push(item);
   }else{
    if(['location','state'].includes(feature.kind)){
     same.support.push(evidence('relation-context','A changed location or reversible state is compatible with the same object.',[source,prior]));continue;
    }
    if(feature.kind!=='category')differences.push(item);else unresolvedDetail=true;
    same.counterEvidence.push(item);other.support.push(structuredClone(item));
    other.counterEvidence.push(evidence('identity-gap','Visible appearance can change on the same object; this difference does not prove replacement.',[source,prior]));
   }
  }
  if(comparison.limitation!=='none')missing(`The source report retains a comparison limitation: ${comparison.limitation}.`,[source,...originalSources.filter(earlier)]);
  if(!comparison.adequateDiscriminatingEvidence)missing('The source report does not assert adequate discriminating comparison evidence.',[source,...originalSources.filter(earlier)]);
 }else missing('No source-bound feature comparison for this candidate is present in the saved report.');
 if(!originalSources.some(earlier))missing('No earlier original candidate source is available for this observation.');
 const appearance=matches.length&&(differences.length||laterAppearanceContradiction)?'conflicting':differences.length?'different':matches.length?'matching':'insufficient';
 const favoredHypothesis:RoomObservationHypothesis=differences.length&&distinctMatches.length?'uncertain':differences.length?'similar-other':distinctMatches.length&&!unresolvedDetail&&!laterAppearanceContradiction&&comparison?.adequateDiscriminatingEvidence===true&&comparison.limitation==='none'?'same-object':'uncertain';
 if(favoredHypothesis==='similar-other')other.assessment='supported';
 if(favoredHypothesis==='same-object')same.assessment='supported';
 uncertain.assessment=favoredHypothesis==='uncertain'?'supported':'possible';
 if(favoredHypothesis==='same-object')uncertain.counterEvidence.push(...structuredClone(distinctMatches));
 if(favoredHypothesis==='similar-other')uncertain.counterEvidence.push(...structuredClone(differences));
 uncertain.missingEvidence.push(evidence('identity-gap','Independent discriminating evidence or an attributed continuity decision is still required.',[source,...originalSources.filter(earlier)]));
 missing('Existing appearance reports do not distinguish physical continuity from an identical or similar replacement.',[source,...originalSources.filter(earlier)]);
 if(candidate.status==='likely-same')uncertain.support.push(evidence('identity-gap','The observer proposed likely-same; this tentative assignment is a hypothesis, not independent identity evidence.'));
 const contextRelations=observation.roomId===room.roomId&&node?room.graph.edges.filter(edge=>edge.from===node.id||edge.to===node.id).map(edge=>({
  from:edge.from,to:edge.to,relation:edge.relation,status:edge.status,
  evidence:edge.evidence.map(item=>evidence('relation-context',`${item.basis} Historical graph relation is context only; it does not prove the current object identity.`,allSources.filter(candidate=>candidate.viewId===item.viewId&&earlier(candidate)))),
 })):[];
 return {protocolVersion:1,observationId:observation.observationId,candidateNodeId,favoredHypothesis,identityStatus:'provisional',evidenceConditioning:candidate.conditioning??'context-conditioned',appearance,alternatives:[same,other,uncertain],contextRelations};
}
