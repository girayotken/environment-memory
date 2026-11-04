import type {PlaceMemory,ItemEvidence} from './place-memory.ts';
import {answerRelations,buildRelationGraph,NEAR_IMAGE_DIAGONAL,observationId,type RelationAnswerView} from './relation-graph.ts';
import type {VisualBundle,VisualSegment,VisualLink} from './visual-evidence.ts';
export const AUTOMATIC_RELATION_METHOD='cached-auto-relations-v1';
export interface SamMask {bundle:VisualBundle;segment:VisualSegment;pixels:number[];boundary:[number,number][]}
export type MaskAssociation=Omit<VisualLink,'association'>&{association:'reviewed-same-image'|'automatic-same-image'};
export interface SurfaceCandidate {id:string;from:string;to:string;predicate:'observed_on';frameId:string;runId:string;surfaceKey:string;label:string;quote:string;uncertainty:string;method:'saved-model-statement';status:'candidate';dependsOn:string[]}
export interface MaskNeighbor {id:string;from:string;to:string;predicate:'near_in_image';bundleId:string;frameIndex:number;sourceAsset:string;distancePx:number;normalizedGap:number;method:'sam-mask-distance';dependsOn:string[]}
export interface NamedNeighbor {id:string;from:string;to:string;frameId:string;normalizedGap:number;dependsOn:string[]}
export interface AutomaticExtraction {
 method:string;surfaces:SurfaceCandidate[];maskNeighbors:MaskNeighbor[];namedNeighbors:NamedNeighbor[];
 regions:Record<string,{bounds:VisualSegment['bounds'];segmentId:string;linkId:string}>;
 diagnostics:{source:string;reason:string}[];counts:{individualObservations:number;surfaceCandidates:number;validMasks:number;namedMasks:number;maskPairs:number;namedPairs:number};
}
export interface AutomaticAnswerView extends RelationAnswerView {automatic:AutomaticExtraction}

