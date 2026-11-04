import {z} from 'zod';
import type {RoomMemory} from './room-memory-contracts.ts';
import {roomContinuityExclusions} from './room-continuity-exclusions.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().max(320);
/** Original v5 comparator fields, preserved verbatim; these are not typed pixel cues. */
export const RoomRawComparisonRowSchema=z.strictObject({memory_id:z.string().min(1),current_location:text,relationship:z.enum(['likely_same','different','uncertain']),matching_visible_features:text,contradictions_or_limits:text,needs_more_view:z.boolean()});
export const RoomComparisonJudgmentSchema=z.strictObject({protocol:z.literal('comparison-code-v1'),candidateId:z.string().min(1).max(200),requestHash:hash,currentSourceHash:hash,providedHistoricalSourceHashes:z.array(hash).min(1).max(2),metadataOrigin:z.literal('inherited-candidate-label-and-kind'),sourceUse:z.literal('provided-context-not-feature-citations'),rawRow:RoomRawComparisonRowSchema});
export type RoomComparisonJudgment=z.infer<typeof RoomComparisonJudgmentSchema>;
/** This validates structural context and chronology, never interprets the model's prose. */
export function roomComparisonJudgmentProblem(room:RoomMemory,nodeId:string,judgment:RoomComparisonJudgment,current:{sourceHash:string;capturedAt:string},provided?:string[]):string|null{
 const node=room.graph.nodes.find(node=>node.id===nodeId),now=Date.parse(current.capturedAt);
 if(!node||judgment.candidateId!==nodeId||judgment.currentSourceHash!==current.sourceHash||!Number.isFinite(now))return 'Comparison judgment does not bind this candidate and current saved source.';
 if(judgment.rawRow.relationship!=='likely_same'||!judgment.rawRow.current_location.trim()||!judgment.rawRow.matching_visible_features.trim())return 'Comparison-only continuity requires explicit likely_same, location and claimed visible agreement.';
 const hashes=judgment.providedHistoricalSourceHashes;
 if(new Set(hashes).size!==hashes.length)return 'Duplicate comparison context sources.';
 const views=new Set([...node.evidence,...room.visits.flatMap(visit=>visit.proposals.filter(proposal=>proposal.nodeId===nodeId).flatMap(proposal=>proposal.evidence))].map(evidence=>evidence.viewId));
 const sources=[...room.graph.sourceViews,...room.visits.flatMap(visit=>visit.sourceViews)];
 if(hashes.some(hash=>hash===current.sourceHash||(provided&&!provided.includes(hash))||!sources.some(source=>views.has(source.viewId)&&source.sourceHash===hash&&Date.parse(source.capturedAt)<now)))return 'Comparison context must contain exact supplied earlier candidate sources, excluding CURRENT.';
 return null;
}
/** Unknown source attribution cannot positively revive a separated/withdrawn reference. */
export function roomComparisonJudgmentExclusion(room:RoomMemory,nodeId:string,judgment:RoomComparisonJudgment):string|null{
 const excluded=roomContinuityExclusions(room,nodeId).sourceHashes;
 if(excluded.has(judgment.currentSourceHash)||judgment.providedHistoricalSourceHashes.some(hash=>excluded.has(hash)))return 'User-separated current or historical context cannot support comparison-only continuity.';
 if(judgment.providedHistoricalSourceHashes.some(hash=>room.continuityLinks?.some(link=>link.nodeId===nodeId&&link.source.sourceHash===hash&&link.state==='withdrawn')))return 'Withdrawn context is comparison-only; un-attributed positive source use cannot be resolved.';
 return null;
}
