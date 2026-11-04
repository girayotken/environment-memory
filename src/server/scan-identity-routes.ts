import type {FastifyInstance} from 'fastify';
import {compareScanAppearance,SCAN_APPEARANCE_VERSION,type ScanAppearanceDescriptor,type ScanAppearanceMethod} from '../domain/scan-appearance.ts';
import {z} from 'zod';
import {IdentityCommandSchema,projectScanIdentity,identityPairId,type IdentityAnchor,type IdentityDecision,type IdentityCommand} from '../domain/scan-identity.ts';
import type {ScanReviewCard} from '../domain/scan-review-contracts.ts';
import type {ScanClaimObject} from '../domain/scan-claims.ts';
import {ScanIdentityStore,IdentityConflict} from './scan-identity-store.ts';
export interface IdentityEndpoint {anchor:IdentityAnchor;card:ScanReviewCard;placeLabel:string;label:string|null;tags:string[];userLabel?:string|null}
export interface IdentitySource extends IdentityEndpoint {claim:ScanClaimObject;provenance:string;feature:{method:string;values:number[]};appearance?:ScanAppearanceDescriptor|null}
export interface IdentityProposal {endpoint:IdentityEndpoint;score:number|null;uncalibrated:true;decision?:IdentityDecision}
export interface IdentityOverlay {
 placeId:string;candidateId:string;label:string|null;tags:string[];
 linked:{placeId:string;placeLabel:string;candidateId:string;label:string|null;tags:string[];decisionId:string;labelCommandId:string|null;tagCommandIds:Record<string,string[]>}[];conflicts:string[];
}
export interface IdentityRankingOptions {appearanceMethod?:ScanAppearanceMethod}
export interface IdentityResponse {rankingMethod:string;revision:number;workspaceRevision:number;selected:IdentityEndpoint|null;proposals:IdentityProposal[];history:IdentityDecision[];overlays:IdentityOverlay[];acceptedRevision?:number;acceptedCommandId?:string}
const key=(a:IdentityAnchor)=>JSON.stringify([a.placeId,a.candidateId]);
const endpoint=(s:IdentitySource):IdentityEndpoint=>({anchor:s.anchor,card:s.card,placeLabel:s.placeLabel,label:s.label,tags:s.tags,userLabel:s.claim.userLabel});
const comparable=(a:IdentitySource,b:IdentitySource)=>a.anchor.sourceHash!==b.anchor.sourceHash&&key(a.anchor)!==key(b.anchor)
 &&(a.provenance==='authored-scenario')===(b.provenance==='authored-scenario');
