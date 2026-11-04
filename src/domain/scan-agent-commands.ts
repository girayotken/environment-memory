import type {BeliefProjection} from './belief-memory.ts';
import type {ScanClaimsProjection} from './scan-claims.ts';
import {validateScanCommand} from './scan-claims.ts';
import {ScanCommandSchema,type ScanCommand,type ScanSession} from './scan-contracts.ts';
import {ScanAgentRequestSchema,ScanAgentProposalSchema,type ScanAgentRequest,type ScanAgentProposal} from './scan-agent-contracts.ts';

export interface ScanAgentView {revision:number;sessions:ScanSession[];belief:BeliefProjection;claims:ScanClaimsProjection}

/** Model proposes verbs and values. Code owns all target, actor and ledger IDs. */
export function compileScanAgentCommands(rawRequest:ScanAgentRequest,rawProposal:ScanAgentProposal,view:ScanAgentView,createdAt:string):ScanCommand[]{
 const request=ScanAgentRequestSchema.parse(rawRequest),proposal=ScanAgentProposalSchema.parse(rawProposal);
 if(request.expectedRevision!==view.revision)throw new Error('Stale scan revision');
 if(!view.sessions.length||view.sessions.some(s=>s.placeId!==request.placeId))throw new Error('Selected place does not match scan view');
 for(const id of request.selectedCandidateIds){
  const entity=view.belief.entities.find(e=>e.id===id);
  if(!entity||entity.history.length===0||entity.history.some(h=>h.placeId!==request.placeId)||!view.claims.objects.some(o=>o.candidateId===id))
   throw new Error('Selected candidate is absent or belongs to another place');
 }
 if(request.selectedGroupId!==null&&!view.claims.groups.some(g=>g.id===request.selectedGroupId))throw new Error('Selected group is absent');
 if(proposal.kind!=='commands'||proposal.scope!=='selected')throw new Error('Proposal requires clarification');
 const commands:ScanCommand[]=[],prior=view.claims.commands.map(c=>c.command);
 for(const [index,op] of proposal.operations.entries()){
  if(op.groupId!==null&&(op.groupId!==request.selectedGroupId||!view.claims.groups.some(g=>g.id===op.groupId)))
   throw new Error('Operation must use explicitly selected existing group');
  const candidateIds=[...request.selectedCandidateIds];
  let action:ScanCommand['action'];
  switch(op.type){
   case 'set-label':action={type:op.type,candidateIds,label:op.value!};break;
   case 'add-tag':case 'remove-tag':action={type:op.type,candidateIds,tag:op.value!};break;
   case 'create-group':action={type:op.type,groupId:`agent-group:${request.id}:${index}`,name:op.value!,candidateIds};break;
   case 'rename-group':action={type:op.type,groupId:op.groupId!,name:op.value!};break;
   case 'add-to-group':case 'remove-from-group':action={type:op.type,groupId:op.groupId!,candidateIds};break;
  }
  const command=ScanCommandSchema.parse({id:`agent:${request.id}:${index}`,placeId:request.placeId,createdAt,
   actor:{id:'local-review-user',kind:'user'},utterance:request.message,action});
  validateScanCommand(command,[...prior,...commands],view.belief);commands.push(command);
 }
 return commands;
}
