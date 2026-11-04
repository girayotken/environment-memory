import {createHash} from 'node:crypto';
import {BELIEF_MODEL as M,BeliefEventSchema,type BeliefEvent,type BeliefEpisode,type BeliefObservation} from './belief-contracts.ts';

type Choice={target:string;weight:number};
export interface BeliefEvidence {
 eventId:string;observationId:string;regionRef:string;sourceHash:string;cropHash:string;
 observedAt:string;timeBasis:BeliefEpisode['timeBasis'];placeId:string;label:string|null;location:string|null;
}
export interface BeliefEntity {
 id:string;anchorObservation:string;scope:BeliefObservation['scope'];prototype:BeliefObservation['feature'];
 history:BeliefEvidence[];labels:{label:string;observationIds:string[]}[];
 status:'observed'|'not_observed'|'unresolved';currentWhereabouts:'last-seen-only';
}
export interface BeliefDecision {
 eventId:string;observationId:string;status:'linked'|'new-candidate'|'clutter'|'unresolved'|'deferred';
 entityId:string|null;alternatives:Choice[];reason:string;
 candidateIds?:string[];
}
export interface BeliefProjection {
 model:typeof M;revision:string;provenance:string|null;entities:BeliefEntity[];
 decisions:BeliefDecision[];jointComponents:{eventId:string;observationIds:string[];assignments:number;deferred:boolean}[];
 ignoredEvents:{eventId:string;reason:string}[];activeObservationEvents:string[];
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const distance=(a:BeliefObservation['feature'],b:BeliefObservation['feature'])=>
 a.method===b.method&&a.values.length===b.values.length?Math.hypot(...a.values.map((v,i)=>v-b.values[i])):Infinity;
const ref=(eventId:string,observationId:string)=>`${encodeURIComponent(eventId)}/${encodeURIComponent(observationId)}`;
const entityKey=(key:string)=>`candidate:${digest(key)}`;
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)
 ?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);

/** Pure, deterministic replay. Original evidence is never mutated. Retractions
 * rebuild dependent state, including births, associations, labels and answers. */
