import {z} from 'zod';

const id=z.string().min(1).max(200);

/** Exact saved evidence, never an alias for an object or a personal claim. */
export const IdentityAnchorSchema=z.object({
 placeId:id,candidateId:id,observationRef:z.string().min(1).max(1000),
 regionRef:id,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type IdentityAnchor=z.infer<typeof IdentityAnchorSchema>;
export const IdentityCommandSchema=z.object({
 id,placeId:id,createdAt:z.string().datetime({offset:true}),
 actor:z.literal('user'),
 action:z.discriminatedUnion('type',[
  z.object({type:z.literal('decide'),decision:z.enum(['same','different','unsure']),a:IdentityAnchorSchema,b:IdentityAnchorSchema}).strict(),
  z.object({type:z.literal('undo'),decisionId:id}).strict(),
 ]),
}).strict();
export type IdentityCommand=z.infer<typeof IdentityCommandSchema>;
export type IdentityStatus='active'|'undone'|'stale';
export interface IdentityCommandResult {id:string;status:IdentityStatus;reason:string;command:IdentityCommand}
export interface IdentityDecision extends IdentityCommandResult {
 pairId:string;a:IdentityAnchor;b:IdentityAnchor;decision:'same'|'different'|'unsure';
}
export interface ScanIdentityProjection {decisions:IdentityDecision[];commands:IdentityCommandResult[]}

const anchorKey=(a:IdentityAnchor):string=>JSON.stringify([a.placeId,a.candidateId,a.observationRef,a.regionRef,a.sourceHash]);
/** Stable for either endpoint order. No candidate union or transitive closure. */
export function identityPairId(a:IdentityAnchor,b:IdentityAnchor):string {
 return JSON.stringify([anchorKey(a),anchorKey(b)].sort());
}
function normalized(command:IdentityCommand):string {
 const action=command.action;
 return JSON.stringify([command.id,command.placeId,command.createdAt,command.actor,
  action.type==='undo'?['undo',action.decisionId]:['decide',action.decision,identityPairId(action.a,action.b)]]);
}
function uniqueCommands(input:IdentityCommand[]):IdentityCommand[] {
 const seen=new Map<string,IdentityCommand>();
 for(const raw of input){
  const command=IdentityCommandSchema.parse(raw),old=seen.get(command.id);
  if(old&&normalized(old)!==normalized(command))throw new Error('Identity command ID collision');
  if(!old)seen.set(command.id,command);
 }
 return [...seen.values()];
}
function pairError(command:IdentityCommand,anchors:Set<string>):string|null {
 const action=command.action;if(action.type!=='decide')return null;
 if(action.a.placeId!==command.placeId&&action.b.placeId!==command.placeId)return 'Identity command place must be one of its endpoint places';
 if(action.a.placeId===action.b.placeId&&action.a.candidateId===action.b.candidateId)return 'Identity requires two distinct candidates';
 if(action.a.sourceHash===action.b.sourceHash)return 'Identity requires two different saved sources';
 if(!anchors.has(anchorKey(action.a))||!anchors.has(anchorKey(action.b)))return 'Identity evidence endpoint is absent or changed';
 return null;
}

/** Independent append-only overlay. Never mutates candidates, evidence, labels,
 * groups or tags. Disappearance of exact evidence makes a decision stale. */
export function projectScanIdentity(currentAnchors:IdentityAnchor[],input:IdentityCommand[]):ScanIdentityProjection {
 const commands=uniqueCommands(input),anchors=new Set(currentAnchors.map(anchorKey));
 const undone=new Set<string>(),validUndos=new Set<string>(),prior=new Map<string,IdentityCommand>();
 for(const command of commands){
  if(command.action.type==='undo'){
   const target=prior.get(command.action.decisionId);
   if(target&&target.action.type==='decide'&&[target.action.a.placeId,target.action.b.placeId].includes(command.placeId)&&!undone.has(target.id)){
    undone.add(target.id);validUndos.add(command.id);
   }
  }
  prior.set(command.id,command);
 }
 const result:ScanIdentityProjection={decisions:[],commands:[]};
 const activePairs=new Set<string>(),samePartners=new Set<string>();
 for(const command of commands){
  const action=command.action;
  const record:IdentityCommandResult={id:command.id,status:'active',reason:'Explicit user decision',command};
  result.commands.push(record);
  if(action.type==='undo'){
   record.reason=validUndos.has(command.id)?'Decision explicitly withdrawn':'Undo requires a prior non-withdrawn decision in this place';
   if(!validUndos.has(command.id))record.status='stale';
   continue;
  }
  const pairId=identityPairId(action.a,action.b);
  let reason=pairError(command,anchors);
  const candidates=[action.a,action.b].map(a=>JSON.stringify([a.placeId,a.candidateId]));
  if(undone.has(command.id)){
   record.status='undone';record.reason='Decision explicitly withdrawn';
  }else{
   if(!reason&&activePairs.has(pairId))reason='This pair already has an active decision; undo it before deciding again';
   if(!reason&&action.decision==='same'&&candidates.some(id=>samePartners.has(id)))reason='A candidate already has an active same partner; undo that decision first';
   if(reason){record.status='stale';record.reason=reason;}
   else{activePairs.add(pairId);if(action.decision==='same')candidates.forEach(id=>samePartners.add(id));}
  }
  result.decisions.push({...record,pairId,a:action.a,b:action.b,decision:action.decision});
 }
 return result;
}

/** Revision concurrency is checked by the store before append. Exact command
 * retries (including reversed pairs) remain idempotent after source withdrawal. */
export function validateIdentityCommand(raw:IdentityCommand,prior:IdentityCommand[],anchors:IdentityAnchor[]):void {
 const command=IdentityCommandSchema.parse(raw),commands=uniqueCommands(prior);
 const old=commands.find(c=>c.id===command.id);
 if(old){if(normalized(old)!==normalized(command))throw new Error('Identity command ID collision');return;}
 const next=projectScanIdentity(anchors,[...commands,command]);
 const added=next.commands.find(c=>c.id===command.id)!;
 if(added.status!=='active')throw new Error(added.reason);
}
