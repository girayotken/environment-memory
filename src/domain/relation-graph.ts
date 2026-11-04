import {searchPlaceMemory,type PlaceMemory,type ItemEvidence,type PlaceItem} from './place-memory.ts';
import type {RegionReview} from './relation-contracts.ts';
export const RELATIONS_METHOD='source-relations-v1';
export const NEAR_IMAGE_DIAGONAL=.15;
export const observationId=(e:Pick<ItemEvidence,'runId'|'index'>)=>`observation:${e.runId}:${e.index}`;
export interface RelationNode{id:string;kind:'place'|'candidate'|'observation'|'surface'|'frame'|'mask';label:string}
export interface RelationEdge{id:string;from:string;to:string;predicate:'observed_as'|'possible_identity'|'source_frame'|'observed_on'|'co_visible'|'near_in_image';frameId:string;observedAt:string;method:'existing-matcher'|'existing-observation'|'agent-reviewed'|'derived-image'|'saved-model-statement'|'sam-mask-distance';dependsOn:string[];normalizedGap?:number}
export interface RelationGraph{method:string;nodes:RelationNode[];edges:RelationEdge[];observations:Record<string,ItemEvidence>;reviews:Record<string,RegionReview>}
export interface NeighborEvidence{observationId:string;label:string;appearance:string;uncertainty:string;normalizedGap:number;bounds:RegionReview['bounds'];claimId:string}
export interface LastSeenAnswer{
  candidateId:string;label:string;appearance:string;status:PlaceItem['status'];text:string;warning:string;last:ItemEvidence;
  surface:{label:string;claimId:string;reviewId:string|null}|null;region:RegionReview['bounds']|null;neighbors:NeighborEvidence[];coVisible:string[];
  possibleLater:ItemEvidence[];supportingClaimIds:string[];
}
export interface RelationAnswerView{method:string;revision:number;question:string;terms:string;language:'tr'|'en';ambiguity:boolean;message:string;answers:LastSeenAnswer[];graph:RelationGraph;frameDimensions:Record<string,{width:number;height:number}>}
function regionGap(a:RegionReview['bounds'],b:RegionReview['bounds']){return Math.hypot(Math.max(a.left-b.right,b.left-a.right,0),Math.max(a.top-b.bottom,b.top-a.bottom,0));}
export function buildRelationGraph(memory:PlaceMemory,reviews:RegionReview[]):RelationGraph{
  const nodes=new Map<string,RelationNode>(),edges:RelationEdge[]=[],observations:Record<string,ItemEvidence>={},valid:Record<string,RegionReview>={};
  const add=(id:string,kind:RelationNode['kind'],label:string)=>nodes.set(id,{id,kind,label});
  add(memory.place.id,'place',memory.place.name);
  const observation=(e:ItemEvidence)=>{const id=observationId(e);if(observations[id])return id;observations[id]=e;add(id,'observation',e.label);add(`frame:${e.frameId}`,'frame',`Visit ${e.visit}`);edges.push({id:`source:${id}`,from:id,to:`frame:${e.frameId}`,predicate:'source_frame',frameId:e.frameId,observedAt:e.capturedAt,method:'existing-observation',dependsOn:[e.runId]});return id;};
  for(const item of memory.items){add(item.id,'candidate',item.label);for(const e of item.history){const id=observation(e);edges.push({id:`appearance:${item.id}:${id}`,from:item.id,to:id,predicate:'observed_as',frameId:e.frameId,observedAt:e.capturedAt,method:'existing-matcher',dependsOn:[memory.matcherRevision,e.runId]});}}
  for(const e of memory.unresolved){const id=observation(e);for(const candidate of e.candidateIds)edges.push({id:`possible:${id}:${candidate}`,from:id,to:candidate,predicate:'possible_identity',frameId:e.frameId,observedAt:e.capturedAt,method:'existing-matcher',dependsOn:[memory.matcherRevision,e.runId]});}
  for(const review of reviews){
    const id=observationId({runId:review.runId,index:review.index}),e=observations[id],visit=memory.visits.find(v=>v.frame.id===review.frameId&&v.projected);
    if(review.placeId!==memory.place.id||!e||!visit||e.frameId!==review.frameId||visit.frame.imageHash!==review.imageHash||review.bounds.right>visit.frame.width||review.bounds.bottom>visit.frame.height)continue;
    valid[id]=review;const surface=`surface:${review.placeId}:${review.surfaceKey}`;add(surface,'surface',review.surfaceLabel);
    edges.push({id:`on:${review.id}`,from:id,to:surface,predicate:'observed_on',frameId:e.frameId,observedAt:e.capturedAt,method:'agent-reviewed',dependsOn:[review.id,e.runId,`frame:${e.frameId}`]});
  }
  const values=Object.entries(observations);
  for(const [aid,a] of values)for(const [bid,b] of values){
    if(aid===bid||a.frameId!==b.frameId||a.runId!==b.runId)continue;
    edges.push({id:`visible:${aid}:${bid}`,from:aid,to:bid,predicate:'co_visible',frameId:a.frameId,observedAt:a.capturedAt,method:'existing-observation',dependsOn:[a.runId]});
    const ar=valid[aid],br=valid[bid];if(!ar||!br||ar.surfaceKey!==br.surfaceKey)continue;
    const frame=memory.visits.find(v=>v.frame.id===a.frameId)!.frame;
    const gap=regionGap(ar.bounds,br.bounds)/Math.hypot(frame.width,frame.height);
    if(gap>NEAR_IMAGE_DIAGONAL)continue;
    edges.push({id:`near:${ar.id}:${br.id}`,from:aid,to:bid,predicate:'near_in_image',frameId:a.frameId,observedAt:a.capturedAt,method:'derived-image',dependsOn:[ar.id,br.id,a.runId],normalizedGap:gap});
  }
  return {method:RELATIONS_METHOD,nodes:[...nodes.values()],edges,observations,reviews:valid};
}
const questionWords=new Set(['en','son','nerede','neredeydi','neresinde','yanında','yaninda','ne','neler','vardı','vardi','var','hangi','benim','lütfen','lutfen','where','was','were','last','seen','what','next','to','it','near','nearby','beside','and','the','my','is','please']);
const queryAliases:Record<string,string>={matkap:'drill',matkabım:'drill',matkabim:'drill',matkabı:'drill',sarı:'yellow',sari:'yellow',mavi:'blue',kırmızı:'red',kirmizi:'red',tornavida:'screwdriver'};
export function relationTerms(question:string){return (question.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]).filter(s=>!questionWords.has(s)).map(s=>queryAliases[s]??s).join(' ');}
function label(e:ItemEvidence){return `${e.label} (${e.appearance})`;}
export function answerRelations(memory:PlaceMemory,graph:RelationGraph,question:string,revision:number,candidateId?:string):RelationAnswerView{
  const language='en' as const,terms=relationTerms(question);
  if(!terms)throw new Error('Include an item name or color in this bounded question');
  const matched=searchPlaceMemory(memory,terms),ids=new Set(matched.items.map(i=>i.id));
  matched.unresolved.forEach(e=>e.candidateIds.forEach(id=>ids.add(id)));
  let candidates=memory.items.filter(i=>ids.has(i.id));
  if(candidateId){if(!ids.has(candidateId))throw new Error('Selected candidate does not match this question and place');candidates=candidates.filter(i=>i.id===candidateId);}
  const answers:LastSeenAnswer[]=candidates.map(item=>{
    const last=item.history.at(-1)!,id=observationId(last),review=graph.reviews[id];
    const on=graph.edges.find(e=>e.from===id&&e.predicate==='observed_on');
    const near=graph.edges.filter(e=>e.from===id&&e.predicate==='near_in_image').sort((a,b)=>a.normalizedGap!-b.normalizedGap!||a.to.localeCompare(b.to)).slice(0,2);
    const neighbors=near.map(edge=>{const e=graph.observations[edge.to];return {observationId:edge.to,label:label(e),appearance:e.appearance,uncertainty:e.uncertainty,normalizedGap:edge.normalizedGap!,bounds:graph.reviews[edge.to].bounds,claimId:edge.id};});
    const coVisible=graph.edges.filter(e=>e.from===id&&e.predicate==='co_visible').map(e=>label(graph.observations[e.to]));
    const possibleLater=memory.unresolved.filter(e=>e.visit>last.visit&&e.candidateIds.includes(item.id));
    const surface=on&&review?{label:review.surfaceLabel,claimId:on.id,reviewId:review.id}:null;
    const text=
      `This candidate's latest linked observation is visit ${last.visit}. ${surface?`An agent-reviewed relation places it on ${surface.label}.`:`Saved model location: “${last.location}”; no reviewed surface link.`} ${neighbors.length?`Nearby in that image: ${neighbors.map(n=>n.label).join(' and ')}.`:'No reviewed image-relative neighbor relation.'}`;
    const warning=
      `${possibleLater.length?'Later lookalikes remain unlinked. ':''}${item.status==='unchecked'?'The latest saved appearance has not been reviewed. ':''}Physical identity and present location are not confirmed; proximity is image-relative.`;
    return {candidateId:item.id,label:label(last),appearance:last.appearance,status:item.status,text,warning,last,surface,region:review?.bounds??null,neighbors,coVisible,possibleLater,supportingClaimIds:[`source:${id}`,...(on?[on.id]:[]),...near.map(e=>e.id)]};
  });
  const ambiguity=answers.length>1;
  const message=
    ambiguity?'Several candidates match; select one to inspect its evidence.':answers.length?'Answer from saved observations and relation evidence.':'No linked candidate matches; this does not establish absence.';
  return {method:RELATIONS_METHOD,revision,question,terms,language,ambiguity,message,answers,graph,frameDimensions:Object.fromEntries(memory.visits.filter(v=>v.projected).map(v=>[v.frame.id,{width:v.frame.width,height:v.frame.height}]))};
}
