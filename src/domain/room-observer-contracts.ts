import {RoomComparisonJudgmentSchema} from './room-comparison-judgment.ts';
import {z} from 'zod';
import type {CapturedFrame} from './capture-contracts.ts';
import {RoomCurrentAppearanceSchema,RoomAppearanceComparisonSchema,type RoomCurrentObservationReport,type RoomMemory,type RoomSourceView} from './room-memory-contracts.ts';
const text=z.string().trim().min(1).max(2000);
/** The provider describes visible hypotheses only. New IDs, evidence and timestamps belong to the server. */
export const RoomObserverResultSchema=z.strictObject({protocolVersion:z.literal(2).optional(),summary:text,support:z.array(z.strictObject({itemIndex:z.number().int().nonnegative(),supportIndex:z.number().int().nonnegative(),basis:text})).max(16).optional(),outsideContainment:z.array(z.strictObject({itemIndex:z.number().int().nonnegative(),containerIndex:z.number().int().nonnegative(),basis:text})).max(16).optional(),containment:z.array(z.strictObject({itemIndex:z.number().int().nonnegative(),containerIndex:z.number().int().nonnegative(),basis:text})).max(16).optional(),observations:z.array(z.strictObject({
 comparisonJudgment:RoomComparisonJudgmentSchema.optional(),currentAppearance:RoomCurrentAppearanceSchema.optional(),comparison:RoomAppearanceComparisonSchema.optional(),nodeId:z.string().min(1).max(200).nullable(),label:text,kind:z.enum(['place','support','fixture','portable','container','contents_group']),attributes:z.array(text).max(12),status:z.enum(['likely-same','uncertain','different']),basis:text,alternatives:text,location:text.optional(),semanticUnknown:text.optional(),needs:z.enum(['none','view','explanation']),request:text.optional(),viewDeferral:z.strictObject({reason:z.literal('peripheral-partial-view'),basis:text}).optional(),
})).max(16),actionAssessments:z.array(z.strictObject({actionId:z.string().min(1).max(200),nodeId:z.string().min(1).max(200),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(['addressed','unresolved']),basis:text})).max(16).optional()});
export type RoomObserverResult=z.infer<typeof RoomObserverResultSchema>;
/** A valid current-image description survives a rejected identity/comparison report. */
export class RoomObserverAssociationError extends Error {
 constructor(message:string,readonly currentObservations:RoomCurrentObservationReport[]){super(message);this.name='RoomObserverAssociationError';}
}
export type RoomObserverInput={room:RoomMemory;frame:CapturedFrame;frameBytes:Buffer;references:Array<{source:RoomSourceView;bytes:Buffer}>;pendingActions?:RoomActionNeeded[];resolvedViewActions?:RoomActionNeeded[];followup?:RoomFollowupScope;comparisonNodeIds?:string[]};
export interface RoomObserverProvider {name:string;paid:boolean;observe(input:RoomObserverInput):Promise<unknown>}
export type RoomAutomationDeclaration={roomId:string|null;enabled:boolean;afterSequence:number};
export type RoomFollowupScope={actionId:string;nodeId:string;request:string;sourceHash:string};
export type RoomAutomationJob={referenceSourceHashes?:string[];comparisonNodeIds?:string[];rejectedFollowup?:{roomId:string;actionId:string};followup?:RoomFollowupScope;jobId:string;roomId:string;frameId:string;sourceHash:string;provenance:'agent-derived'|'authored-test';trigger:'manual'|'capture';status:'queued'|'running'|'staged'|'published'|'failed'|'interrupted'|'disabled';provider:string|null;createdAt:string;updatedAt:string;error:string|null;visitId:string|null};
export type RoomActionNeeded={actionId:string;jobId:string;roomId:string;nodeId:string;kind:'view'|'explanation';request:string;sourceHash:string;status:'open'|'resolved';createdAt:string;resolution?:{jobId:string;frameId:string;sourceHash:string;viewId:string;basis:string;capturedAt:string;resolvedAt:string}};
/** A visible appearance match alone never answers a previously requested detail. */
export function validateRoomActionAssessments(result:RoomObserverResult,pendingActions:RoomActionNeeded[],roomId:string,currentSourceHash:string){
 const seen=new Set<string>();
 for(const assessment of result.actionAssessments??[]){
  const action=pendingActions.find(a=>a.actionId===assessment.actionId);
  if(!action||action.roomId!==roomId||action.status!=='open'||action.nodeId!==assessment.nodeId||action.sourceHash!==assessment.sourceHash||seen.has(assessment.actionId))throw new Error('Unknown, duplicate or mismatched pending action assessment');
  seen.add(assessment.actionId);
  if(assessment.status==='addressed'){
   const observation=result.observations.find(o=>o.nodeId===action.nodeId);
   const uncertainDetail=result.protocolVersion===2&&observation?.status==='uncertain'&&observation.currentAppearance?.features.some(feature=>feature.visible)&&observation.comparison&&['none','historical-detail','history-conflict'].includes(observation.comparison.limitation);
   if(action.kind!=='view'||currentSourceHash===action.sourceHash||!observation||(!['likely-same','different'].includes(observation.status)&&!uncertainDetail)||observation.needs!=='none'||observation.semanticUnknown)throw new Error('Addressed view request requires a new source and a usable current observation; semantic explanations require a user answer');
  }
 }
}
export type RoomAutomationResponse={declaration:RoomAutomationDeclaration;provider:{name:string|null;enabled:boolean;reason:string|null};jobs:RoomAutomationJob[];actions:RoomActionNeeded[]};
