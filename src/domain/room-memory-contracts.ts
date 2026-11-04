import {RoomComparisonJudgmentSchema} from './room-comparison-judgment.ts';
import type {RoomUserEdit} from './room-user-edit.ts';
import {z} from 'zod';
import type {RoomObservationCandidate,RoomObservationGraphEvaluation} from './room-observation-graph.ts';
const id=z.string().min(1).max(200),text=z.string().min(1).max(4000),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const RoomSourceSchema=z.strictObject({viewId:id,frameId:id,sourceHash:hash});
export const RoomEvidenceSchema=z.strictObject({viewId:id,basis:text,location:text.optional()});
const evidence=z.array(RoomEvidenceSchema).min(1).max(100);
/** Current pixels and historical comparison are stored separately; neither confirms identity. */
export const RoomCurrentAppearanceSchema=z.strictObject({description:text,features:z.array(z.strictObject({feature:text,description:text,visible:z.boolean()})).min(1).max(12)});
export const RoomFeatureComparisonSchema=z.strictObject({feature:text,kind:z.enum(['category','colour','location','state','silhouette','construction','part-layout','surface-detail','markings','contents-detail']),identityRelevance:z.enum(['shared-design','potentially-instance-specific','unassessed']).optional(),result:z.enum(['same','different','not-visible']),currentBasis:text,historicalBasis:text,priorSourceHash:hash});
export const RoomAppearanceComparisonSchema=z.strictObject({priorSourceHashes:z.array(hash).max(2),features:z.array(RoomFeatureComparisonSchema).max(12),adequateDiscriminatingEvidence:z.boolean(),limitation:z.enum(['none','current-detail','historical-detail','both','history-conflict'])});
/** Immutable description of one saved image region. Identity candidates belong to separate graph hypotheses. */
export const RoomObservationSchema=z.strictObject({observationId:id,jobId:id,roomId:id,source:RoomSourceSchema,capturedAt:z.string().datetime({offset:true}),provenance:z.enum(['agent-derived','authored-test']),label:text,kind:z.enum(['place','support','fixture','portable','container','contents_group']),attributes:z.array(text).max(12),basis:text,location:text.optional(),semanticUnknown:text.optional(),currentAppearance:RoomCurrentAppearanceSchema.optional(),comparisonJudgment:RoomComparisonJudgmentSchema.optional()});
export type RoomObservation=z.infer<typeof RoomObservationSchema>;
export const RoomCurrentObservationReportSchema=RoomObservationSchema.omit({observationId:true,jobId:true,roomId:true,source:true,capturedAt:true,provenance:true});
export type RoomCurrentObservationReport=z.infer<typeof RoomCurrentObservationReportSchema>;
export type RoomObservationView=Omit<RoomObservation,'source'> & {source:RoomSourceView};
export type RoomObservationGraphHypothesis={hypothesisId:string;jobId:string;roomId:string;observationId:string;candidate:RoomObservationCandidate;evaluation:RoomObservationGraphEvaluation};
export const RoomGraphSchema=z.strictObject({
 scope:text,sourceViews:z.array(RoomSourceSchema).max(100),
 nodes:z.array(z.strictObject({id,label:text,kind:z.enum(['place','support','fixture','portable','container','contents_group']),status:z.literal('provisional'),attributes:z.array(text).max(100),semantic:z.strictObject({status:z.literal('unknown'),description:text}).optional(),evidence})).max(200),
 edges:z.array(z.strictObject({from:id,to:id,relation:z.enum(['on','inside','mounted_on','part_of','near']),status:z.enum(['observed','inferred']),evidence})).max(1000),
 identityGroups:z.array(z.strictObject({nodeId:id,viewIds:z.array(id).min(2).max(100),status:z.literal('provisional'),basis:text,alternatives:text,evidence})).max(200),
 unknowns:z.array(text).max(100),nodeOrigins:z.record(id,z.array(id).max(100)),
 reviewNotes:z.array(z.strictObject({type:id,basis:text,origins:z.array(id).max(100).optional(),finalId:id.optional(),finalIds:z.array(id).max(100).optional()})).max(200),
});
export const RoomInitialImportSchema=z.strictObject({schemaVersion:z.literal(1),importId:id,roomId:id,label:text,graph:RoomGraphSchema});
export const RoomVisitImportSchema=z.strictObject({schemaVersion:z.literal(1),importId:id,roomId:id,visitId:id,label:text,summary:text,sourceViews:z.array(RoomSourceSchema).min(1).max(100),proposals:z.array(z.strictObject({id,nodeId:id,status:z.enum(['likely-same','uncertain','not-observed','different']),observationId:id.nullable(),label:text.optional(),basis:text,evidence,alternatives:text,currentAppearance:RoomCurrentAppearanceSchema.optional(),comparison:RoomAppearanceComparisonSchema.optional(),comparisonJudgment:RoomComparisonJudgmentSchema.optional(),viewDeferral:z.strictObject({reason:z.literal('peripheral-partial-view'),basis:text,priorEvidence:evidence}).optional()})).max(200)});
export type RoomGraph=z.infer<typeof RoomGraphSchema>;
export type RoomSource=z.infer<typeof RoomSourceSchema>;
export type RoomVisitImport=z.infer<typeof RoomVisitImportSchema>;
export type RoomInitialImport=z.infer<typeof RoomInitialImportSchema>;
export type RoomSourceView=RoomSource & {imageUrl:string;capturedAt:string};
/** A reversible working continuity assignment, never a physical-identity confirmation. */
export type RoomContinuityLink={linkId:string;roomId:string;nodeId:string;observationId:string;source:RoomSourceView;state:'active'|'withdrawn';basis:string;withdrawal?:{observationId:string;source:RoomSourceView;basis:string;attribution?:'user';correctionId?:string}};
export const RoomContinuityCorrectionSchema=z.strictObject({operationId:id,roomId:id,nodeId:id,linkId:id});
export const RoomContinuityCorrectionUndoSchema=z.strictObject({operationId:id,roomId:id,nodeId:id,correctionId:id});
/** User separation is a reversible overlay; observations and model history stay immutable. */
export const RoomContinuityCorrectionRecordSchema=z.strictObject({correctionId:id,roomId:id,nodeId:id,linkId:id,observationId:id,separatedNodeId:id,source:RoomSourceSchema.extend({capturedAt:z.string().datetime({offset:true}),imageUrl:z.string().min(1)}),attribution:z.literal('user'),createdAt:z.string().datetime({offset:true}),withdrawn:z.boolean()});
export type RoomContinuityCorrection=z.infer<typeof RoomContinuityCorrectionRecordSchema>;
export type RoomMemoryVisit=Omit<RoomVisitImport,'sourceViews'> & {sourceViews:RoomSourceView[];provenance:'agent-derived'|'authored-test'};
export const RoomSemanticAnswerSchema=z.strictObject({operationId:id,roomId:id,nodeId:id,label:z.string().trim().min(1).max(200)});
export const RoomSemanticUndoSchema=z.strictObject({operationId:id,roomId:id,nodeId:id,revisionId:id});
export type RoomSemanticRevision={revisionId:string;roomId:string;nodeId:string;label:string;attribution:'user';createdAt:string;withdrawn:boolean};
/** Semantic uncertainty is independent of cross-visit identity. Legacy evidence is retained verbatim. */
export function roomUnknownDescription(node:RoomGraph['nodes'][number]):string|null{
 if(node.semantic)return node.semantic.description;
 // Older room imports used descriptive labels and attributes instead of a typed semantic state.
 if(node.attributes.some(a=>/^(?:object (?:type|kind) (?:is )?unknown|unresolved object (?:type|kind)|whether this is separate contents or part of container remains uncertain)[.!]?$/i.test(a.trim())))return node.attributes.join(' · ');
 return null;
}
export type ContainmentEvent={operationId:string;roomId:string;itemId:string;containerId:string;action:'put-in'|'remove'|'reject'|'outside';statement:string;attribution:'user'|'model';recordedAt:string;source:RoomSourceView;withdrawn:boolean;invalidated?:boolean};
export type RoomContainment={revision:number;events:ContainmentEvent[];active:Array<ContainmentEvent & {containerLabel:string;containerLastSeen:{location:string|null;capturedAt:string;source:RoomSourceView;identityMatch:'probable'|null}|null}>};
export type RoomSupportEvidence={itemId:string;supportId:string;statement:string;attribution:'model';source:RoomSourceView;invalidated:boolean};
export type RoomMemory={supportEvidence?:RoomSupportEvidence[];containment?:RoomContainment;userEdits?:RoomUserEdit[];roomId:string;label:string;provenance:'agent-derived';graph:Omit<RoomGraph,'sourceViews'> & {sourceViews:RoomSourceView[];nodeAnchorEvidence?:Record<string,z.infer<typeof RoomEvidenceSchema>[]>};visits:RoomMemoryVisit[];semanticRevisions?:RoomSemanticRevision[];observations?:RoomObservationView[];graphHypotheses?:RoomObservationGraphHypothesis[];continuityLinks?:RoomContinuityLink[];continuityEvaluatedObservationIds?:string[];continuityCorrections?:RoomContinuityCorrection[]};
export type RoomMemoryResponse={rooms:RoomMemory[]};
