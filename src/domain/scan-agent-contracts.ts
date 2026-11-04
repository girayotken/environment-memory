import {z} from 'zod';

const id=z.string().min(1).max(200).refine(v=>v.trim().length>0,'ID must not be blank');
const value=z.string().min(1).max(200).refine(v=>v.trim().length>0,'Value must not be blank');
export const ScanAgentRequestSchema=z.strictObject({
 id:z.uuid(),placeId:id,expectedRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
 selectedCandidateIds:z.array(id).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,'Selection must be unique'),
 message:z.string().min(1).max(1000).refine(v=>v.trim().length>0,'Message must not be blank'),
 selectedGroupId:id.nullable(),replyTo:id.nullable(),
});
export const ScanAgentOperationSchema=z.strictObject({
 type:z.enum(['set-label','add-tag','remove-tag','create-group','rename-group','add-to-group','remove-from-group']),
 value:value.nullable(),groupId:id.nullable(),
}).superRefine((op,ctx)=>{
 const needsValue=!['add-to-group','remove-from-group'].includes(op.type);
 const needsGroup=['rename-group','add-to-group','remove-from-group'].includes(op.type);
 if(needsValue?(op.value===null):(op.value!==null))ctx.addIssue({code:'custom',path:['value'],message:needsValue?'Value required':'Unused value must be null'});
 if(needsGroup?(op.groupId===null):(op.groupId!==null))ctx.addIssue({code:'custom',path:['groupId'],message:needsGroup?'Group required':'Unused groupId must be null'});
});
export const ScanAgentProposalSchema=z.strictObject({
 kind:z.enum(['commands','clarify']),scope:z.enum(['selected','unresolved']),
 message:z.string().min(1).max(500).refine(v=>v.trim().length>0,'Reply must not be blank'),
 operations:z.array(ScanAgentOperationSchema).max(4),
}).superRefine((proposal,ctx)=>{
 if(proposal.kind==='clarify'&&proposal.operations.length!==0)ctx.addIssue({code:'custom',path:['operations'],message:'Clarification cannot contain operations'});
 if(proposal.kind==='commands'&&(proposal.scope!=='selected'||proposal.operations.length===0))ctx.addIssue({code:'custom',path:['operations'],message:'Commands require selected scope and operations'});
});
export type ScanAgentRequest=z.infer<typeof ScanAgentRequestSchema>;
export type ScanAgentProposal=z.infer<typeof ScanAgentProposalSchema>;
export interface AgentTurn {
 id:string;placeId:string;selectedCandidateIds:string[];selectedGroupId:string|null;message:string;createdAt:string;
 status:'processing'|'applied'|'clarify'|'error'|'stale';reply:string;commandIds:string[];
 model?:string;usage?:{requests:number;inputTokens:number;outputTokens:number;estimatedUsd:number};
}
export interface AgentStatus {
 enabled:boolean;reason:string|null;model:string;turns:AgentTurn[];
 budget:{requests:number;requestLimit:number;capUsd:number;reservedUsd:number;estimatedUsd:number};
}