export function replayBeliefs(input:unknown[]):BeliefProjection {
 const events:BeliefEvent[]=[],byId=new Map<string,BeliefEvent>(),observationOwners=new Map<string,string>();
 for(const raw of input){
  const event=BeliefEventSchema.parse(raw),old=byId.get(event.id);
  if(old){if(canonical(old)!==canonical(event))throw new Error('Event ID collision');continue;}
  if(event.kind==='observe'){
   if(new Set(event.observations.map(o=>o.id)).size!==event.observations.length)throw new Error('Duplicate observation ID');
   for(const o of event.observations)observationOwners.set(ref(event.id,o.id),event.id);
  }else if(event.kind==='retract'){
   if(!byId.has(event.targetId)||byId.get(event.targetId)!.kind==='retract')throw new Error('Retraction must target prior evidence or label revision');
  }else if(!observationOwners.has(event.targetObservation))throw new Error('Label revision requires prior observation');
  byId.set(event.id,event);events.push(event);
 }
 const kinds=new Set(events.filter(e=>e.kind==='observe').map(e=>e.provenance));
 if(kinds.size>1)throw new Error('Cached model and authored scenarios require separate replays');
 const removed=new Set(events.filter(e=>e.kind==='retract').map(e=>e.targetId));
 // Source/group aliases form one dependence component, even when an alias
 // arrives after both groups. Revocation cannot be bypassed by replaying a
 // second interpretation of the same evidence under a different event ID.
 const parents=new Map<string,string>();
 function root(key:string):string{const p=parents.get(key);if(!p){parents.set(key,key);return key;}if(p===key)return key;const r=root(p);parents.set(key,r);return r;}
 for(const event of events)if(event.kind==='observe'){
  const a=root(`hash:${event.sourceHash}`),b=root(`group:${event.groupId}`);if(a!==b)parents.set(b,a);
 }
 const revokedGroups=new Set(events.filter((e):e is BeliefEpisode=>e.kind==='observe'&&removed.has(e.id)).map(e=>root(`hash:${e.sourceHash}`)));
 const labels=new Map<string,string>();
 for(const event of events)if(event.kind==='revise-label'&&!removed.has(event.id)&&!removed.has(observationOwners.get(event.targetObservation)!))labels.set(event.targetObservation,event.label);
 const graph:BeliefProjection={model:M,revision:digest(events),provenance:[...kinds][0]??null,entities:[],decisions:[],jointComponents:[],ignoredEvents:[],activeObservationEvents:[]};
 const seenGroups=new Set<string>(),lastTime=new Map<string,string>();
 for(const event of events){
  if(event.kind!=='observe')continue;
  const evidenceGroup=root(`hash:${event.sourceHash}`);
  if(revokedGroups.has(evidenceGroup)){graph.ignoredEvents.push({eventId:event.id,reason:'retracted evidence group (including source aliases)'});continue;}
  if(seenGroups.has(evidenceGroup)){
   graph.ignoredEvents.push({eventId:event.id,reason:'duplicate source or correlated evidence group'});continue;
  }
  // Commit order remains the evidence order; late captures must not regress history.
  if((lastTime.get(event.placeId)??'')>event.observedAt){graph.ignoredEvents.push({eventId:event.id,reason:'late capture; explicit ordered replay required'});continue;}
  seenGroups.add(evidenceGroup);lastTime.set(event.placeId,event.observedAt);graph.activeObservationEvents.push(event.id);
  const prior=graph.entities.filter(e=>e.history[0].placeId===event.placeId);
  prior.forEach(e=>e.status='not_observed');
  const rows=event.observations.map(o=>({o,key:ref(event.id,o.id),candidates:prior.filter(e=>o.scope==='whole'&&e.scope==='whole'&&distance(o.feature,e.prototype)<=M.candidateDistance)}));
  const eligible=rows.filter(row=>{
   const uncomparable=prior.some(e=>e.prototype.method!==row.o.feature.method||e.prototype.values.length!==row.o.feature.values.length||e.scope!=='whole');
   if(row.o.scope==='part'||(row.o.scope==='unknown'&&prior.length)||uncomparable){
    graph.decisions.push({eventId:event.id,observationId:row.key,status:'deferred',entityId:null,alternatives:[],candidateIds:prior.map(e=>e.id),reason:'Whole-object scope or comparable descriptor method not established; observation retained without identity update'});
    prior.forEach(e=>e.status='unresolved');return false;
   }
   return true;
  });
  // Connected components share existing candidates. Independent components
  // need not be multiplied into an exponentially large whole-room hypothesis.
  const remaining=new Set(eligible);
  while(remaining.size){
   const seed=remaining.values().next().value!;remaining.delete(seed);const component=[seed],candidateIds=new Set(seed.candidates.map(c=>c.id));
   let changed=true;while(changed){changed=false;for(const row of remaining)if(row.candidates.some(c=>candidateIds.has(c.id))){remaining.delete(row);component.push(row);row.candidates.forEach(c=>candidateIds.add(c.id));changed=true;}}
   component.sort((a,b)=>a.key.localeCompare(b.key));
   const oversized=component.length>M.maxComponentObservations||candidateIds.size>M.maxComponentCandidates;
   const joint:{targets:string[];logWeight:number}[]=[];
   const options=component.map(row=>{
    const existing=row.candidates.map(e=>({target:e.id,logWeight:Math.log(M.matchPrior/row.candidates.length)-distance(row.o.feature,e.prototype)**2/(2*M.descriptorSigma**2)}));
    return [...existing,{target:'NEW',logWeight:Math.log(existing.length?M.newPrior:M.initialNewPrior)},
     {target:'CLUTTER',logWeight:Math.log(existing.length?M.clutterPrior:1-M.initialNewPrior)}];
   });
   function visit(i:number,targets:string[],used:Set<string>,logWeight:number){
    if(joint.length>M.maxJointAssignments)return;
    if(i===component.length){joint.push({targets,logWeight});return;}
    for(const option of options[i]){
     const existing=option.target!=='NEW'&&option.target!=='CLUTTER';if(existing&&used.has(option.target))continue;
     const next=new Set(used);if(existing)next.add(option.target);visit(i+1,[...targets,option.target],next,logWeight+option.logWeight);
    }
   }
   if(!oversized)visit(0,[],new Set(),0);
   const deferred=oversized||joint.length>M.maxJointAssignments;
   graph.jointComponents.push({eventId:event.id,observationIds:component.map(r=>r.key),assignments:deferred?0:joint.length,deferred});
   if(deferred){
    for(const row of component)graph.decisions.push({eventId:event.id,observationId:row.key,status:'deferred',entityId:null,alternatives:[],candidateIds:[...candidateIds],reason:'Exact inference budget exceeded; no pruning or guessed winner'});
    for(const id of candidateIds)prior.find(e=>e.id===id)!.status='unresolved';continue;
   }
   const max=Math.max(...joint.map(j=>j.logWeight)),weights=joint.map(j=>Math.exp(j.logWeight-max)),total=weights.reduce((a,b)=>a+b,0);
   for(const [index,row] of component.entries()){
    const support=new Map<string,number>();joint.forEach((j,i)=>support.set(j.targets[index],(support.get(j.targets[index])??0)+weights[i]/total));
    const alternatives=[...support].map(([target,weight])=>({target,weight})).sort((a,b)=>b.weight-a.weight||a.target.localeCompare(b.target));
    const best=alternatives[0],admit=best.weight>=M.admissionWeight&&best.weight-(alternatives[1]?.weight??0)>=M.admissionGap;
    const status:BeliefDecision['status']=!admit?'unresolved':best.target==='NEW'?'new-candidate':best.target==='CLUTTER'?'clutter':'linked';
    const key=status==='new-candidate'?entityKey(row.key):status==='linked'?best.target:null;
    graph.decisions.push({eventId:event.id,observationId:row.key,status,entityId:key,alternatives,
     reason:admit?'Admitted under uncalibrated v0 assumptions; not a measured physical-identity probability':'Competing assignments or insufficient support; prototype unchanged'});
    if(key){
     let entity=graph.entities.find(e=>e.id===key);
     if(!entity){entity={id:key,anchorObservation:row.key,scope:row.o.scope,prototype:structuredClone(row.o.feature),history:[],labels:[],status:'observed',currentWhereabouts:'last-seen-only'};graph.entities.push(entity);}
     entity.history.push(evidence(event,row.o,labels.get(row.key)));entity.status='observed';
    }else if(status==='unresolved')for(const candidate of row.candidates)if(candidate.status!=='observed')candidate.status='unresolved';
   }
  }
 }
 for(const entity of graph.entities){
  const claims=new Map<string,string[]>();for(const h of entity.history)if(h.label){const old=claims.get(h.label)??[];old.push(h.observationId);claims.set(h.label,old);}
  entity.labels=[...claims].map(([label,observationIds])=>({label,observationIds}));
 }
 return graph;
}
function evidence(event:BeliefEpisode,o:BeliefObservation,revised?:string):BeliefEvidence {
 return {eventId:event.id,observationId:ref(event.id,o.id),regionRef:o.regionRef,sourceHash:event.sourceHash,cropHash:o.cropHash,
  observedAt:event.observedAt,timeBasis:event.timeBasis,placeId:event.placeId,label:revised??o.label??null,location:o.location??null};
}
export function lastSeen(graph:BeliefProjection,entityId:string){
 const entity=graph.entities.find(e=>e.id===entityId);if(!entity)return {status:'unknown-candidate' as const,evidence:null,alternatives:[]};
 const alternatives=graph.decisions.filter(d=>(d.status==='unresolved'||d.status==='deferred')&&(d.alternatives.some(a=>a.target===entityId)||d.candidateIds?.includes(entityId)));
 return {status:entity.status,evidence:entity.history.at(-1)!,alternatives,whereabouts:'Last observed evidence only; present location and physical identity remain uncertain.'};
}
