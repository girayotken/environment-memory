import {roomLastObservation,roomNodeLabel} from '../client/room-memory-index.ts';
import {z} from 'zod';
import {RoomEditMessageSchema,RoomEditUndoSchema,RoomEditDecisionSchema,type RoomEditDecision,type RoomUserEdit} from '../domain/room-user-edit.ts';
import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {RoomInitialImportSchema,RoomSourceSchema,RoomGraphSchema,RoomVisitImportSchema,RoomObservationSchema,RoomCurrentObservationReportSchema,RoomSemanticAnswerSchema,RoomSemanticUndoSchema,RoomContinuityCorrectionSchema,RoomContinuityCorrectionUndoSchema,RoomContinuityCorrectionRecordSchema,roomUnknownDescription,type RoomCurrentObservationReport,type RoomObservation,type RoomObservationGraphHypothesis,type RoomSemanticRevision,type RoomVisitImport,type RoomSource,type RoomGraph,type RoomMemory,type RoomMemoryResponse} from '../domain/room-memory-contracts.ts';
import {RoomObserverResultSchema,validateRoomActionAssessments,type RoomObserverResult,type RoomActionNeeded,type RoomFollowupScope} from '../domain/room-observer-contracts.ts';
import type {CapturedFrame} from '../domain/capture-contracts.ts';
import {CaptureStore} from './capture-store.ts';
import {validateRoomFollowup,roomViewDeferral} from './room-followup-policy.ts';
import {validateRoomComparisons} from './room-comparison-policy.ts';
import {evaluateRoomObservationGraph} from '../domain/room-observation-graph.ts';
import {evaluateRoomContinuity,projectRoomContinuity,type RoomContinuityDecision} from '../domain/room-continuity.ts';
import {applyRoomContinuityCorrections} from '../domain/room-continuity-corrections.ts';
import {roomContinuityExclusions} from '../domain/room-continuity-exclusions.ts';
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
export class RoomMemoryValidationError extends Error {}
export class RoomMemoryConflictError extends Error {}
/** Agent-derived semantic hypotheses. Never writes candidate, personal claim or identity stores. */
export class RoomMemoryStore {
 private db:DatabaseSync;private captures:CaptureStore;
 constructor(directory:string){mkdirSync(directory,{recursive:true});this.captures=new CaptureStore(directory);this.db=new DatabaseSync(join(directory,'room-memory.sqlite'));this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS room_containment_ops(operation_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, request TEXT NOT NULL, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS room_user_edits(operation_id TEXT PRIMARY KEY,room_id TEXT NOT NULL,node_id TEXT NOT NULL,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS room_records(room_id TEXT PRIMARY KEY,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS room_visits(visit_id TEXT PRIMARY KEY,room_id TEXT NOT NULL,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS room_semantic_revisions(revision_id TEXT PRIMARY KEY,room_id TEXT NOT NULL,node_id TEXT NOT NULL,label TEXT NOT NULL,created_at TEXT NOT NULL,withdrawn INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS room_observer_extensions(job_id TEXT PRIMARY KEY,room_id TEXT NOT NULL,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS room_observer_actions(action_id TEXT PRIMARY KEY,room_id TEXT NOT NULL,node_id TEXT NOT NULL,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS room_imports(import_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS room_observations(observation_id TEXT PRIMARY KEY,room_id TEXT NOT NULL,job_id TEXT NOT NULL,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS room_graph_hypotheses(hypothesis_id TEXT PRIMARY KEY,room_id TEXT NOT NULL,job_id TEXT NOT NULL,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS room_continuity_corrections(correction_id TEXT PRIMARY KEY,room_id TEXT NOT NULL,node_id TEXT NOT NULL,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS room_continuity_decisions(decision_id TEXT PRIMARY KEY,room_id TEXT NOT NULL,job_id TEXT NOT NULL,record TEXT NOT NULL);`);}
 close(){this.db.close();this.captures.close();}
 private sources(sources:RoomSource[]){
  if(new Set(sources.map(s=>s.viewId)).size!==sources.length)throw new RoomMemoryValidationError('Duplicate view ID');
  const frames=new Map(this.captures.frames().map(f=>[f.id,f]));
  return sources.map(source=>{const frame=frames.get(source.frameId),bytes=this.captures.asset(source.sourceHash);if(!frame||frame.sourceHash!==source.sourceHash||!bytes||hash(bytes)!==source.sourceHash)throw new RoomMemoryValidationError('Room source is missing or changed');return {...source,imageUrl:`/api/scan/room-memory/assets/${source.sourceHash}`,capturedAt:frame.capturedAt};});
 }
 private evidence(items:{evidence:{viewId:string}[]}[],views:Set<string>){for(const item of items)for(const e of item.evidence)if(!views.has(e.viewId))throw new RoomMemoryValidationError('Unknown evidence view');}
 private validateGraph(graph:RoomGraph){
  this.sources(graph.sourceViews);const views=new Set(graph.sourceViews.map(s=>s.viewId)),nodes=new Set(graph.nodes.map(n=>n.id));
  if(nodes.size!==graph.nodes.length)throw new RoomMemoryValidationError('Duplicate node ID');
  this.evidence([...graph.nodes,...graph.edges,...graph.identityGroups],views);
  for(const e of graph.edges)if(!nodes.has(e.from)||!nodes.has(e.to)||e.from===e.to)throw new RoomMemoryValidationError('Invalid edge endpoint');
  const groups=new Set<string>();for(const g of graph.identityGroups){const node=graph.nodes.find(n=>n.id===g.nodeId),supported=new Set(node?.evidence.map(e=>e.viewId)),groupEvidence=new Set(g.evidence.map(e=>e.viewId));if(!node||groups.has(g.nodeId)||new Set(g.viewIds).size!==g.viewIds.length||g.viewIds.some(v=>!views.has(v)||!supported.has(v)||!groupEvidence.has(v))||g.evidence.some(e=>!g.viewIds.includes(e.viewId)))throw new RoomMemoryValidationError('Invalid identity group reference');groups.add(g.nodeId);}
  for(const n of Object.keys(graph.nodeOrigins))if(!nodes.has(n))throw new RoomMemoryValidationError('Unknown node origin');
  for(const n of graph.reviewNotes.flatMap(n=>[...(n.finalId?[n.finalId]:[]),...(n.finalIds??[])]))if(!nodes.has(n))throw new RoomMemoryValidationError('Unknown review node');
 }
 private write(importId:string,input:unknown,fn:()=>void){
  const payload=canonical(input);if(Buffer.byteLength(payload)>2*1024*1024)throw new RoomMemoryValidationError('Room import exceeds size limit');
  this.db.exec('BEGIN IMMEDIATE');try{const prior=this.db.prepare('SELECT payload_hash FROM room_imports WHERE import_id=?').get(importId);if(prior){if(prior.payload_hash!==hash(payload))throw new RoomMemoryConflictError('Immutable import ID collision');}else{fn();this.db.prepare('INSERT INTO room_imports VALUES(?,?)').run(importId,hash(payload));}this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 /** A user-declared room starts without observations or source images. */
 createEmpty(input:unknown){const parsed=z.strictObject({operationId:z.string().uuid(),label:z.string().trim().min(1).max(200)}).safeParse(input);if(!parsed.success)throw new RoomMemoryValidationError('Invalid room name');const {operationId,label}=parsed.data;const record={schemaVersion:1 as const,importId:`create-${operationId}`,roomId:`room-${operationId}`,label,graph:{scope:'No views observed yet.',sourceViews:[],nodes:[],edges:[],identityGroups:[],unknowns:[],nodeOrigins:{},reviewNotes:[]}};this.write(record.importId,record,()=>{this.db.prepare('INSERT INTO room_records VALUES(?,?)').run(record.roomId,JSON.stringify(record));});return this.read();}
 importInitial(input:unknown){const parsed=RoomInitialImportSchema.safeParse(input);if(!parsed.success||!parsed.data.graph.sourceViews.length||!parsed.data.graph.nodes.length)throw new RoomMemoryValidationError('Invalid room graph import');const p=parsed.data;this.validateGraph(p.graph);this.write(p.importId,p,()=>{const prior=this.db.prepare('SELECT record FROM room_records WHERE room_id=?').get(p.roomId);if(prior){if(canonical(JSON.parse(String(prior.record)))!==canonical(p))throw new RoomMemoryConflictError('Immutable room ID collision');}else this.db.prepare('INSERT INTO room_records VALUES(?,?)').run(p.roomId,JSON.stringify(p));});return this.read();}
 importVisit(input:unknown){
  const parsed=RoomVisitImportSchema.safeParse(input);if(!parsed.success)throw new RoomMemoryValidationError('Invalid room visit import');const p=parsed.data;if(p.proposals.some(proposal=>proposal.viewDeferral))throw new RoomMemoryValidationError('View deferrals are server-owned focused observation annotations');const room=this.db.prepare('SELECT record FROM room_records WHERE room_id=?').get(p.roomId);
  if(!room)throw new RoomMemoryValidationError('Unknown room');const graph=RoomInitialImportSchema.parse(JSON.parse(String(room.record))).graph;this.validateGraph(graph);this.sources(p.sourceViews);const nodes=new Set(this.read().rooms.find(r=>r.roomId===p.roomId)!.graph.nodes.map(n=>n.id)),views=new Set(p.sourceViews.map(s=>s.viewId));
  this.evidence(p.proposals,views);const likely=p.proposals.filter(x=>x.status==='likely-same');if(likely.some(x=>x.observationId===null)||new Set(likely.map(x=>x.observationId)).size!==likely.length||p.proposals.some(x=>x.status!=='not-observed'&&x.observationId===null))throw new RoomMemoryValidationError('Invalid or multiply matched observation');if(new Set(p.proposals.map(x=>x.id)).size!==p.proposals.length||new Set(p.proposals.map(x=>x.nodeId)).size!==p.proposals.length||p.proposals.some(x=>!nodes.has(x.nodeId)))throw new RoomMemoryValidationError('Invalid proposal node or duplicate proposal');
  this.write(p.importId,p,()=>{const prior=this.db.prepare('SELECT record FROM room_visits WHERE visit_id=?').get(p.visitId);if(prior){if(canonical(JSON.parse(String(prior.record)))!==canonical(p))throw new RoomMemoryConflictError('Immutable visit ID collision');}else this.db.prepare('INSERT INTO room_visits VALUES(?,?,?)').run(p.visitId,p.roomId,JSON.stringify(p));});return this.read();
 }
 /** Current evidence commits before graph validation. A rejected association cannot erase valid current-image evidence. */
 saveCurrentObservations(jobId:string,roomId:string,frame:CapturedFrame,currentObservations:RoomCurrentObservationReport[],provenance:'agent-derived'|'authored-test'){
  if(!this.db.prepare('SELECT room_id FROM room_records WHERE room_id=?').get(roomId))throw new RoomMemoryValidationError('Unknown room');
  if(currentObservations.length>16)throw new RoomMemoryValidationError('Observation count exceeds limit');
  const source={viewId:`auto-view-${jobId}`,frameId:frame.id,sourceHash:frame.sourceHash},boundSource=this.sources([source])[0];
  if(frame.capturedAt!==boundSource.capturedAt)throw new RoomMemoryValidationError('Observation must use the saved source capture time');
  const observations=currentObservations.map((report,index)=>{const o=RoomCurrentObservationReportSchema.parse(report);return RoomObservationSchema.parse({observationId:`auto-observation-${jobId}-${index}`,jobId,roomId,source,capturedAt:boundSource.capturedAt,provenance,label:o.label,kind:o.kind,attributes:o.attributes,basis:o.basis,...(o.location?{location:o.location}:{}),...(o.semanticUnknown?{semanticUnknown:o.semanticUnknown}:{}),...(o.currentAppearance?{currentAppearance:o.currentAppearance}:{}),...(o.comparisonJudgment?{comparisonJudgment:o.comparisonJudgment}:{})});});
  this.write(`observation-import-${jobId}`,{roomId,source,observations},()=>{for(const observation of observations)this.db.prepare('INSERT INTO room_observations VALUES(?,?,?,?)').run(observation.observationId,roomId,jobId,JSON.stringify(observation));});
  return observations;
 }
 /** Graph publication is atomic; immutable current observations have their own preceding commit. */
 publishObservation(jobId:string,roomId:string,frame:CapturedFrame,input:unknown,provenance:'agent-derived'|'authored-test'='agent-derived',pendingActions:RoomActionNeeded[]=[],followup?:RoomFollowupScope,comparisonNodeIds?:string[],referenceSourceHashes?:string[]){
  const result=RoomObserverResultSchema.parse(input),room=this.read().rooms.find(r=>r.roomId===roomId);
  if(!room)throw new RoomMemoryValidationError('Unknown room');
  const observations=this.saveCurrentObservations(jobId,roomId,frame,result.observations.map(({label,kind,attributes,basis,location,semanticUnknown,currentAppearance,comparisonJudgment})=>({label,kind,attributes,basis:currentAppearance?.description??basis,...(location?{location}:{}),...(semanticUnknown?{semanticUnknown}:{}),...(currentAppearance?{currentAppearance}:{}),...(comparisonJudgment?{comparisonJudgment}:{})})),provenance);
  if(result.protocolVersion===2){
   const sources=[...room.graph.sourceViews,...room.visits.flatMap(v=>v.sourceViews)];
   if((referenceSourceHashes??[]).some(hash=>hash===frame.sourceHash||!sources.some(source=>source.sourceHash===hash&&Date.parse(source.capturedAt)<Date.parse(frame.capturedAt))))throw new RoomMemoryValidationError('Comparison reference must be a saved earlier room source.');
   validateRoomComparisons(result,{room,comparisonNodeIds,frame},referenceSourceHashes??[]);
  }
  const boundSource=this.sources([{viewId:`auto-view-${jobId}`,frameId:frame.id,sourceHash:frame.sourceHash}])[0];
  const graphHypotheses:RoomObservationGraphHypothesis[]=result.protocolVersion===2?observations.map((observation,index)=>{
   const report=result.observations[index],candidate={candidateNodeId:report.nodeId,...(report.comparisonJudgment?{comparisonJudgment:report.comparisonJudgment}:{}),...(report.comparison?{comparison:report.comparison}:{}),status:report.status,basis:report.basis,alternatives:report.alternatives,conditioning:'context-conditioned' as const};
   return {hypothesisId:`auto-hypothesis-${jobId}-${index}`,jobId,roomId,observationId:observation.observationId,candidate,evaluation:evaluateRoomObservationGraph(room,{...observation,source:boundSource},candidate)};
  }):[];
  const effectiveResult:RoomObserverResult={...result,observations:result.observations.map((report,index)=>{const favored=graphHypotheses[index]?.evaluation.favoredHypothesis;return favored?{...report,status:favored==='same-object'?'likely-same':favored==='similar-other'?'different':'uncertain'}:report;})};
  const source={viewId:`auto-view-${jobId}`,frameId:frame.id,sourceHash:frame.sourceHash};this.sources([source]);
  const seen=new Set<string>();for(const o of result.observations){if(o.nodeId&&(!room.graph.nodes.some(n=>n.id===o.nodeId)||seen.has(o.nodeId)))throw new RoomMemoryValidationError('Unknown or duplicate observed node');if(o.nodeId)seen.add(o.nodeId);if((o.needs!=='none'&&!o.request)||(o.nodeId&&o.status==='uncertain'&&!(result.protocolVersion===2&&o.needs==='none')&&o.needs!=='view'&&!(o.semanticUnknown&&o.needs==='explanation')))throw new RoomMemoryValidationError('Visible identity uncertainty requires a requested view');if(o.needs==='explanation'&&!o.semanticUnknown)throw new RoomMemoryValidationError('Explanation requires semantic uncertainty');}
  validateRoomActionAssessments(effectiveResult,pendingActions,roomId,frame.sourceHash);
  validateRoomFollowup(followup,pendingActions,roomId);
  const currentActions=this.actions();
  if(followup){const action=currentActions.find(a=>a.actionId===followup.actionId);if(!action||action.roomId!==roomId||action.kind!=='view'||action.nodeId!==followup.nodeId||action.sourceHash!==followup.sourceHash||action.request!==followup.request||(action.status!=='open'&&action.resolution?.jobId!==jobId))throw new RoomMemoryValidationError('Focused action changed or was closed before publication');}
  for(const assessment of result.actionAssessments??[]){
   const supplied=pendingActions.find(a=>a.actionId===assessment.actionId)!,stored=currentActions.find(a=>a.actionId===assessment.actionId);
   if(!stored||stored.roomId!==roomId||stored.nodeId!==supplied.nodeId||stored.sourceHash!==supplied.sourceHash||stored.kind!==supplied.kind||stored.request!==supplied.request||(stored.status!=='open'&&stored.resolution?.jobId!==jobId))throw new RoomMemoryValidationError('Pending action changed or was closed before publication');
  }
  const relationItems=new Set<number>();
  for(const rel of result.containment??[]){const item=result.observations[rel.itemIndex],box=result.observations[rel.containerIndex];if(!item||!box||rel.itemIndex===rel.containerIndex||!['portable','container','contents_group'].includes(item.kind)||box.kind!=='container'||relationItems.has(rel.itemIndex))throw new RoomMemoryValidationError('Invalid visual containment relation');relationItems.add(rel.itemIndex);}
  for(const rel of result.outsideContainment??[]){const item=result.observations[rel.itemIndex],box=result.observations[rel.containerIndex];if(!item||!box||rel.itemIndex===rel.containerIndex||!['portable','container','contents_group'].includes(item.kind)||box.kind!=='container'||relationItems.has(rel.itemIndex))throw new RoomMemoryValidationError('Invalid visual outside containment relation');relationItems.add(rel.itemIndex);}
  const supportParents=new Map<number,number>();
  // A visible support may itself rest on another support (for example a cutting
  // mat on a table). Preserve the same one-parent, evidence and acyclic boundary.
  for(const rel of result.support??[]){
   const item=result.observations[rel.itemIndex],support=result.observations[rel.supportIndex];
   if(!item||!support||rel.itemIndex===rel.supportIndex||!['portable','container','contents_group','support'].includes(item.kind)||support.kind!=='support'||![item,support].every(report=>report.currentAppearance?.features.some(feature=>feature.visible))||supportParents.has(rel.itemIndex))throw new RoomMemoryValidationError('Invalid visual support relation');
   supportParents.set(rel.itemIndex,rel.supportIndex);
  }
  for(const itemIndex of supportParents.keys()){
   const visited=new Set<number>();let next:number|undefined=itemIndex;
   while(next!==undefined){if(visited.has(next))throw new RoomMemoryValidationError('Invalid visual support relation: cycle');visited.add(next);next=supportParents.get(next);}
  }
  const now=new Date().toISOString(),nodes:RoomGraph['nodes']=[],actions:RoomActionNeeded[]=[],proposals:RoomVisitImport['proposals']=[];
  effectiveResult.observations.forEach((o,index)=>{const viewDeferral=roomViewDeferral(room,o,followup,frame.capturedAt),nodeId=o.nodeId??`auto-node-${hash(jobId+':'+index).slice(0,32)}`,evidence=[{viewId:source.viewId,basis:o.basis,...(o.location?{location:o.location}:{})}];
   if(!o.nodeId)nodes.push({id:nodeId,label:o.label,kind:o.kind,status:'provisional',attributes:o.attributes,...(o.semanticUnknown?{semantic:{status:'unknown' as const,description:o.semanticUnknown}}:{}),evidence});
   proposals.push({id:`auto-proposal-${jobId}-${index}`,nodeId,observationId:`auto-observation-${jobId}-${index}`,status:o.nodeId?o.status:'uncertain',label:o.label,basis:o.basis,alternatives:o.alternatives,evidence,...(o.currentAppearance?{currentAppearance:o.currentAppearance}:{}),...(o.comparison?{comparison:o.comparison}:{}),...(o.comparisonJudgment?{comparisonJudgment:o.comparisonJudgment}:{}),...(viewDeferral?{viewDeferral}:{})});
   if(o.needs!=='none'&&!viewDeferral&&(!o.nodeId||!roomContinuityExclusions(room,o.nodeId).sourceHashes.has(frame.sourceHash)))actions.push({actionId:`auto-action-${jobId}-${index}`,jobId,roomId,nodeId,kind:o.needs,request:o.request!,sourceHash:frame.sourceHash,status:'open',createdAt:now});
  });
  const visit={schemaVersion:1 as const,importId:`auto-import-${jobId}`,roomId,visitId:`auto-visit-${jobId}`,label:'Automatic saved-frame check',summary:result.summary,sourceViews:[source],proposals};
  const support=(result.support??[]).map(rel=>({itemId:proposals[rel.itemIndex].nodeId,supportId:proposals[rel.supportIndex].nodeId,statement:rel.basis}));
  const extension={source,nodes,provenance,...(support.length?{support}:{}),semantic:result.observations.flatMap(o=>o.nodeId&&o.semanticUnknown&&(result.protocolVersion!==2||o.status==='likely-same')?[{nodeId:o.nodeId,description:o.semanticUnknown,evidence:[{viewId:source.viewId,basis:o.basis}]}]:[])};
  this.write(visit.importId,{roomId,frameId:frame.id,sourceHash:frame.sourceHash,result,...(followup?{followup}:{}),...(comparisonNodeIds?{comparisonNodeIds}:{}),...(referenceSourceHashes?{referenceSourceHashes}:{})},()=>{
   this.db.prepare('INSERT INTO room_observer_extensions VALUES(?,?,?)').run(jobId,roomId,JSON.stringify(extension));
   this.db.prepare('INSERT INTO room_visits VALUES(?,?,?)').run(visit.visitId,roomId,JSON.stringify(visit));
   for(const hypothesis of graphHypotheses)this.db.prepare('INSERT INTO room_graph_hypotheses VALUES(?,?,?,?)').run(hypothesis.hypothesisId,roomId,jobId,JSON.stringify(hypothesis));
   // New v2 publications alone enter this policy. Existing graph reports are never backfilled.
   const continuityRoom=this.read().rooms.find(room=>room.roomId===roomId)!,priorDecisions=this.continuityDecisions(roomId);
   for(const [index,hypothesis] of graphHypotheses.entries()){const decision=evaluateRoomContinuity(continuityRoom,{...observations[index],source:boundSource},hypothesis.candidate,priorDecisions);this.db.prepare('INSERT INTO room_continuity_decisions VALUES(?,?,?,?)').run(decision.decisionId,roomId,jobId,JSON.stringify(decision));priorDecisions.push(decision);continuityRoom.continuityLinks=projectRoomContinuity(priorDecisions);}
   // Support is a dated observation, not membership. Existing endpoints must have
   // this frame's working assignment; graph identity status is a separate judgment.
   const assignedSupport=(result.support??[]).filter(rel=>[rel.itemIndex,rel.supportIndex].every(index=>{const report=result.observations[index];return !report.nodeId||(result.protocolVersion===2?continuityRoom.continuityLinks?.some(link=>link.nodeId===report.nodeId&&link.observationId===observations[index].observationId&&link.state==='active'):report.status==='likely-same');})).map(rel=>({itemId:proposals[rel.itemIndex].nodeId,supportId:proposals[rel.supportIndex].nodeId,statement:rel.basis}));
   this.db.prepare('UPDATE room_observer_extensions SET record=? WHERE job_id=?').run(JSON.stringify({...extension,support:assignedSupport}),jobId);
   // Only fresh explicit current-frame relations can create provisional containment.
   // Prior user decisions take precedence; absence from a frame is never removal.
   const containmentRoom=this.read().rooms.find(r=>r.roomId===roomId)!;
   const active=new Map(containmentRoom.containment!.active.map(e=>[e.itemId,e.containerId]));
   for(const [i,rel] of (result.containment??[]).entries()){
    const itemReport=effectiveResult.observations[rel.itemIndex],boxReport=effectiveResult.observations[rel.containerIndex];
    if((itemReport.nodeId&&itemReport.status!=='likely-same')||(boxReport.nodeId&&boxReport.status!=='likely-same'))continue;
    const itemId=proposals[rel.itemIndex].nodeId,containerId=proposals[rel.containerIndex].nodeId;
    const itemNode=containmentRoom.graph.nodes.find(n=>n.id===itemId),boxNode=containmentRoom.graph.nodes.find(n=>n.id===containerId);
    if(!itemNode||!boxNode||!['portable','container','contents_group'].includes(itemNode.kind)||boxNode.kind!=='container')continue;
    if(itemId===containerId||containmentRoom.containment!.events.some(e=>e.itemId===itemId&&((e.attribution==='user'&&!e.withdrawn)||(e.attribution==='model'&&!e.withdrawn&&!e.invalidated&&Date.parse(e.source.capturedAt)>=Date.parse(frame.capturedAt))))||active.get(itemId)===containerId)continue;
    let next:string|undefined=containerId;const visited=new Set<string>();let cyclic=false;while(next){if(next===itemId||visited.has(next)){cyclic=true;break;}visited.add(next);next=active.get(next);}if(cyclic)continue;
    const operationId=`auto-containment-${jobId}-${i}`,record={operationId,roomId,itemId,containerId,action:'put-in',statement:rel.basis,attribution:'model',recordedAt:now,source:boundSource};
    this.db.prepare('INSERT INTO room_containment_ops VALUES(?,?,?,?)').run(operationId,roomId,canonical(record),JSON.stringify(record));active.set(itemId,containerId);
   }
   for(const [i,rel] of (result.outsideContainment??[]).entries()){
    const item=result.observations[rel.itemIndex],box=result.observations[rel.containerIndex];
    // Follow the same source-bound working assignment that advances last-seen.
    // A raw uncertain/different proposal or a withdrawn continuity never retires a claim.
    const assigned=(index:number,nodeId:string)=>result.protocolVersion!==2?effectiveResult.observations[index].status==='likely-same':continuityRoom.continuityLinks?.some(link=>link.nodeId===nodeId&&link.observationId===`auto-observation-${jobId}-${index}`&&link.state==='active');
    if(!item.nodeId||!box.nodeId||item.status!=='likely-same'||box.status!=='likely-same'||!assigned(rel.itemIndex,item.nodeId)||!assigned(rel.containerIndex,box.nodeId))continue;
    const prior=containmentRoom.containment!.active.find(e=>e.itemId===item.nodeId&&e.containerId===box.nodeId);
    const itemNode=containmentRoom.graph.nodes.find(n=>n.id===item.nodeId),boxNode=containmentRoom.graph.nodes.find(n=>n.id===box.nodeId);
    if(!prior||!itemNode||!boxNode||!['portable','container','contents_group'].includes(itemNode.kind)||boxNode.kind!=='container')continue;
    // User claims remain authoritative; chronology is measured by the source image.
    if(prior.attribution==='user'||containmentRoom.containment!.events.some(e=>e.itemId===item.nodeId&&((e.attribution==='user'&&!e.withdrawn)||(e.action==='outside'&&e.withdrawn&&e.containerId===box.nodeId)))||Date.parse(frame.capturedAt)<=Date.parse(prior.source.capturedAt)||frame.sourceHash===prior.source.sourceHash)continue;
    const operationId=`auto-outside-${jobId}-${i}`,record={operationId,roomId,itemId:item.nodeId,containerId:box.nodeId,action:'outside',statement:rel.basis,attribution:'model',recordedAt:now,source:boundSource};
    this.db.prepare('INSERT INTO room_containment_ops VALUES(?,?,?,?)').run(operationId,roomId,canonical(record),JSON.stringify(record));active.delete(item.nodeId);
   }
   for(const assessment of result.actionAssessments??[])if(assessment.status==='addressed'){const action=currentActions.find(a=>a.actionId===assessment.actionId)!;this.db.prepare('UPDATE room_observer_actions SET record=? WHERE action_id=?').run(JSON.stringify({...action,status:'resolved',resolution:{jobId,frameId:frame.id,sourceHash:frame.sourceHash,viewId:source.viewId,basis:assessment.basis,capturedAt:frame.capturedAt,resolvedAt:now}}),action.actionId);}
   for(const action of actions)this.db.prepare('INSERT INTO room_observer_actions VALUES(?,?,?,?)').run(action.actionId,roomId,action.nodeId,JSON.stringify(action));
  });return visit.visitId;
 }
 private continuityDecisions(roomId:string):RoomContinuityDecision[]{return this.db.prepare('SELECT record FROM room_continuity_decisions WHERE room_id=? ORDER BY rowid').all(roomId).map(row=>{const decision=JSON.parse(String(row.record)) as RoomContinuityDecision;if(decision.roomId!==roomId)throw new RoomMemoryValidationError('Invalid continuity room');const source=this.sources([decision.source])[0];if(source.capturedAt!==decision.source.capturedAt)throw new RoomMemoryValidationError('Continuity capture time changed');return {...decision,source};});}
 observations(roomId:string){return this.db.prepare('SELECT record FROM room_observations WHERE room_id=? ORDER BY rowid').all(roomId).map(row=>{const observation=RoomObservationSchema.parse(JSON.parse(String(row.record)));if(observation.roomId!==roomId)throw new RoomMemoryValidationError('Invalid observation room');const source=this.sources([observation.source])[0];if(source.capturedAt!==observation.capturedAt)throw new RoomMemoryValidationError('Observation capture time changed');return {...observation,source};});}
 private correctionProjection(roomId:string){
  const corrections=this.db.prepare('SELECT record FROM room_continuity_corrections WHERE room_id=? ORDER BY rowid').all(roomId).map(row=>{
   const correction=RoomContinuityCorrectionRecordSchema.parse(JSON.parse(String(row.record))),source=this.sources([correction.source])[0];
   if(correction.roomId!==roomId||source.capturedAt!==correction.source.capturedAt)throw new RoomMemoryValidationError('Invalid user correction source');
   return {...correction,source};
  });return corrections.length?{continuityCorrections:corrections}:{};
 }
 correctContinuity(input:unknown){
  const parsed=RoomContinuityCorrectionSchema.safeParse(input);if(!parsed.success)throw new RoomMemoryValidationError('Invalid continuity correction');const p=parsed.data;
  this.write(p.operationId,p,()=>{
   const room=this.read().rooms.find(room=>room.roomId===p.roomId),link=room?.continuityLinks?.find(link=>link.linkId===p.linkId&&link.nodeId===p.nodeId);
   if(!room||!link)throw new RoomMemoryValidationError('Unknown room continuity assignment');
   if(link.state!=='active')throw new RoomMemoryConflictError('This assignment is no longer active; refresh memory');
   const observation=room.observations?.find(observation=>observation.observationId===link.observationId);
   if(!observation)throw new RoomMemoryValidationError('Assignment has no saved observation');
   const record=RoomContinuityCorrectionRecordSchema.parse({correctionId:p.operationId,roomId:p.roomId,nodeId:p.nodeId,linkId:p.linkId,observationId:link.observationId,separatedNodeId:`separated-${hash(p.operationId).slice(0,32)}`,source:link.source,attribution:'user',createdAt:new Date().toISOString(),withdrawn:false});
   if(room.graph.nodes.some(node=>node.id===record.separatedNodeId))throw new RoomMemoryConflictError('Separated memory ID collision');
   this.db.prepare('INSERT INTO room_continuity_corrections VALUES(?,?,?,?)').run(record.correctionId,record.roomId,record.nodeId,JSON.stringify(record));
  });return this.read();
 }
 undoContinuityCorrection(input:unknown){
  const parsed=RoomContinuityCorrectionUndoSchema.safeParse(input);if(!parsed.success)throw new RoomMemoryValidationError('Invalid correction undo');const p=parsed.data;
  this.write(p.operationId,p,()=>{
   const room=this.read().rooms.find(room=>room.roomId===p.roomId),correction=room?.continuityCorrections?.find(item=>item.correctionId===p.correctionId&&item.nodeId===p.nodeId);
   if(!room||!correction)throw new RoomMemoryValidationError('Unknown user correction');
   if(correction.withdrawn)throw new RoomMemoryConflictError('This correction was already undone; refresh memory');
   const observations=new Map((room.observations??[]).map(observation=>[observation.observationId,observation]));
   if(room.graphHypotheses?.some(item=>item.candidate.candidateNodeId===p.nodeId&&Date.parse(observations.get(item.observationId)?.capturedAt??'')>Date.parse(correction.source.capturedAt)&&item.candidate.comparison?.features.some(feature=>feature.priorSourceHash===correction.source.sourceHash&&feature.result==='different'&&!['location','state'].includes(feature.kind))))throw new RoomMemoryConflictError('Newer evidence contradicts the corrected assignment; undo would revive it');
   // Removing the synthetic entry must never discard subsequent evidence or personal meaning.
   const separated=correction.separatedNodeId;
   const personal=this.userEdit(p.roomId,separated);
   if((personal.name!==null||personal.groups.length>0||personal.tags.length>0)||room.visits.some(visit=>visit.proposals.some(proposal=>proposal.nodeId===separated))||room.graphHypotheses?.some(item=>item.candidate.candidateNodeId===separated)||room.continuityLinks?.some(link=>link.nodeId===separated)||room.semanticRevisions?.some(revision=>revision.nodeId===separated)||this.actions().some(action=>action.roomId===p.roomId&&action.nodeId===separated&&action.sourceHash!==correction.source.sourceHash)||room.continuityCorrections?.some(item=>item.nodeId===separated))throw new RoomMemoryConflictError('Separate memory has newer evidence; undo would discard it');
   this.db.prepare('UPDATE room_continuity_corrections SET record=? WHERE correction_id=?').run(JSON.stringify({...correction,withdrawn:true}),correction.correctionId);
  });return this.read();
 }
 actions():RoomActionNeeded[]{
  return this.db.prepare('SELECT record FROM room_observer_actions ORDER BY rowid').all().map(row=>JSON.parse(String(row.record)) as RoomActionNeeded).map(action=>{
   const correction=this.correctionProjection(action.roomId).continuityCorrections?.find(correction=>!correction.withdrawn&&correction.nodeId===action.nodeId&&correction.source.sourceHash===action.sourceHash);
   return correction?{...action,nodeId:correction.separatedNodeId}:action;
  }).map(action=>({...action,status:action.kind==='explanation'&&this.db.prepare('SELECT revision_id FROM room_semantic_revisions WHERE room_id=? AND node_id=? AND withdrawn=0').get(action.roomId,action.nodeId)?'resolved':action.status}));
 }

 answerSemantic(input:unknown){
  const parsed=RoomSemanticAnswerSchema.safeParse(input);if(!parsed.success)throw new RoomMemoryValidationError('Invalid semantic answer');const p=parsed.data;
  const room=this.read().rooms.find(r=>r.roomId===p.roomId),node=room?.graph.nodes.find(n=>n.id===p.nodeId);
  if(!node||!roomUnknownDescription(node))throw new RoomMemoryValidationError('This node has no unresolved semantic question');
  this.write(p.operationId,p,()=>{if(this.db.prepare('SELECT revision_id FROM room_semantic_revisions WHERE room_id=? AND node_id=? AND withdrawn=0').get(p.roomId,p.nodeId))throw new RoomMemoryConflictError('This question already has an answer; undo it before changing it');this.db.prepare('INSERT INTO room_semantic_revisions(revision_id,room_id,node_id,label,created_at) VALUES(?,?,?,?,?)').run(p.operationId,p.roomId,p.nodeId,p.label,new Date().toISOString());});return this.read();
 }
 undoSemantic(input:unknown){
  const parsed=RoomSemanticUndoSchema.safeParse(input);if(!parsed.success)throw new RoomMemoryValidationError('Invalid semantic undo');const p=parsed.data;
  const room=this.read().rooms.find(r=>r.roomId===p.roomId),revision=room?.semanticRevisions?.find(r=>r.revisionId===p.revisionId&&r.nodeId===p.nodeId);
  if(!revision)throw new RoomMemoryValidationError('Unknown revision for this room and node');
  this.write(p.operationId,p,()=>{this.db.prepare('UPDATE room_semantic_revisions SET withdrawn=1 WHERE revision_id=? AND room_id=? AND node_id=?').run(p.revisionId,p.roomId,p.nodeId);});return this.read();
 }
 private userEdit(roomId:string,nodeId:string):RoomUserEdit {
  const rows=this.db.prepare('SELECT record FROM room_user_edits WHERE room_id=? AND node_id=? ORDER BY rowid').all(roomId,nodeId).map(r=>JSON.parse(String(r.record)) as {operationId:string;after:RoomUserEdit});
  return rows.at(-1)?.after??{nodeId,revision:0,name:null,groups:[],tags:[],lastRevisionId:null};
 }
 existingUserEdit(input:unknown){
  const parsed=RoomEditMessageSchema.safeParse(input);if(!parsed.success)throw new RoomMemoryValidationError('Invalid edit message');const p=parsed.data,row=this.db.prepare('SELECT record FROM room_user_edits WHERE operation_id=?').get(p.operationId);if(!row)return null;const record=JSON.parse(String(row.record));if(record.roomId!==p.roomId||record.nodeId!==p.nodeId||record.expectedRevision!==p.expectedRevision||record.text!==p.text||record.undo)throw new RoomMemoryConflictError('Operation ID already used');return record.decision as RoomEditDecision;
 }
 editBinding(roomId:string,nodeId:string){const room=this.read().rooms.find(r=>r.roomId===roomId),node=room?.graph.nodes.find(n=>n.id===nodeId);if(!room||!node)throw new RoomMemoryValidationError('Unknown room or selected node');return canonical({node,corrections:(room.continuityCorrections??[]).filter(c=>c.nodeId===nodeId||c.separatedNodeId===nodeId),links:(room.continuityLinks??[]).filter(l=>l.nodeId===nodeId)});}
 editContext(roomId:string,nodeId:string,expectedRevision:number){
  const room=this.read().rooms.find(r=>r.roomId===roomId),node=room?.graph.nodes.find(n=>n.id===nodeId);if(!node)throw new RoomMemoryValidationError('Unknown room or selected node');
  const row=this.db.prepare('SELECT record FROM room_user_edits WHERE room_id=? AND node_id=? ORDER BY rowid DESC LIMIT 1').get(roomId,nodeId);const record=row?JSON.parse(String(row.record)):null;
  const clarification=record?.decision?.status==='clarify'&&record.expectedRevision===expectedRevision?{operationId:String(record.operationId),text:String(record.text),reply:String(record.decision.reply)}:null;
  return {observedLabel:node.label,clarification};
 }
 editSnapshot(roomId:string,nodeId:string,expectedRevision:number){
  const room=this.read().rooms.find(r=>r.roomId===roomId);if(!room?.graph.nodes.some(n=>n.id===nodeId))throw new RoomMemoryValidationError('Unknown room or selected node');
  const state=this.userEdit(roomId,nodeId);if(state.revision!==expectedRevision)throw new RoomMemoryConflictError('Memory changed; refresh before editing');return state;
 }
 saveUserClarification(input:unknown,decision:RoomEditDecision){
  const parsed=RoomEditMessageSchema.safeParse(input),result=RoomEditDecisionSchema.safeParse(decision);if(!parsed.success||!result.success||result.data.status!=='clarify')throw new RoomMemoryValidationError('Invalid clarification');const p=parsed.data,d=result.data;
  this.write(p.operationId,{...p,decision:d},()=>{const state=this.editSnapshot(p.roomId,p.nodeId,p.expectedRevision);this.db.prepare('INSERT INTO room_user_edits VALUES(?,?,?,?)').run(p.operationId,p.roomId,p.nodeId,JSON.stringify({...p,decision:d,before:state,after:state}));});return this.read();
 }
 applyUserEdit(input:unknown,decision:RoomEditDecision){
  const parsed=RoomEditMessageSchema.safeParse(input),result=RoomEditDecisionSchema.safeParse(decision);if(!parsed.success||!result.success||result.data.status!=='apply')throw new RoomMemoryValidationError('Invalid user edit');const p=parsed.data,d=result.data;
  this.write(p.operationId,{...p,decision:d},()=>{
   const before=this.editSnapshot(p.roomId,p.nodeId,p.expectedRevision),context=this.editContext(p.roomId,p.nodeId,p.expectedRevision);if(d.changes.some(change=>!p.text.includes(change.value)&&!context.clarification?.text.includes(change.value)))throw new RoomMemoryValidationError('Edit values must occur exactly in the original message');const after:RoomUserEdit={...before,groups:[...before.groups],tags:[...before.tags],revision:before.revision+1,lastRevisionId:p.operationId};
   for(const change of d.changes){if(change.kind==='name'){after.name=change.value;continue;}const key=change.kind.endsWith('Group')?'groups':'tags',items=after[key],index=items.indexOf(change.value);if(change.kind.startsWith('add')){if(index<0)items.push(change.value);}else{if(index<0)throw new RoomMemoryValidationError('Cannot remove a group or tag that is not present');items.splice(index,1);}}
   if(after.name===before.name&&JSON.stringify(after.groups)===JSON.stringify(before.groups)&&JSON.stringify(after.tags)===JSON.stringify(before.tags))throw new RoomMemoryValidationError('No change to save');
   this.db.prepare('INSERT INTO room_user_edits VALUES(?,?,?,?)').run(p.operationId,p.roomId,p.nodeId,JSON.stringify({...p,decision:d,before,after,clarificationId:context.clarification?.operationId??null}));
  });return this.read();
 }
 undoUserEdit(input:unknown){
  const parsed=RoomEditUndoSchema.safeParse(input);if(!parsed.success)throw new RoomMemoryValidationError('Invalid edit undo');const p=parsed.data;
  this.write(p.operationId,p,()=>{const current=this.editSnapshot(p.roomId,p.nodeId,p.expectedRevision);if(current.lastRevisionId!==p.revisionId)throw new RoomMemoryConflictError('Only the latest edit can be undone');
   const row=this.db.prepare('SELECT record FROM room_user_edits WHERE operation_id=? AND room_id=? AND node_id=?').get(p.revisionId,p.roomId,p.nodeId);if(!row)throw new RoomMemoryValidationError('Unknown edit');const record=JSON.parse(String(row.record)) as {before:RoomUserEdit;undo?:boolean};if(record.undo)throw new RoomMemoryConflictError('Undo cannot be undone');
   const after={...record.before,revision:current.revision+1};this.db.prepare('INSERT INTO room_user_edits VALUES(?,?,?,?)').run(p.operationId,p.roomId,p.nodeId,JSON.stringify({operationId:p.operationId,before:current,after,undo:true}));
  });return this.read();
 }
 asset(sourceHash:string):Buffer|null{if(!/^[a-f0-9]{64}$/.test(sourceHash))return null;const rooms=this.read().rooms;if(!rooms.some(r=>[...r.graph.sourceViews,...r.visits.flatMap(v=>v.sourceViews),...(r.observations??[]).map(o=>o.source)].some(s=>s.sourceHash===sourceHash)))return null;const bytes=this.captures.asset(sourceHash);if(!bytes||hash(bytes)!==sourceHash)throw new RoomMemoryValidationError('Room source is missing or changed');return bytes;}
 containment(input:unknown,undo=false){
  const id=z.string().min(1).max(200),base={operationId:id,roomId:id,expectedRevision:z.number().int().nonnegative()};
  const parsed=(undo?z.strictObject({...base,targetOperationId:id}):z.strictObject({...base,itemId:id,containerId:id,action:z.enum(['put-in','remove','reject']),statement:z.string().trim().min(1).max(2000)})).safeParse(input);
  if(!parsed.success)throw new RoomMemoryValidationError('Invalid containment request');
  const p=parsed.data,request=canonical(p);this.db.exec('BEGIN IMMEDIATE');
  try{const prior=this.db.prepare('SELECT request FROM room_containment_ops WHERE operation_id=?').get(p.operationId);if(prior){if(prior.request!==request)throw new RoomMemoryConflictError('Operation ID collision');this.db.exec('COMMIT');return this.read();}
   const room=this.read().rooms.find(r=>r.roomId===p.roomId);if(!room)throw new RoomMemoryValidationError('Unknown room');const state=room.containment!;
   if(state.revision!==p.expectedRevision)throw new RoomMemoryConflictError('Containment changed; refresh');
   let record:unknown;
   if('targetOperationId' in p){const target=state.events.find(e=>e.operationId===p.targetOperationId);if(!target||target.withdrawn)throw new RoomMemoryValidationError('Unknown or already undone event');
    const active=new Map<string,string>();for(const e of state.events){if(e.withdrawn||e.invalidated||e.operationId===p.targetOperationId)continue;if(e.action==='remove'||e.action==='reject'||e.action==='outside'){if(active.get(e.itemId)===e.containerId)active.delete(e.itemId);continue;}let next:string|undefined=e.containerId;const seen=new Set<string>();while(next){if(next===e.itemId||seen.has(next))throw new RoomMemoryConflictError('Undo would create a containment cycle');seen.add(next);next=active.get(next);}active.set(e.itemId,e.containerId);}record={type:'undo',targetOperationId:p.targetOperationId};}
   else {const item=room.graph.nodes.find(n=>n.id===p.itemId),container=room.graph.nodes.find(n=>n.id===p.containerId);if(!item||!container||!['portable','container','contents_group'].includes(item.kind)||container.kind!=='container'||item.id===container.id)throw new RoomMemoryValidationError('Invalid item or container');
    const last=roomLastObservation(room,item),containerLast=roomLastObservation(room,container);if(!last||!containerLast)throw new RoomMemoryValidationError('Item and container require saved source evidence');
    const active=state.active.find(e=>e.itemId===item.id);if((p.action==='remove'||p.action==='reject')&&active?.containerId!==container.id)throw new RoomMemoryValidationError('Item is not recorded in this container');if(p.action==='reject'&&active?.attribution!=='model')throw new RoomMemoryValidationError('Only a visual suggestion can be rejected');
    let next:string|undefined=container.id;const visited=new Set<string>();while(next){if(next===item.id)throw new RoomMemoryValidationError('Containment cycle');if(visited.has(next))throw new RoomMemoryValidationError('Containment cycle');visited.add(next);next=state.active.find(e=>e.itemId===next)?.containerId;}
    record={...p,attribution:'user',recordedAt:new Date().toISOString(),source:last.source};
   }
   this.db.prepare('INSERT INTO room_containment_ops VALUES(?,?,?,?)').run(p.operationId,p.roomId,request,JSON.stringify(record));this.db.exec('COMMIT');return this.read();
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 private containmentProjection(room:RoomMemory){
  const rows=this.db.prepare('SELECT record FROM room_containment_ops WHERE room_id=? ORDER BY rowid').all(room.roomId).map(r=>JSON.parse(String(r.record)));
  const undone=new Set(rows.filter(r=>r.type==='undo').map(r=>r.targetOperationId));const events=rows.filter(r=>r.type!=='undo').map(r=>({...r,withdrawn:undone.has(r.operationId)}));
  for(const e of events)if(e.attribution==='model')e.invalidated=roomContinuityExclusions(room,e.itemId).sourceHashes.has(e.source.sourceHash)||roomContinuityExclusions(room,e.containerId).sourceHashes.has(e.source.sourceHash);
  const active=new Map<string,(typeof events)[number]>();for(const e of events){if(e.withdrawn)continue;if(e.attribution==='model'&&(roomContinuityExclusions(room,e.itemId).sourceHashes.has(e.source.sourceHash)||roomContinuityExclusions(room,e.containerId).sourceHashes.has(e.source.sourceHash)))continue;if(e.action==='put-in')active.set(e.itemId,e);else if(active.get(e.itemId)?.containerId===e.containerId)active.delete(e.itemId);}
  return {revision:rows.length,events,active:[...active.values()].map(e=>{const node=room.graph.nodes.find(n=>n.id===e.containerId),last=node&&roomLastObservation(room,node);return {...e,containerLabel:node?roomNodeLabel(room,node):e.containerId,containerLastSeen:last?{location:last.evidence.location??null,capturedAt:last.source.capturedAt,source:last.source,identityMatch:last.proposal||last.continuityLink?'probable' as const:null}:null};})};
 }
 read():RoomMemoryResponse{return {rooms:this.db.prepare('SELECT record FROM room_records ORDER BY rowid').all().map(row=>{
  const p=RoomInitialImportSchema.parse(JSON.parse(String(row.record)));this.validateGraph(p.graph);
  const correctionProjection=this.correctionProjection(p.roomId);
  const extensions=this.db.prepare('SELECT job_id,record FROM room_observer_extensions WHERE room_id=? ORDER BY rowid').all(p.roomId).map(r=>({jobId:String(r.job_id),...z.strictObject({support:z.array(z.strictObject({itemId:z.string(),supportId:z.string(),statement:z.string().min(1).max(2000)})).max(16).optional(),source:RoomSourceSchema,nodes:z.array(RoomGraphSchema.shape.nodes.element).max(16),provenance:z.enum(['agent-derived','authored-test']),semantic:z.array(z.strictObject({nodeId:z.string(),description:z.string().min(1).max(2000),evidence:z.array(z.strictObject({viewId:z.string(),basis:z.string()})).min(1)})).max(16)}).parse(JSON.parse(String(r.record)))}));
  const originalNodes=[...p.graph.nodes,...extensions.flatMap(e=>e.nodes)],nodeAnchorEvidence=Object.fromEntries(originalNodes.map(n=>[n.id,n.evidence.map(e=>({...e}))]));
  const graph={...p.graph,nodeAnchorEvidence,nodes:originalNodes,sourceViews:[...p.graph.sourceViews,...extensions.map(e=>e.source)]};
  const ids=new Set(graph.nodes.map(n=>n.id)),views=new Set(graph.sourceViews.map(s=>s.viewId));
  if(ids.size!==graph.nodes.length||views.size!==graph.sourceViews.length)throw new RoomMemoryValidationError('Duplicate automated graph reference');this.evidence(graph.nodes,views);
  const visits=this.db.prepare('SELECT record FROM room_visits WHERE room_id=? ORDER BY rowid').all(p.roomId).map(row=>{const v=RoomVisitImportSchema.parse(JSON.parse(String(row.record)));return {...v,sourceViews:this.sources(v.sourceViews),provenance:extensions.find(e=>v.importId===`auto-import-${e.jobId}`)?.provenance??'agent-derived' as const};});
  const observations=this.observations(p.roomId),graphHypotheses=this.db.prepare('SELECT record FROM room_graph_hypotheses WHERE room_id=? ORDER BY rowid').all(p.roomId).map(row=>JSON.parse(String(row.record)) as RoomObservationGraphHypothesis),continuityDecisions=this.continuityDecisions(p.roomId);
  // Materialize separated entries before applying later semantic updates to them.
  const room:RoomMemory=applyRoomContinuityCorrections({roomId:p.roomId,label:p.label,provenance:'agent-derived',...(observations.length?{observations}:{}),...correctionProjection,...(graphHypotheses.length?{graphHypotheses}:{}),continuityLinks:projectRoomContinuity(continuityDecisions),continuityEvaluatedObservationIds:continuityDecisions.map(decision=>decision.observationId),graph:{...graph,sourceViews:this.sources(graph.sourceViews)},visits,semanticRevisions:this.db.prepare('SELECT * FROM room_semantic_revisions WHERE room_id=? ORDER BY rowid').all(p.roomId).map(r=>({revisionId:String(r.revision_id),roomId:p.roomId,nodeId:String(r.node_id),label:String(r.label),createdAt:String(r.created_at),attribution:'user',withdrawn:!!r.withdrawn}))});
  for(const extension of extensions)for(const semantic of extension.semantic){
   if(semantic.evidence.some(evidence=>evidence.viewId!==extension.source.viewId))throw new RoomMemoryValidationError('Invalid semantic extension reference');
   if(roomContinuityExclusions(room,semantic.nodeId).sourceHashes.has(extension.source.sourceHash))continue;
   const node=room.graph.nodes.find(node=>node.id===semantic.nodeId);if(!node)throw new RoomMemoryValidationError('Invalid semantic extension reference');
   node.semantic={status:'unknown',description:semantic.description};node.evidence.push(...semantic.evidence);
  }
  const supportEvidence=extensions.flatMap(extension=>(extension.support??[]).map(relation=>{
   const item=room.graph.nodes.find(node=>node.id===relation.itemId),support=room.graph.nodes.find(node=>node.id===relation.supportId);
   if(!item||!support||support.kind!=='support')throw new RoomMemoryValidationError('Invalid support extension reference');
   return {...relation,attribution:'model' as const,source:this.sources([extension.source])[0],invalidated:[relation.itemId,relation.supportId].some(nodeId=>roomContinuityExclusions(room,nodeId).sourceHashes.has(extension.source.sourceHash)||room.continuityLinks?.some(link=>link.nodeId===nodeId&&link.source.sourceHash===extension.source.sourceHash&&link.state==='withdrawn'))};
  }));
  if(supportEvidence.length)room.supportEvidence=supportEvidence;
  room.userEdits=room.graph.nodes.map(node=>this.userEdit(p.roomId,node.id)).filter(edit=>edit.revision>0);
  room.containment=this.containmentProjection(room);
  return room;
 })};}
}
