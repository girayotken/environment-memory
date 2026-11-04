import type {BeliefProjection} from './belief-memory.ts';
import {ScanCommandSchema,type ScanCommand} from './scan-contracts.ts';

export interface ScanClaimObject {
 candidateId:string;userLabel:string|null;tags:string[];groupIds:string[];
 provenance:{labelCommandId:string|null;tagCommandIds:Record<string,string[]>;groupCommandIds:Record<string,string[]>};
}
export interface ScanClaimGroup {id:string;name:string;memberIds:string[];commandIds:string[]}
export interface ScanCommandResult {
 commandId:string;status:'applied'|'undone'|'stale';reason:string;command:ScanCommand;
}
export interface ScanClaimsProjection {
 placeId:string|null;beliefRevision:string;objects:ScanClaimObject[];groups:ScanClaimGroup[];commands:ScanCommandResult[];
}

const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)
 ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);

function commandList(input:ScanCommand[]):ScanCommand[]{
 const seen=new Map<string,ScanCommand>();
 for(const raw of input){
  const command=ScanCommandSchema.parse(raw),old=seen.get(command.id);
  if(old&&canonical(old)!==canonical(command))throw new Error('Scan command ID collision');
  if(!old)seen.set(command.id,command);
 }
 return [...seen.values()];
}

/** Personal claims are an independent overlay. Candidate IDs never alias or
 * migrate when supporting evidence is retracted or identity hypotheses change. */
export function projectScanClaims(belief:BeliefProjection,input:ScanCommand[]):ScanClaimsProjection {
 const commands=commandList(input);
 const places=new Set([...belief.entities.flatMap(e=>e.history.map(h=>h.placeId)),...commands.map(c=>c.placeId)]);
 if(places.size>1)throw new Error('Scan claims require one place');
 const result:ScanClaimsProjection={placeId:[...places][0]??null,beliefRevision:belief.revision,
  objects:belief.entities.map(e=>({candidateId:e.id,userLabel:null,tags:[],groupIds:[],
   provenance:{labelCommandId:null,tagCommandIds:Object.create(null) as Record<string,string[]>,
    groupCommandIds:Object.create(null) as Record<string,string[]>}})),groups:[],commands:[]};
 const objects=new Map(result.objects.map(o=>[o.candidateId,o]));
 const groups=new Map<string,ScanClaimGroup>();
 const undone=new Set<string>();
 const validUndos=new Set<string>();
 // Undo addresses only an earlier non-undo command. It remains effective when
 // evidence later disappears, so replay cannot resurrect withdrawn claims.
 const prior=new Map<string,ScanCommand>();
 for(const command of commands){
  const action=command.action;
  if(action.type==='undo'){
   const target=prior.get(action.targetCommandId);
   if(target&&target.action.type!=='undo'&&!undone.has(target.id)){
    undone.add(target.id);validUndos.add(command.id);
   }
  }
  prior.set(command.id,command);
 }
 const usedGroupIds=new Set<string>();
 for(const command of commands){
  const action=command.action;
  const record:ScanCommandResult={commandId:command.id,status:'applied',reason:'Applied to explicit selected targets',command};
  result.commands.push(record);
  if(undone.has(command.id)){
   record.status='undone';record.reason='Explicitly withdrawn by an undo command';
   if(action.type==='create-group')usedGroupIds.add(action.groupId);
   continue;
  }
  if(action.type==='undo'){
   record.reason=validUndos.has(command.id)?'Prior command withdrawn':'Undo target is absent, already withdrawn, or an undo command';
   if(!validUndos.has(command.id))record.status='stale';
   continue;
  }
  const missing='candidateIds' in action?action.candidateIds.filter(id=>!objects.has(id)):[];
  let reason:string|null=missing.length?`Selected candidates absent from current belief: ${missing.join(', ')}`:null;
  if(action.type==='create-group'){
   if(usedGroupIds.has(action.groupId))reason='User group ID was already created';
   usedGroupIds.add(action.groupId);
  }else if('groupId' in action&&!groups.has(action.groupId))reason='Required user group is absent or its creation was withdrawn/stale';
  if(reason){record.status='stale';record.reason=reason;continue;}
  switch(action.type){
   case 'create-group': {
    const group:ScanClaimGroup={id:action.groupId,name:action.name,memberIds:[...action.candidateIds],commandIds:[command.id]};
    groups.set(group.id,group);break;
   }
   case 'rename-group': {
    const group=groups.get(action.groupId)!;group.name=action.name;group.commandIds.push(command.id);break;
   }
   case 'add-to-group':case 'remove-from-group': {
    const group=groups.get(action.groupId)!;
    group.memberIds=action.type==='add-to-group'?[...new Set([...group.memberIds,...action.candidateIds])]
     :group.memberIds.filter(id=>!action.candidateIds.includes(id));
    group.commandIds.push(command.id);break;
   }
   case 'set-label':
    for(const id of action.candidateIds){const object=objects.get(id)!;object.userLabel=action.label;object.provenance.labelCommandId=command.id;}break;
   case 'add-tag':case 'remove-tag':
    for(const id of action.candidateIds){
     const object=objects.get(id)!;
     if(action.type==='add-tag')object.tags=[...new Set([...object.tags,action.tag])];
     else object.tags=object.tags.filter(tag=>tag!==action.tag);
     const ids=object.provenance.tagCommandIds[action.tag]??[];
     object.provenance.tagCommandIds[action.tag]=[...ids,command.id];
    }break;
  }
 }
 result.groups=[...groups.values()];
 for(const group of result.groups)for(const id of group.memberIds){
  const object=objects.get(id)!;object.groupIds.push(group.id);
  object.provenance.groupCommandIds[group.id]=[...group.commandIds];
 }
 return result;
}

/** Validate before append; replay still retains accepted commands that become
 * stale after source withdrawal. Exact retries are idempotent. */
export function validateScanCommand(raw:ScanCommand,prior:ScanCommand[],belief:BeliefProjection):void {
 const command=ScanCommandSchema.parse(raw),commands=commandList(prior);
 const old=commands.find(c=>c.id===command.id);
 if(old){if(canonical(old)!==canonical(command))throw new Error('Scan command ID collision');return;}
 const projection=projectScanClaims(belief,commands);
 if(projection.placeId!==null&&projection.placeId!==command.placeId)throw new Error('Scan command place mismatch');
 const action=command.action;
 if(action.type==='undo'){
  const target=projection.commands.find(c=>c.commandId===action.targetCommandId);
  if(!target||target.command.action.type==='undo'||target.status==='undone')throw new Error('Undo requires a prior non-withdrawn non-undo command');
 }
 const next=projectScanClaims(belief,[...commands,command]);
 const added=next.commands.find(c=>c.commandId===command.id)!;
 if(added.status!=='applied')throw new Error(added.reason);
}