function similarity(a:IdentitySource,b:IdentitySource):number|null {
 if(a.feature.method!=='foreground-rgb-histogram-8-v0'||b.feature.method!==a.feature.method||a.feature.values.length!==24||b.feature.values.length!==24)return null;
 const av=a.feature.values,bv=b.feature.values,n=Math.hypot(...av)*Math.hypot(...bv);
 return n>0?Math.max(0,Math.min(1,av.reduce((sum,v,i)=>sum+v*bv[i],0)/n)):null;
}
export function identityResponse(sources:IdentitySource[],commands:IdentityCommand[],revision:number,workspaceRevision:number,placeId:string,candidateId?:string,otherPlaceId?:string,ranking:IdentityRankingOptions={}):IdentityResponse {
 const projection=projectScanIdentity(sources.map(s=>s.anchor),commands),selected=sources.find(s=>s.anchor.placeId===placeId&&s.anchor.candidateId===candidateId);
 const history=projection.decisions.filter(d=>[d.a,d.b].some(a=>a.placeId===placeId&&(!candidateId||a.candidateId===candidateId)));
 const overlays=sources.filter(s=>s.anchor.placeId===placeId).map(s=>{
  const linked=projection.decisions.filter(d=>d.status==='active'&&d.decision==='same'&&[d.a,d.b].some(a=>key(a)===key(s.anchor))).flatMap(d=>{
   const other=sources.find(source=>key(source.anchor)===key(key(d.a)===key(s.anchor)?d.b:d.a));
   return other?[{placeId:other.anchor.placeId,placeLabel:other.placeLabel,candidateId:other.anchor.candidateId,label:other.claim.userLabel,tags:other.claim.tags,decisionId:d.id,labelCommandId:other.claim.provenance.labelCommandId,tagCommandIds:other.claim.provenance.tagCommandIds}]:[];
  });
  const labels=[s.claim.userLabel,...linked.map(l=>l.label)].filter((v):v is string=>v!==null);
  return {placeId,candidateId:s.anchor.candidateId,label:s.claim.userLabel??linked.find(l=>l.label!==null)?.label??s.card.modelLabel,
   tags:[...new Set([...s.claim.tags,...linked.flatMap(l=>l.tags)])],linked,conflicts:new Set(labels).size>1?[...new Set(labels)]:[]};
 });
 const eligible=selected?sources.filter(s=>(!otherPlaceId||s.anchor.placeId===otherPlaceId)&&comparable(selected,s)):[];
 // A query has one scoring basis: missing/invalid descriptors fall the whole
 // gallery back to legacy rather than mixing incomparable numeric scales.
 const appearanceScores=selected&&ranking.appearanceMethod?eligible.map(s=>compareScanAppearance(selected.appearance??null,s.appearance??null,ranking.appearanceMethod)):null;
 const useAppearance=!!appearanceScores&&appearanceScores.length>0&&appearanceScores.every(score=>score!==null&&Number.isFinite(score));
 const rankingMethod=useAppearance?`${SCAN_APPEARANCE_VERSION}:${ranking.appearanceMethod}`:'foreground-rgb-histogram-8-v0';
 const proposals:IdentityProposal[]=selected?eligible.map((s,index)=>{
  const decision=projection.decisions.find(d=>d.status==='active'&&d.pairId===identityPairId(selected.anchor,s.anchor));
  return {endpoint:endpoint(s),score:useAppearance?appearanceScores![index]:similarity(selected,s),uncalibrated:true as const,...(decision?{decision}:{})};
 }).sort((a,b)=>(b.score??-1)-(a.score??-1)||key(a.endpoint.anchor).localeCompare(key(b.endpoint.anchor))):[];
 return {rankingMethod,revision,workspaceRevision,selected:selected?endpoint(selected):null,proposals,history,overlays};
}
/** No model access and no GET writes: ranking uses the saved verified descriptor only. */
export function registerIdentityRoutes(app:FastifyInstance,directory:string,current:()=>{sources:IdentitySource[];workspaceRevision:number;placeIds:string[]},ranking:IdentityRankingOptions={}){
 const store=new ScanIdentityStore(directory);app.addHook('onClose',async()=>store.close());
 const query=z.strictObject({placeId:z.string().min(1),candidateId:z.string().min(1).optional(),otherPlaceId:z.string().min(1).optional(),ranking:z.enum(['balanced','legacy']).optional()});
 app.get('/api/scan/identity',async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const parsed=query.safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:'Invalid identity selection'});
  const state=current(),q=parsed.data;
  if(!state.placeIds.includes(q.placeId)||(q.otherPlaceId&&!state.placeIds.includes(q.otherPlaceId)))return reply.code(404).send({error:'Unknown place'});
  const result=identityResponse(state.sources,store.commands(),store.revision(),state.workspaceRevision,q.placeId,q.candidateId,q.otherPlaceId,q.ranking==='balanced'?{appearanceMethod:'balanced'}:q.ranking==='legacy'?{}:ranking);
  if(q.candidateId&&!result.selected)return reply.code(409).send({error:'Selected evidence is absent or changed'});
  return result;
 });
 app.post('/api/scan/identity/commands',async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const origin=request.headers.origin,host=request.headers.host;
  if((origin&&origin!==`http://${host}`)||request.headers['sec-fetch-site']==='cross-site')return reply.code(403).send({error:'Same-origin identity commands required'});
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))return reply.code(415).send({error:'JSON required'});
  const parsed=z.strictObject({expectedRevision:z.number().int().nonnegative(),workspaceRevision:z.number().int().nonnegative(),command:IdentityCommandSchema}).safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:'Invalid identity command envelope'});
  const {command,expectedRevision,workspaceRevision}=parsed.data;
  try{
   // Retry lookup must happen before current evidence validation: a lost response
   // stays retryable even after its source has been withdrawn.
   let acceptedRevision=store.existing(command);
   const state=current();
   if(acceptedRevision===null){
    if(!state.placeIds.includes(command.placeId))return reply.code(404).send({error:'Unknown place'});
    if(command.action.type==='decide'){
     const action=command.action,a=state.sources.find(s=>Object.entries(action.a).every(([k,v])=>s.anchor[k as keyof IdentityAnchor]===v)),b=state.sources.find(s=>Object.entries(action.b).every(([k,v])=>s.anchor[k as keyof IdentityAnchor]===v));
     if(!a||!b)throw new IdentityConflict('Identity evidence endpoint is absent or changed');
     if(!comparable(a,b))throw new IdentityConflict('Identity requires different saved sources of compatible provenance');
    }
    acceptedRevision=store.append(command,expectedRevision,state.sources.map(s=>s.anchor),()=>{
     if(current().workspaceRevision!==workspaceRevision)throw new IdentityConflict('Stale workspace revision');
    });
   }
   const candidateId=command.action.type==='decide'?(command.action.a.placeId===command.placeId?command.action.a:command.action.b).candidateId:undefined;
   return {...identityResponse(state.sources,store.commands(),store.revision(),state.workspaceRevision,command.placeId,candidateId,undefined,ranking),acceptedRevision,acceptedCommandId:command.id};
  }catch(error){return reply.code(error instanceof IdentityConflict?409:400).send({error:error instanceof Error?error.message:'Invalid identity command'});}
 });
}
