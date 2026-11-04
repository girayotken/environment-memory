import {createHash} from 'node:crypto';
import type {RoomObserverInput} from '../domain/room-observer-contracts.ts';
import type {roomObserverRequest} from './room-observer-provider.ts';

type Request=ReturnType<typeof roomObserverRequest>;
/** A mapping belongs to this exact input, including its current source and scope. */
function aliases(input:RoomObserverInput){
 const nodes=input.room.graph.nodes.map(n=>n.id);
 const sources=[...new Set([input.frame.sourceHash,...input.references.map(r=>r.source.sourceHash),...(input.pendingActions??[]).map(a=>a.sourceHash),...input.room.graph.sourceViews.map(s=>s.sourceHash),...input.room.visits.flatMap(v=>v.sourceViews.map(s=>s.sourceHash))])];
 const salt=createHash('sha256').update(JSON.stringify([input.frame.sourceHash,nodes,sources,input.comparisonNodeIds??null])).digest('hex').slice(0,6);
 const map=new Map<string,string>();nodes.forEach((v,i)=>map.set(v,`n${salt}_${i}`));sources.forEach((v,i)=>map.set(v,`s${salt}_${i}`));
 return map;
}
function mapValues(value:unknown,map:Map<string,string>):unknown{
 if(typeof value==='string')return map.get(value)??value;
 if(Array.isArray(value))return value.map(v=>mapValues(v,map));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mapValues(v,map)]));
 return value;
}
/** Compact model boundary only. Legacy requests and receipts remain byte-identical. */
export function compactObserverRequest(request:Request,input:RoomObserverInput,containment=false,outside=false):Request{
 const copy=structuredClone(request),map=aliases(input);
 for(const part of copy.input[1].content)if(typeof part!=='string'&&part.type==='input_text'){
  try{part.text=JSON.stringify(mapValues(JSON.parse(part.text),map));}catch{/* prose marker */}
 }
 const instruction=copy.input[0].content as string;
 copy.input[0].content=instruction.replace('Protocol version 2 is required. Keep currentAppearance separate from comparison: currentAppearance describes only current pixels, without old labels, expected details or historical visibility. Its features name visible or not-visible details.','Protocol version 3 is required. appearanceDescription and feature descriptions describe only current pixels, without old labels, expected details or historical visibility. Each feature has one name, description, visible flag, and comparisons: an empty array when un-compared, otherwise one source-bound comparison evidence entry per historical comparison. Do not repeat feature names. Use supplied short node and source aliases exactly.').replace('All compared features must have a matching currentAppearance feature. ','').split('\n').filter(line=>!line.startsWith('Feature names are exact keys, not synonyms:')).join('\n');
 if(containment)copy.input[0].content += '\nReport containment only when the current pixels visibly show an item inside a container. Return containment entries with zero-based itemIndex and containerIndex into observations and a brief visual basis. Both objects must appear as observations. Do not infer hidden contents or removal. Return [] when none.';
 if(outside){copy.input[0].content += '\nFor active containment only, report outsideContainment when both the matched item and matched container are visibly present and current pixels explicitly show the item outside that container. Use observation indices and a specific visual basis. Never infer from absence or occlusion; do not claim movement. Return [] otherwise.'; const parts=copy.input[1].content; const part=Array.isArray(parts)?parts.find((p:any)=>typeof p!=='string'&&p.type==='input_text'):undefined; if(part&&typeof part!=='string'&&part.type==='input_text'){const packet=JSON.parse(part.text);packet.activeContainment=(input.room.containment?.active??[]).map(e=>({itemId:map.get(e.itemId),containerId:map.get(e.containerId)})).filter(e=>e.itemId&&e.containerId);part.text=JSON.stringify(packet);}}
 const schema=copy.text.format.schema as any;
 if(containment){schema.required.push('containment');schema.properties.containment={type:'array',maxItems:16,items:{type:'object',additionalProperties:false,required:['itemIndex','containerIndex','basis'],properties:{itemIndex:{type:'integer',minimum:0},containerIndex:{type:'integer',minimum:0},basis:{type:'string'}}}};}
 if(outside){schema.required.push('outsideContainment');schema.properties.outsideContainment=structuredClone(schema.properties.containment);}
 schema.properties.protocolVersion.enum=[3];
 const obs=schema.properties.observations.items;
 const appearance=obs.properties.currentAppearance;
 const comparison=obs.properties.comparison;
 const item=appearance.properties.features.items;
 const compared=comparison.properties.features.items;
 delete compared.properties.feature;compared.required=compared.required.filter((k:string)=>k!=='feature');
 item.required.push('comparisons');item.properties.comparisons={type:'array',maxItems:12,items:compared};
 obs.properties.appearanceDescription=appearance.properties.description;
 obs.properties.features=appearance.properties.features;
 delete obs.properties.currentAppearance;delete comparison.properties.features;
 comparison.required=comparison.required.filter((k:string)=>k!=='features');
 obs.required=obs.required.filter((k:string)=>k!=='currentAppearance');obs.required.push('appearanceDescription','features');
 return copy;
}
/** Wire v8: make attached candidate-bound historical descriptions easy to find. */
export function observerRequestV8(input:RoomObserverInput,request:Request):Request{
 const copy=compactObserverRequest(request,input,true,true),map=aliases(input);
 const part=copy.input[1].content[0];
 if(typeof part==='string'||part.type!=='input_text')throw new Error('Missing observer memory packet.');
 const packet=JSON.parse(part.text),nodes=packet.memory.nodes as Array<any>;
 for(const node of nodes){
  const id=[...map].find(([,alias])=>alias===node.id)?.[0];
  const allowed=new Set<string>(node.allowedComparisonSourceHashes??[]);
  const history=input.room.visits.flatMap(visit=>visit.proposals.filter(p=>p.nodeId===id&&p.currentAppearance&&p.status!=='different'&&p.status!=='not-observed').flatMap(p=>p.evidence.flatMap(e=>{
   const source=visit.sourceViews.find(s=>s.viewId===e.viewId),alias=source&&map.get(source.sourceHash);
   return source&&alias&&allowed.has(alias)&&Date.parse(source.capturedAt)<Date.parse(input.frame.capturedAt)?[{sourceHash:alias,capturedAt:source.capturedAt,status:p.status,description:p.currentAppearance!.description.length>120?p.currentAppearance!.description.slice(0,119)+'…':p.currentAppearance!.description}]:[];
  }))).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));
  const unique=history.filter((h,i)=>history.findIndex(x=>x.sourceHash===h.sourceHash)===i).slice(0,2);
  if(unique.length){node.attachedAppearanceHistory=unique;if(JSON.stringify(packet.memory).length>18000)delete node.attachedAppearanceHistory;}
 }
 part.text=JSON.stringify(packet);
 copy.input[0].content+='\nBefore assigning a new movable object, compare plausible existing candidates, including attachedAppearanceHistory and their attached images. A container may have changed location or open/closed state: compare stable visible exterior components, allowing hidden interiors. Keep similar distinct objects and unexplained stable differences as alternatives; shared colour or location alone is insufficient. Historical descriptions are fallible context, not current visibility or independent evidence. Absence is not removal.';
 return copy;
}
/** Keep all candidate and image bindings, with only the newest description per node. */
export function observerRequestV9(input:RoomObserverInput,request:Request):Request{
 const copy=observerRequestV8(input,request),part=copy.input[1].content[0];
 if(typeof part==='string'||part.type!=='input_text')throw new Error('Missing observer memory packet.');
 const packet=JSON.parse(part.text);
 for(const node of packet.memory.nodes)if(node.attachedAppearanceHistory)node.attachedAppearanceHistory=node.attachedAppearanceHistory.slice(0,1);
 part.text=JSON.stringify(packet);
 return copy;
}
/** V10 adds on-surface support independently of inside-container membership. */
export function observerRequestV10(input:RoomObserverInput,request:Request):Request{
 const copy=observerRequestV9(input,request),schema=copy.text.format.schema as any,part=copy.input[1].content[0];
 if(typeof part==='string'||part.type!=='input_text')throw new Error('Missing observer memory packet.');
 const packet=JSON.parse(part.text),map=aliases(input);
 packet.supportHistory=(input.room.supportEvidence??[]).filter(e=>!e.invalidated&&Date.parse(e.source.capturedAt)<Date.parse(input.frame.capturedAt)).slice(-16).map(e=>({itemId:map.get(e.itemId),supportId:map.get(e.supportId),sourceHash:map.get(e.source.sourceHash),capturedAt:e.source.capturedAt,basis:e.statement.slice(0,240)})).filter(e=>e.itemId&&e.supportId&&e.sourceHash);
 part.text=JSON.stringify(packet);
 copy.input[0].content+='\nAn object resting on a shelf, desk or other support is not inside a container. Encode it only in support with itemIndex, supportIndex and a specific visible contact basis. Both observations must be visible; supportIndex must refer to kind support. Keep actual inside-container relations in containment. Do not infer hidden contents or removal from support or absence. Return support: [] when none.';
 schema.required.push('support');schema.properties.support={type:'array',maxItems:16,items:{type:'object',additionalProperties:false,required:['itemIndex','supportIndex','basis'],properties:{itemIndex:{type:'integer',minimum:0},supportIndex:{type:'integer',minimum:0},basis:{type:'string'}}}};
 return copy;
}
function exactKeys(value:unknown,keys:string[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==keys.sort().join('|'))throw new Error('Invalid compact observer wire object.');
 return value as Record<string,any>;
}
export function decodeCompactObserverOutput(text:string,input:RoomObserverInput,containment=false,outside=false,support=false):string{
 const keys=outside?['protocolVersion','summary','observations','actionAssessments','containment','outsideContainment']:containment?['protocolVersion','summary','observations','actionAssessments','containment']:['protocolVersion','summary','observations','actionAssessments'];if(support)keys.push('support');const raw=exactKeys(JSON.parse(text),keys);if(raw?.protocolVersion!==3)throw new Error('Compact observer wire version required.');
 const reverse=new Map([...aliases(input)].map(([a,b])=>[b,a]));
 const node=(v:unknown)=>{if(v===null)return null;if(typeof v!=='string'||!reverse.has(v)||!v.startsWith('n'))throw new Error('Unknown compact node alias.');return reverse.get(v);};
 const source=(v:unknown)=>{if(typeof v!=='string'||!reverse.has(v)||!v.startsWith('s'))throw new Error('Unknown compact source alias.');return reverse.get(v);};
 if(!Array.isArray(raw.observations))throw new Error('Invalid compact observations.');
 for(const o of raw.observations){
  exactKeys(o,['nodeId','label','kind','attributes','status','basis','alternatives','location','semanticUnknown','needs','request','viewDeferral','appearanceDescription','features','comparison']);
  exactKeys(o.comparison,['priorSourceHashes','adequateDiscriminatingEvidence','limitation']);
  o.nodeId=node(o.nodeId);if(!Array.isArray(o.features))throw new Error('Invalid compact features.');
  const current:any[]=[],compared:any[]=[];
  for(const f of o.features){exactKeys(f,['feature','description','visible','comparisons']);current.push({feature:f.feature,description:f.description,visible:f.visible});
   if(!Array.isArray(f.comparisons))throw new Error('Invalid compact feature comparisons.');for(const item of f.comparisons){const c=exactKeys(item,['kind','identityRelevance','result','currentBasis','historicalBasis','priorSourceHash']);compared.push({feature:f.feature,...c,priorSourceHash:source(c.priorSourceHash)});}}
  o.currentAppearance={description:o.appearanceDescription,features:current};delete o.appearanceDescription;delete o.features;
  if(!o.comparison||!Array.isArray(o.comparison.priorSourceHashes))throw new Error('Invalid compact comparison.');
  o.comparison.priorSourceHashes=o.comparison.priorSourceHashes.map(source);o.comparison.features=compared;
 }
 if(Array.isArray(raw.actionAssessments))for(const a of raw.actionAssessments){exactKeys(a,['actionId','nodeId','sourceHash','status','basis']);a.nodeId=node(a.nodeId);a.sourceHash=source(a.sourceHash);}
 raw.protocolVersion=2;return JSON.stringify(raw);
}

/** Exact request-local aliases for new deterministic adapters; legacy bytes unchanged. */
export {aliases as roomObserverAliases};
