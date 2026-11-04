import {buildRelationGraph,observationId} from './relation-graph.ts';
import type {PlaceMemory,ItemEvidence} from './place-memory.ts';
import type {SamMask,MaskAssociation} from './automatic-relations.ts';
export const MASK_NAMING_METHOD='same-image-color-class-v1';
export const MASK_NAMING_PARAMETERS=Object.freeze({saturation:.30,value:.18,minColorShare:.15,minColorLead:.10,leftVeto:.8,rightVeto:.2});
const colors=['red','orange','yellow','green','teal','blue','purple','pink'] as const;
export type MaskColor=typeof colors[number];
export interface MaskColorProfile {dominant:MaskColor|null;opaquePixels:number;shares:Record<MaskColor,number>}
export function foregroundColor(data:ArrayLike<number>):MaskColorProfile{
 const counts=Object.fromEntries(colors.map(c=>[c,0])) as Record<MaskColor,number>;let opaquePixels=0;
 for(let i=0;i<data.length;i+=4){
  if(!data[i+3])continue;opaquePixels++;
  const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  if(max<MASK_NAMING_PARAMETERS.value||!delta||delta/max<MASK_NAMING_PARAMETERS.saturation)continue;
  let hue=(max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4)*60;hue=(hue+360)%360;
  const color:MaskColor=hue<15||hue>=345?'red':hue<40?'orange':hue<75?'yellow':hue<165?'green':hue<195?'teal':hue<260?'blue':hue<315?'purple':'pink';counts[color]++;
 }
 const shares=Object.fromEntries(colors.map(c=>[c,opaquePixels?counts[c]/opaquePixels:0])) as Record<MaskColor,number>;
 const sorted=[...colors].sort((a,b)=>shares[b]-shares[a]||a.localeCompare(b));
 const dominant=shares[sorted[0]]>=MASK_NAMING_PARAMETERS.minColorShare&&shares[sorted[0]]-shares[sorted[1]]>=MASK_NAMING_PARAMETERS.minColorLead?sorted[0]:null;
 return {dominant,opaquePixels,shares};
}
export interface NamingCandidate {observationId:string;frameId:string;runId:string;index:number;label:string;appearance:string;location:string;uncertainty:string}
export interface MaskNamingDecision {
 id:string;segmentId:string;bundleId:string;media:'image'|'video';frameId:string|null;cutoutUrl:string;color:MaskColorProfile|null;
 status:'accepted'|'ambiguous'|'unsupported-source'|'insufficient-evidence'|'conflict';reason:string;candidates:NamingCandidate[];
 acceptedObservationId:string|null;dependsOn:string[];
}
export interface MaskNamingResult {method:string;parameters:typeof MASK_NAMING_PARAMETERS;decisions:MaskNamingDecision[];links:MaskAssociation[];counts:{masks:number;accepted:number;ambiguous:number;unsupportedSource:number;insufficientEvidence:number;conflicts:number;modelObservationsWithoutAcceptedMask:number}}
function captionColor(e:ItemEvidence):MaskColor|null{
 if(/colou?r/i.test(e.uncertainty)&&/uncertain|unknown|unclear|occluded/i.test(e.uncertainty))return null;
 const found=colors.filter(c=>new RegExp(`\\b${c}\\b`,'i').test(e.appearance));return found.length===1?found[0]:null;
}
function toolCompatible(concept:string,label:string){
 return /\b(?:drill|power tool|tool)\b/i.test(concept)&&!/\b(?:case|bag|box|bin|tray|shelf|table|bench|cabinet)\b/i.test(label)&&/\b(?:drill|driver|screwdriver|corded tool|power tool)\b/i.test(label);
}
function locationConflict(e:ItemEvidence,mask:SamMask){
 const left=/\bleft\b/i.test(e.location),right=/\bright\b/i.test(e.location);
 const centroid=mask.pixels.reduce((sum,p)=>sum+p%mask.bundle.width,0)/mask.pixels.length/mask.bundle.width;
 return left&&!right&&centroid>MASK_NAMING_PARAMETERS.leftVeto||right&&!left&&centroid<MASK_NAMING_PARAMETERS.rightVeto;
}
/** No reference/review links, track IDs, renderer truth or cross-visit descriptors enter prediction. */
export function nameSameImageMasks(memory:PlaceMemory,masks:SamMask[],profiles:Record<string,MaskColorProfile>):MaskNamingResult{
 const observations=Object.entries(buildRelationGraph(memory,[]).observations),decisions:MaskNamingDecision[]=[],links:MaskAssociation[]=[];
 const sourceVisit=(mask:SamMask)=>memory.visits.filter(v=>v.projected&&v.frame.imageHash===mask.bundle.sourceSha256&&v.frame.width===mask.bundle.width&&v.frame.height===mask.bundle.height);
 const sourceEligible=(m:SamMask)=>m.bundle.placeId===memory.place.id&&m.bundle.media==='image'&&m.bundle.pixelSource==='exact-saved-still'&&m.segment.sourceAsset===m.bundle.sourceSha256&&m.segment.frameIndex===0&&sourceVisit(m).length===1&&m.pixels.length===m.segment.foregroundPixels&&m.pixels.length>0&&m.segment.bounds.left>=0&&m.segment.bounds.top>=0&&m.segment.bounds.right<=m.bundle.width&&m.segment.bounds.bottom<=m.bundle.height&&m.segment.width===m.segment.bounds.right-m.segment.bounds.left&&m.segment.height===m.segment.bounds.bottom-m.segment.bounds.top&&new Set(m.pixels).size===m.pixels.length&&m.pixels.every(p=>Number.isInteger(p)&&p%m.bundle.width>=m.segment.bounds.left&&p%m.bundle.width<m.segment.bounds.right&&Math.floor(p/m.bundle.width)>=m.segment.bounds.top&&Math.floor(p/m.bundle.width)<m.segment.bounds.bottom)&&masks.filter(other=>other.segment.id===m.segment.id).length===1;
 for(const mask of [...masks].sort((a,b)=>a.segment.id.localeCompare(b.segment.id))){
  const {segment:s,bundle:b}=mask,visits=sourceVisit(mask),color=profiles[s.id]??null;
  const decision:MaskNamingDecision={id:`auto-mask-name:${MASK_NAMING_METHOD}:${s.id}`,segmentId:s.id,bundleId:b.id,media:b.media,frameId:visits.length===1?visits[0].frame.id:null,cutoutUrl:`/api/visual-assets/${s.cutoutAsset}`,color,status:'unsupported-source',reason:'No unique exact-source projected model still',candidates:[],acceptedObservationId:null,dependsOn:[b.recordsSha256,b.sourceSha256,s.cutoutAsset,MASK_NAMING_METHOD]};
  decisions.push(decision);if(!sourceEligible(mask))continue;
  if(!color?.dominant||color.opaquePixels!==s.foregroundPixels){decision.status='insufficient-evidence';decision.reason='No reliable foreground chromatic color';continue;}
  const eligible=observations.filter(([,e])=>e.frameId===decision.frameId&&captionColor(e)===color.dominant&&toolCompatible(b.concept,e.label));
  decision.candidates=eligible.map(([id,e])=>({observationId:id,frameId:e.frameId,runId:e.runId,index:e.index,label:e.label,appearance:e.appearance,location:e.location,uncertainty:e.uncertainty})).sort((a,b)=>a.observationId.localeCompare(b.observationId));
  const reciprocal=masks.filter(m=>sourceEligible(m)&&m.bundle.id===b.id&&profiles[m.segment.id]?.dominant===color.dominant);
  const occupied=new Set(mask.pixels),overlap=masks.some(m=>m!==mask&&sourceEligible(m)&&m.bundle.id===b.id&&m.pixels.some(p=>occupied.has(p)));
  if(eligible.length>1||reciprocal.length>1||overlap){decision.status='ambiguous';decision.reason='Multiple same-color tool observations or masks; position cannot break this tie';continue;}
  if(eligible.length!==1){decision.status='insufficient-evidence';decision.reason='No compatible uniquely colored tool observation';continue;}
  const [id,e]=eligible[0];
  if(locationConflict(e,mask)){decision.status='conflict';decision.reason='Coarse model location contradicts mask centroid';continue;}
  decision.status='accepted';decision.reason='Reciprocal unique foreground color and coarse tool class in the exact same source';decision.acceptedObservationId=id;decision.dependsOn.push(e.runId,`observation:${e.runId}:${e.index}`);
  links.push({id:decision.id,placeId:memory.place.id,bundleId:b.id,segmentId:s.id,frameId:e.frameId,runId:e.runId,index:e.index,association:'automatic-same-image',note:`${MASK_NAMING_METHOD}; unique ${color.dominant} coarse tool; source-bound only`});
 }
 const acceptedIds=new Set(links.map(l=>observationId(l)));
 return {method:MASK_NAMING_METHOD,parameters:MASK_NAMING_PARAMETERS,decisions,links,counts:{masks:decisions.length,accepted:links.length,ambiguous:decisions.filter(d=>d.status==='ambiguous').length,unsupportedSource:decisions.filter(d=>d.status==='unsupported-source').length,insufficientEvidence:decisions.filter(d=>d.status==='insufficient-evidence').length,conflicts:decisions.filter(d=>d.status==='conflict').length,modelObservationsWithoutAcceptedMask:observations.filter(([id])=>!acceptedIds.has(id)).length}};
}