/** Bounded parser over location only. No appearance, image review or renderer state. */
export function surfacePhrase(location:string):{key:string;label:string}|null{
 const text=location.toLowerCase();
 if(/\b(?:not|no|under|underneath|below|near|beside|between|maybe|possibly|probably|uncertain|unknown|unclear|or)\b/.test(text))return null;
 const found:{key:string;label:string}[]=[];
 if(/\b(?:bench\s*top|workbench\s*top|on (?:the )?(?:workbench|bench))\b/.test(text))found.push({key:'bench-top',label:'Workbench top'});
 if(/\b(?:table\s*top|on (?:the )?table)\b/.test(text))found.push({key:'table-top',label:'Table top'});
 if(/\b(?:middle|center) shelf\b/.test(text))found.push({key:'middle-shelf',label:'Middle shelf'});
 if(/\b(?:top|upper) shelf\b/.test(text))found.push({key:'top-shelf',label:'Upper shelf'});
 if(/\b(?:bottom|lower) shelf\b/.test(text))found.push({key:'bottom-shelf',label:'Lower shelf'});
 return found.length===1?found[0]:null;
}
function bboxGap(a:VisualSegment['bounds'],b:VisualSegment['bounds']){return Math.hypot(Math.max(a.left-b.right,b.left-a.right,0),Math.max(a.top-b.bottom,b.top-a.bottom,0));}
function validMask(mask:SamMask){
 const {bundle:b,segment:s}=mask;
 return s.bounds.left>=0&&s.bounds.top>=0&&s.bounds.right<=b.width&&s.bounds.bottom<=b.height&&s.width===s.bounds.right-s.bounds.left&&s.height===s.bounds.bottom-s.bounds.top&&mask.pixels.length===s.foregroundPixels&&mask.boundary.length>0&&mask.boundary.length<=4096;
}
export function extractAutomaticRelations(memory:PlaceMemory,masks:SamMask[],links:MaskAssociation[]):AutomaticExtraction{
 const graph=buildRelationGraph(memory,[]),diagnostics:AutomaticExtraction['diagnostics']=[],surfaces:SurfaceCandidate[]=[],maskNeighbors:MaskNeighbor[]=[],namedNeighbors:NamedNeighbor[]=[],regions:AutomaticExtraction['regions']={};
 const observations=Object.entries(graph.observations);
 for(const [id,e] of observations){
  const surface=surfacePhrase(e.location);
  if(!surface){diagnostics.push({source:id,reason:'No single unhedged supported surface phrase'});continue;}
  // A phrase is a local referent, not an association between same-named benches across views.
  surfaces.push({id:`auto-on:${id}`,from:id,to:`auto-surface:${e.frameId}:${surface.key}`,predicate:'observed_on',frameId:e.frameId,runId:e.runId,surfaceKey:surface.key,label:surface.label,quote:e.location,uncertainty:e.uncertainty,method:'saved-model-statement',status:'candidate',dependsOn:[e.runId,`frame:${e.frameId}`]});
 }
 const usable=masks.filter(m=>{
  if(m.bundle.placeId!==memory.place.id||!validMask(m))return false;
  if(m.bundle.media==='video')return memory.place.source==='live'&&memory.visits.length===3&&memory.checkedPrefix===3;
  return memory.visits.some(v=>v.projected&&v.frame.imageHash===m.bundle.sourceSha256&&m.segment.sourceAsset===v.frame.imageHash&&m.segment.frameIndex===0&&m.bundle.width===v.frame.width&&m.bundle.height===v.frame.height);
 });
 for(let i=0;i<usable.length;i++)for(let j=i+1;j<usable.length;j++){
  const a=usable[i],b=usable[j],as=a.segment,bs=b.segment;
  if(a.bundle.id!==b.bundle.id||as.id===bs.id||as.frameIndex!==bs.frameIndex||as.sourceAsset!==bs.sourceAsset)continue;
  const diagonal=Math.hypot(a.bundle.width,a.bundle.height);
  if(bboxGap(as.bounds,bs.bounds)/diagonal>NEAR_IMAGE_DIAGONAL)continue;
  const occupied=new Set(a.pixels);
  if(b.pixels.some(p=>occupied.has(p))){diagnostics.push({source:`${as.id}:${bs.id}`,reason:'Overlapping masks: no neighbor claim'});continue;}
  let distance=Infinity;
  for(const [ax,ay] of a.boundary)for(const [bx,by] of b.boundary)distance=Math.min(distance,Math.hypot(ax-bx,ay-by));
  if(distance/diagonal>NEAR_IMAGE_DIAGONAL)continue;
  const ordered=[as.id,bs.id].sort();
  maskNeighbors.push({id:`auto-mask-near:${ordered.join(':')}`,from:ordered[0],to:ordered[1],predicate:'near_in_image',bundleId:a.bundle.id,frameIndex:as.frameIndex,sourceAsset:as.sourceAsset,distancePx:distance,normalizedGap:distance/diagonal,method:'sam-mask-distance',dependsOn:[a.bundle.recordsSha256,as.cutoutAsset,bs.cutoutAsset,as.sourceAsset].sort()});
 }
 const candidates=links.filter(link=>{
  const m=usable.find(m=>m.segment.id===link.segmentId&&m.bundle.id===link.bundleId&&m.bundle.media==='image'),e=graph.observations[observationId({runId:link.runId,index:link.index})];
  return link.placeId===memory.place.id&&['reviewed-same-image','automatic-same-image'].includes(link.association)&&m&&e&&e.frameId===link.frameId&&m.bundle.sourceSha256===memory.visits.find(v=>v.frame.id===e.frameId)?.frame.imageHash;
 });
 for(const link of candidates){
  const id=observationId({runId:link.runId,index:link.index});
  if(candidates.filter(l=>l.segmentId===link.segmentId).length!==1||candidates.filter(l=>l.runId===link.runId&&l.index===link.index).length!==1){diagnostics.push({source:link.id,reason:'Non-unique same-image mask association'});continue;}
  regions[id]={bounds:usable.find(m=>m.segment.id===link.segmentId)!.segment.bounds,segmentId:link.segmentId,linkId:link.id};
 }
 maskNeighbors.sort((a,b)=>a.id.localeCompare(b.id));
 for(const pair of maskNeighbors){
  const a=Object.entries(regions).find(([,r])=>r.segmentId===pair.from),b=Object.entries(regions).find(([,r])=>r.segmentId===pair.to);
  if(!a||!b)continue;
  const ae=graph.observations[a[0]],be=graph.observations[b[0]];
  if(ae.frameId!==be.frameId||ae.runId!==be.runId)continue;
  const sa=surfaces.find(s=>s.from===a[0]),sb=surfaces.find(s=>s.from===b[0]);
  if(sa&&sb&&sa.surfaceKey!==sb.surfaceKey){diagnostics.push({source:pair.id,reason:'Model surface descriptions disagree; named proximity withheld'});continue;}
  namedNeighbors.push({id:`auto-named:${pair.id}`,from:a[0],to:b[0],frameId:ae.frameId,normalizedGap:pair.normalizedGap,dependsOn:[pair.id,a[1].linkId,b[1].linkId,ae.runId]});
 }
 return {method:AUTOMATIC_RELATION_METHOD,surfaces,maskNeighbors,namedNeighbors,regions,diagnostics,counts:{individualObservations:observations.length,surfaceCandidates:surfaces.length,validMasks:usable.length,namedMasks:Object.keys(regions).length,maskPairs:maskNeighbors.length,namedPairs:namedNeighbors.length}};
}
export function answerAutomaticRelations(memory:PlaceMemory,automatic:AutomaticExtraction,question:string,candidateId?:string):AutomaticAnswerView{
 const graph=buildRelationGraph(memory,[]),base=answerRelations(memory,graph,question,0,candidateId);
 for(const s of automatic.surfaces){graph.nodes.push({id:s.to,kind:'surface',label:s.label});graph.edges.push({id:s.id,from:s.from,to:s.to,predicate:'observed_on',frameId:s.frameId,observedAt:graph.observations[s.from].capturedAt,method:s.method,dependsOn:s.dependsOn});}
 graph.nodes=[...new Map(graph.nodes.map(n=>[n.id,n])).values()];graph.method=AUTOMATIC_RELATION_METHOD;
 for(const n of automatic.namedNeighbors)for(const [from,to] of [[n.from,n.to],[n.to,n.from]])graph.edges.push({id:`${n.id}:${from}`,from,to,predicate:'near_in_image',frameId:n.frameId,observedAt:graph.observations[from].capturedAt,method:'sam-mask-distance',dependsOn:n.dependsOn,normalizedGap:n.normalizedGap});
 const answers=base.answers.map(answer=>{
  const id=observationId(answer.last),surface=automatic.surfaces.find(s=>s.from===id);
  const edges=graph.edges.filter(e=>e.from===id&&e.predicate==='near_in_image').sort((a,b)=>a.normalizedGap!-b.normalizedGap!||a.to.localeCompare(b.to)).slice(0,2);
  const neighbors=edges.map(e=>{const o=graph.observations[e.to];return {observationId:e.to,label:automaticLabel(o),appearance:o.appearance,uncertainty:o.uncertainty,normalizedGap:e.normalizedGap!,bounds:automatic.regions[e.to].bounds,claimId:e.id};});
  const text=
   `Latest linked observation: visit ${answer.last.visit}. ${surface?`Surface candidate from saved model text: ${surface.label}; “${surface.quote}”.`:`No surface extracted; saved location: “${answer.last.location}”.`} ${neighbors.length?`SAM image-neighbor candidates: ${neighbors.map(n=>n.label).join(' and ')}.`:'No named SAM neighbor could be derived; this does not establish absence.'}`;
  return {...answer,text,surface:surface?{label:surface.label,claimId:surface.id,reviewId:null}:null,region:automatic.regions[id]?.bounds??null,neighbors,supportingClaimIds:[`source:${id}`,...(surface?[surface.id]:[]),...edges.map(e=>e.id)]};
 });
 return {...base,method:AUTOMATIC_RELATION_METHOD,graph,answers,automatic};
}
function automaticLabel(e:ItemEvidence){return `${e.label} (${e.appearance})`;}
