import {createHash} from 'node:crypto';
import {z} from 'zod';
import {RoomRawComparisonRowSchema,roomComparisonJudgmentProblem,roomComparisonJudgmentExclusion,type RoomComparisonJudgment} from '../domain/room-comparison-judgment.ts';
import {RoomObserverResultSchema,type RoomObserverResult,type RoomObserverInput} from '../domain/room-observer-contracts.ts';
import {roomObserverAliases} from './room-observer-wire.ts';
import {validateRoomComparisons} from './room-comparison-policy.ts';
import type {roomObserverRequest} from './room-observer-provider.ts';
type Request=ReturnType<typeof roomObserverRequest>;
const outputSchema=z.strictObject({summary:z.string().max(600),comparisons:z.array(RoomRawComparisonRowSchema).max(16)});
export function comparisonCodeSupported(input:RoomObserverInput){return !input.followup&&!input.comparisonNodeIds&&!input.pendingActions?.length;}
/** Verbatim comparisonRequest v5 is the only model stage. This adapter never parses feature prose. */
export function assembleRoomComparisonCodeOutput(raw:string,input:RoomObserverInput,exactV5Request:Request){
 if(!comparisonCodeSupported(input))throw new Error('Comparison-code pilot is general-scan only; focused/scoped actions require the existing observer.');
 if(raw.length>64000)throw new Error('Comparison output exceeds bound.');
 const parsed=outputSchema.parse(JSON.parse(raw)),content=exactV5Request.input[1].content;if(!Array.isArray(content))throw new Error('Missing comparison request content.');
 const candidatePart=content.find(part=>typeof part!=='string'&&part.type==='input_text'&&part.text.startsWith('{"type":"untrusted_candidates"'));
 if(!candidatePart||typeof candidatePart==='string'||candidatePart.type!=='input_text')throw new Error('Missing exact comparator candidate context.');
 const currentImage=[...content].reverse().find(part=>typeof part!=='string'&&part.type==='input_image');
 if(!currentImage||typeof currentImage==='string'||currentImage.type!=='input_image'||currentImage.image_url!==`data:image/png;base64,${input.frameBytes.toString('base64')}`)throw new Error('Comparison request does not bind these CURRENT pixels.');
 const packet=JSON.parse(candidatePart.text),candidates=new Map<string,any>(packet.candidates.map((node:any)=>[node.id,node]));
 if(parsed.comparisons.length!==candidates.size)throw new Error('Every selected candidate requires exactly one original comparison row.');
 const reverse=new Map([...roomObserverAliases(input)].map(([id,alias])=>[alias,id])),seen=new Set<string>(),requestHash=createHash('sha256').update(JSON.stringify(exactV5Request)).digest('hex');
 const observations:RoomObserverResult['observations']=[];
 const decisions:Array<{candidateId:string;rawRow:z.infer<typeof RoomRawComparisonRowSchema>;providedHistoricalSourceHashes:string[];outcome:'comparison-observation'|'audit-only';reason:string;observationIndex:number|null}>=[];
 for(const row of parsed.comparisons){
  const candidate=candidates.get(row.memory_id),candidateId=reverse.get(row.memory_id),node=input.room.graph.nodes.find(node=>node.id===candidateId);
  if(!candidate||!candidateId||!node||seen.has(row.memory_id))throw new Error('Unknown or repeated comparator candidate.');seen.add(row.memory_id);
  const hashes:string[]=[...new Set<string>((candidate.allowedComparisonSourceHashes??[]).map((alias:string)=>{const hash=reverse.get(alias);if(!hash)throw new Error('Unknown comparator historical source alias.');return hash;}))];
  let reason='The original comparison does not provide an independent current object description, visibility flag or kind; preserve the candidate and record judgment only.';
  let observationIndex:number|null=null;
  if(row.relationship==='likely_same'&&row.current_location.trim()&&row.matching_visible_features.trim()){
   const judgment:RoomComparisonJudgment={protocol:'comparison-code-v1',candidateId,requestHash,currentSourceHash:input.frame.sourceHash,providedHistoricalSourceHashes:hashes,metadataOrigin:'inherited-candidate-label-and-kind',sourceUse:'provided-context-not-feature-citations',rawRow:row};
   const problem=roomComparisonJudgmentProblem(input.room,candidateId,judgment,input.frame,input.references.map(reference=>reference.source.sourceHash))??roomComparisonJudgmentExclusion(input.room,candidateId,judgment);
   if(problem)reason=problem;
   else{
    observationIndex=observations.length;observations.push({nodeId:candidateId,label:node.label,kind:node.kind,attributes:[],status:'likely-same',basis:`Context-conditioned comparator judgment: ${row.matching_visible_features}`,alternatives:row.contradictions_or_limits||'Original comparator judgment remains provisional; independent visual detail is unavailable.',location:row.current_location,needs:'none',comparisonJudgment:judgment});
    reason='Original likely_same assertion supplies location and claimed visible agreement; inherited metadata and unattributed historical context remain explicit. Reversible continuity is evaluated by code.';
   }
  }
  decisions.push({candidateId,rawRow:row,providedHistoricalSourceHashes:hashes,outcome:observationIndex===null?'audit-only':'comparison-observation',reason,observationIndex});
 }
 const result=RoomObserverResultSchema.parse({protocolVersion:2,summary:parsed.summary||'Context-conditioned comparator pass.',observations,containment:[],outsideContainment:[],support:[],actionAssessments:[]});
 validateRoomComparisons(result,input,input.references.map(reference=>reference.source.sourceHash));
 return {result,audit:{version:'comparison-code-v1' as const,requestHash,currentSourceHash:input.frame.sourceHash,rawComparison:parsed,decisions,limitations:['Original comparator has no explicit visibility field, new-object description/kind, relation endpoints or feature-level source citations.','Nonempty likely_same fields are model assertions; code does not semantically classify or verify their prose.','different and uncertain are audit-only: no canonical replacement object, support, containment, removal or historical-link retraction is inferred.','needs_more_view remains an original flag; no actionable request is invented.']}};
}
