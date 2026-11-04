import type { ObservationRun, Observations, SavedFrame } from './contracts.ts';
import { appearanceFeatures, compatibleAppearance } from './appearance-features.ts';
import { isGroupObservation, groupMayCoverIndividual } from './group-coverage.ts';
import { toolProfile,toolConflict } from './tool-terminology.ts';

export type PlaceMatcherRevision='natural-v2'|'natural-v3';

export interface Place { id:string; name:string; source:'live'|'authored_fixture'; createdAt:string }
export interface PlaceVisit { frame:Omit<SavedFrame,'run'>; run:ObservationRun|null }
export interface ItemEvidence {
  frameId:string; runId:string; index:number; visit:number; capturedAt:string;
  imageUrl:string; label:string; appearance:string; uncertainty:string; location:string;
}
export interface PlaceItem {
  id:string; label:string; history:ItemEvidence[];
  status:'observed'|'not_observed'|'unresolved'|'unchecked';
  events:{visit:number;status:'observed'|'not_observed'|'unresolved';reason:string}[];
}
export interface UnresolvedEvidence extends ItemEvidence { candidateIds:string[]; groupCoverage:boolean; reason:string }
export interface PlaceMemory {
  matcherRevision:PlaceMatcherRevision;
  place:Place; visits:{frame:Omit<SavedFrame,'run'>; checked:boolean; projected:boolean}[];
  items:PlaceItem[]; unresolved:UnresolvedEvidence[]; groups:ItemEvidence[]; checkedPrefix:number;
}
type Observation=Observations['objects'][number];
function natural(object:Observation,revision:PlaceMatcherRevision) {
  const label=object.label.replace(/\b(?:hand[- ]?held|digital|electrical|test|voltage)\s+meter\b/gi,'multimeter');
  const value=appearanceFeatures({...object,label}), text=`${label} ${object.appearance}`.toLowerCase().replace(/\b(blue|red|orange|yellow|green|teal|brown|black|white|gray|grey)\s+(band|tape|strap|stripe|sticker|marker)\b/g,'');
  const chromatic=[...new Set(text.match(/\b(blue|red|orange|yellow|green|teal|brown)\b/g)??[])];
  const neutral=[...new Set((text.match(/\b(black|white|gray|grey)\b/g)??[]).map(c=>c==='grey'?'gray':c))];
  const colourUncertain=/colou?r/i.test(object.uncertainty)&&/unclear|uncertain|unknown|occluded/i.test(object.uncertainty);
  // A neutral grip/casing accent must not replace the sole chromatic body signal.
  // Multiple chromatic colours remain unknown without component-level evidence.
  const colour=colourUncertain?null:chromatic.length===1?chromatic[0]:chromatic.length>1?null:value.bodyColour??(neutral.length===1?neutral[0]:null);
  const profile=revision==='natural-v3'?toolProfile(object):null;
  const labelKind=appearanceFeatures({label:object.label,appearance:''}).kind;
  const eligible=!labelKind||['drill','screwdriver','wrench'].includes(labelKind);
  return {...value,kind:eligible&&profile?(profile.uncertain?null:profile.kind??value.kind):value.kind,tool:eligible?profile:null,bodyColour:colour,band:{state:'unknown' as const,colour:null},grouped:isGroupObservation(object)};
}
function structure(object:Observation) {
  const text=object.appearance.toLowerCase();
  return ['battery','handle','latch','rib','chuck','grip','dial','display','lead'].filter(word=>new RegExp(`\\b${word}(?:s|bed)?\\b`).test(text));
}
function compatible(a:Observation,b:Observation,revision:PlaceMatcherRevision){
  const left=natural(a,revision),right=natural(b,revision);
  return compatibleAppearance(left,right)&&!(left.tool&&right.tool&&toolConflict(left.tool,right.tool));
}
function supports(a:Observation,b:Observation,revision:PlaceMatcherRevision) {
  const left=natural(a,revision),right=natural(b,revision);
  if(!left.kind||left.kind!==right.kind||left.tool?.uncertain||right.tool?.uncertain||!compatible(a,b,revision))return false;
  return Boolean(left.bodyColour&&left.bodyColour===right.bodyColour)||structure(a).filter(v=>structure(b).includes(v)).length>=2;
}
function asObservation(e:ItemEvidence):Observation {return {label:e.label,appearance:e.appearance,locationDescription:e.location,uncertainty:e.uncertainty,bbox:null};}
export function buildPlaceMemory(place:Place,visits:PlaceVisit[],revision:PlaceMatcherRevision='natural-v3'):PlaceMemory {
  const items:PlaceItem[]=[],unresolved:UnresolvedEvidence[]=[],groups:ItemEvidence[]=[];
  let checkedPrefix=0;
  for(const visit of visits){
    if(!visit.run)break;
    if(visit.run.frameId!==visit.frame.id || (place.source==='live'?visit.run.mode!=='live':visit.run.mode!=='replay'||visit.run.provenance!=='authored_fixture'))break;
    checkedPrefix++;
  }
  visits.slice(0,checkedPrefix).forEach(({frame,run},offset)=>{
    const visit=offset+1,objects=run!.observations.objects;
    const evidence=(object:Observation,index:number):ItemEvidence=>({frameId:frame.id,runId:run!.id,index,visit,capturedAt:frame.capturedAt,imageUrl:frame.imageUrl,label:object.label,appearance:object.appearance,uncertainty:object.uncertainty,location:object.locationDescription});
    const aggregate=objects.flatMap((o,i)=>isGroupObservation(o)?[i]:[]);
    aggregate.forEach(i=>groups.push(evidence(objects[i],i)));
    const individual=objects.flatMap((o,i)=>!isGroupObservation(o)?[i]:[]);
    const prior=[...items];
    const candidatesByIndex=new Map(individual.map(i=>[i,prior.filter(item=>compatible(asObservation(item.history.at(-1)!),objects[i],revision)
      &&(revision==='natural-v2'||item.history.every(h=>compatible(asObservation(h),objects[i],revision))))]));
    const strong=new Map(individual.map(i=>[i,candidatesByIndex.get(i)!.filter(item=>supports(asObservation(item.history.at(-1)!),objects[i],revision))]));
    const matched=new Set<string>();
    individual.forEach(i=>{
      const candidates=candidatesByIndex.get(i)!,positive=strong.get(i)!;
      const unique=positive.length===1&&individual.filter(other=>strong.get(other)!.some(v=>v.id===positive[0].id)).length===1;
      const safe=revision==='natural-v2'||candidates.length===1&&positive.length===1&&individual.filter(other=>candidatesByIndex.get(other)!.some(v=>v.id===positive[0].id)).length===1;
      const chosen=unique&&safe?positive[0]:null;
      const entry=evidence(objects[i],i);
      if(chosen){chosen.history.push(entry);chosen.label=entry.label;chosen.status='observed';chosen.events.push({visit,status:'observed',reason:'Unique supported natural-appearance candidate; physical identity is not proven.'});matched.add(chosen.id);return;}
      const earlierGroups=groups.filter(g=>g.visit<visit);
      const covered=earlierGroups.some(g=>groupMayCoverIndividual(asObservation(g),natural(asObservation(g),revision),natural(objects[i],revision)));
      if(candidates.length||covered){unresolved.push({...entry,candidateIds:candidates.map(v=>v.id),groupCoverage:covered,reason:covered?'Earlier group coverage may include this appearance.':'Competing or weakly described earlier candidates; inspect a distinguishing natural feature.'});return;}
      const item:PlaceItem={id:`entity:${place.id}:${run!.id}:${i}`,label:entry.label,history:[entry],status:'observed',events:[{visit,status:'observed',reason:'First individually described appearance; physical arrival is not established.'}]};
      items.push(item);matched.add(item.id);
    });
    prior.forEach(item=>{
      if(matched.has(item.id))return;
      const possible=unresolved.some(u=>u.visit===visit&&u.candidateIds.includes(item.id));
      const covered=aggregate.some(i=>groupMayCoverIndividual(objects[i],natural(objects[i],revision),natural(asObservation(item.history.at(-1)!),revision)));
      item.status=possible||covered?'unresolved':'not_observed';
      item.events.push({visit,status:item.status,reason:possible||covered?'Current lookalikes or group coverage remain unresolved.':'Not described in this checked view; last-observed evidence retained, not confirmed missing.'});
    });
  });
  if(checkedPrefix<visits.length)items.forEach(item=>item.status='unchecked');
  return {matcherRevision:revision,place,visits:visits.map((v,i)=>({frame:v.frame,checked:Boolean(v.run),projected:i<checkedPrefix})),items,unresolved,groups,checkedPrefix};
}
const stop=new Set(['where','is','are','the','my','a','an','find','show','me','can','you','please','nerede','neredeydi']);
const aliases:Record<string,string>={matkap:'drill',çanta:'case',toolbox:'case',toolcase:'case',multimetre:'multimeter'};
export function searchPlaceMemory(memory:PlaceMemory,query:string) {
  const terms=query.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(t=>!stop.has(t)).map(t=>aliases[t]??t)??[];
  const matches=(text:string)=>{const value=text.toLowerCase().replace(/tool\s*box|tool\s*case/g,'case');return terms.every(t=>value.includes(t));};
  return {items:memory.items.filter(item=>matches(item.history.map(e=>`${e.label} ${e.appearance}`).join(' '))),
    unresolved:memory.unresolved.filter(e=>matches(`${e.label} ${e.appearance}`)||e.candidateIds.some(id=>memory.items.some(item=>item.id===id&&matches(item.history.map(h=>`${h.label} ${h.appearance}`).join(' ')))))};
}
