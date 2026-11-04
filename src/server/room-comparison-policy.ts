import {roomComparisonJudgmentProblem} from '../domain/room-comparison-judgment.ts';
import {roomContinuityExclusions} from '../domain/room-continuity-exclusions.ts';
import type {RoomObserverInput,RoomObserverResult} from '../domain/room-observer-contracts.ts';
import {roomNodeAnchorSourceHashes} from './room-observer-context.ts';

const discriminating=(kind:string)=>!['category','colour','location','state'].includes(kind);
const appearanceDifference=(kind:string)=>!['location','state'].includes(kind);
/** These gates validate model assertions and source binding, not the truth of its perception. */
export function validateRoomComparisons(result:RoomObserverResult,input:Pick<RoomObserverInput,'room'|'comparisonNodeIds'> & Partial<Pick<RoomObserverInput,'frame'>>,referenceSourceHashes:string[]){
 if(result.protocolVersion!==2)throw new Error('New room observations require comparison protocol version 2.');
 const supplied=new Set(referenceSourceHashes),scope=input.comparisonNodeIds;
 if(scope&&(scope.length<1||scope.length>4||new Set(scope).size!==scope.length||scope.some(id=>!input.room.graph.nodes.some(n=>n.id===id))))throw new Error('Comparison scope requires one to four distinct room nodes.');
 if(scope&&result.observations.some(o=>o.nodeId===null||!scope.includes(o.nodeId)))throw new Error('Observation is outside the requested comparison scope.');
 for(const observation of result.observations){
  if(observation.comparisonJudgment){
   const inherited=input.room.graph.nodes.find(node=>node.id===observation.nodeId);if(!inherited||observation.label!==inherited.label||observation.kind!==inherited.kind||observation.attributes.length||observation.semanticUnknown||observation.viewDeferral||observation.request)throw new Error('Comparison-only metadata must remain explicitly inherited from the candidate.');
   if(!input.frame||!observation.nodeId||observation.status!=='likely-same'||observation.currentAppearance||observation.comparison||observation.needs!=='none'||observation.location!==observation.comparisonJudgment.rawRow.current_location.trim())throw new Error('Comparison-only judgment cannot masquerade as independently described typed appearance.');
   const problem=roomComparisonJudgmentProblem(input.room,observation.nodeId,observation.comparisonJudgment,input.frame,referenceSourceHashes);if(problem)throw new Error(problem);continue;
  }
  const current=observation.currentAppearance,comparison=observation.comparison;
  if(!current||!comparison)throw new Error('Current appearance and source-bound comparison are required.');
  const visible=new Map(current.features.map(feature=>[feature.feature,feature.visible]));
  if(visible.size!==current.features.length||new Set(comparison.priorSourceHashes).size!==comparison.priorSourceHashes.length)throw new Error('Duplicate current feature or comparison source.');
  if(comparison.priorSourceHashes.some(hash=>!supplied.has(hash))||comparison.features.some(f=>!supplied.has(f.priorSourceHash)||!comparison.priorSourceHashes.includes(f.priorSourceHash)))throw new Error('Comparison must cite exact historical source hashes actually supplied.');
  const keys=comparison.features.map(f=>f.feature+'\0'+f.priorSourceHash);
  if(new Set(keys).size!==keys.length)throw new Error('Duplicate comparison feature and source.');
  for(const feature of comparison.features){
   if(!visible.has(feature.feature))throw new Error('Compared feature must have a separate current appearance entry.');
   if(feature.result!=='not-visible'&&!visible.get(feature.feature))throw new Error('An invisible feature cannot be treated as same or different.');
  }
  if(observation.nodeId===null){
   if(observation.status!=='uncertain'||comparison.adequateDiscriminatingEvidence||comparison.features.length||comparison.priorSourceHashes.length)throw new Error('Unmatched observations remain uncertain without an invented historical correspondence.');
   continue;
  }
  const anchors=new Set(roomNodeAnchorSourceHashes(input.room,observation.nodeId));
  const nodeViews=new Set([...input.room.graph.nodes.find(n=>n.id===observation.nodeId)!.evidence,...input.room.visits.flatMap(v=>v.proposals.filter(p=>p.nodeId===observation.nodeId).flatMap(p=>p.evidence))].map(e=>e.viewId));
  const nodeSources=new Set([...input.room.graph.sourceViews,...input.room.visits.flatMap(v=>v.sourceViews)].filter(s=>nodeViews.has(s.viewId)).map(s=>s.sourceHash));
  if(comparison.priorSourceHashes.some(hash=>!nodeSources.has(hash)))throw new Error('Every historical comparison source must belong to the compared node.');
  const anchorFeatures=comparison.features.filter(f=>anchors.has(f.priorSourceHash)&&discriminating(f.kind));
  const matching=anchorFeatures.filter(f=>f.result==='same'&&visible.get(f.feature));
  const enough=matching.length>0;
  const laterContradiction=comparison.features.some(f=>!anchors.has(f.priorSourceHash)&&appearanceDifference(f.kind)&&f.result==='different');
  if(comparison.limitation==='history-conflict'&&(observation.status!=='uncertain'||observation.needs!=='none'||!enough||!laterContradiction))throw new Error('History-conflict requires adequate current original agreement and a visible later contradiction, with uncertain status and no new view request.');
  const contradiction=comparison.features.some(f=>appearanceDifference(f.kind)&&f.result==='different');
  const excluded=roomContinuityExclusions(input.room,observation.nodeId).sourceHashes;
  if(observation.status==='likely-same'&&comparison.features.some(f=>f.result==='same'&&excluded.has(f.priorSourceHash)))throw new Error('User-separated references cannot support likely-same for this memory.');
  const workingAgreement=comparison.features.some(f=>!['location','state'].includes(f.kind)&&f.result==='same'&&visible.get(f.feature));
  if(observation.status==='likely-same'&&(!workingAgreement||contradiction||comparison.limitation==='history-conflict'))throw new Error('Likely-same requires source-bound visible appearance agreement without an explicit appearance contradiction.');
  if(observation.status==='different'&&!comparison.features.some(f=>anchors.has(f.priorSourceHash)&&appearanceDifference(f.kind)&&f.result==='different'))throw new Error('Different appearance requires a discriminating original-source contradiction.');
  if(observation.needs==='view'&&(!['current-detail','both'].includes(comparison.limitation)||!comparison.features.some(f=>f.result==='not-visible')))throw new Error('A new view request must identify an unresolved visible-detail comparison that current pixels can improve.');
 }
 if(scope&&scope.some(id=>!result.observations.some(o=>o.nodeId===id)))throw new Error('Requested comparison nodes require explicit observations, including insufficient visibility.');
}
