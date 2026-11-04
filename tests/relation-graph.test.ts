import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {buildPlaceMemory,type Place,type PlaceVisit} from '../src/domain/place-memory.ts';
import {buildRelationGraph,answerRelations,relationTerms,observationId} from '../src/domain/relation-graph.ts';
import {activeRelationReviews,type RegionReview,type RelationReview} from '../src/domain/relation-contracts.ts';
import {RelationStore} from '../src/server/relation-store.ts';
import {PlaceStore} from '../src/server/place-store.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/app.ts';
import {digest} from '../src/server/sam-crops.ts';
const object=(label:string,color:string)=>({label,appearance:`${color} body`,locationDescription:'bench top',uncertainty:'clear',bbox:null});
const drill=()=>object('power drill','blue and black'),red=()=>object('screwdriver','red');
function view(place:Place,n:number,objects:ReturnType<typeof object>[],checked=true):PlaceVisit{
 const frame={id:randomUUID(),capturedAt:`2026-10-27T10:0${n}:00Z`,zone:'bench' as const,source:'virtual-camera' as const,width:200,height:120,imageHash:digest(`image-${n}`),imageUrl:`/source-${n}`,referenceView:'workshop-v2-bench' as const};
 return {frame,run:checked?{id:randomUUID(),frameId:frame.id,mode:'replay',provenance:'authored_fixture',model:'authored',createdAt:frame.capturedAt,latencyMs:0,usage:{},observations:{summary:'Authored test only',objects}}:null};
}
const place=():Place=>({id:randomUUID(),name:'Authored room',source:'authored_fixture',createdAt:'2026-10-27T10:00:00Z'});
function review(p:Place,v:PlaceVisit,index:number,left=10):RegionReview{return {id:digest(`${v.frame.id}:${index}:${left}`),action:'assert',placeId:p.id,reviewer:'agent',createdAt:'2026-10-28T00:00:00Z',note:'Authored test review',frameId:v.frame.id,runId:v.run!.id,index,imageHash:v.frame.imageHash,surfaceKey:'bench',surfaceLabel:'Long workbench',bounds:{left,top:20,right:left+20,bottom:50},regionMethod:'agent-reviewed-box'};}
test('relations answer from the latest linked frame and only same-frame reviewed neighbors',()=>{
 const p=place(),first=view(p,1,[drill(),red()]),second=view(p,2,[drill(),red()]);
 const reviews=[review(p,first,0),review(p,first,1,35),review(p,second,0,60),review(p,second,1,85)];
 const memory=buildPlaceMemory(p,[first,second]),graph=buildRelationGraph(memory,reviews),answer=answerRelations(memory,graph,'Mavi matkap en son neredeydi, yanında ne vardı?',4);
 assert.equal(answer.ambiguity,false);assert.equal(answer.answers[0].last.frameId,second.frame.id);assert.equal(answer.answers[0].surface!.label,'Long workbench');
 assert.equal(answer.language,'en');assert.equal(answer.answers[0].neighbors[0].label,'screwdriver (red body)');assert.match(answer.answers[0].text,/visit 2/);assert.match(answer.answers[0].warning,/image-relative/);
 const neighbor=graph.observations[answer.answers[0].neighbors[0].observationId];assert.equal(neighbor.frameId,second.frame.id);
 assert.deepEqual(answer.frameDimensions[second.frame.id],{width:200,height:120});
});
test('no region, other surface or distant pixels cannot become a nearby physical object claim',()=>{
 const p=place(),v=view(p,1,[drill(),red()]),memory=buildPlaceMemory(p,[v]);
 for(const reviews of [[],[review(p,v,0),{...review(p,v,1,35),surfaceKey:'other-bench'}],[review(p,v,0),review(p,v,1,170)]]){
  const graph=buildRelationGraph(memory,reviews);assert.equal(graph.edges.filter(e=>e.predicate==='near_in_image').length,0);assert.equal(graph.edges.filter(e=>e.predicate==='co_visible').length,2);
 }
});
test('neighbors from an earlier frame are not carried into a later last-seen answer',()=>{
 const p=place(),a=view(p,1,[drill(),red()]),b=view(p,2,[drill()]),memory=buildPlaceMemory(p,[a,b]);
 const graph=buildRelationGraph(memory,[review(p,a,0),review(p,a,1,35),review(p,b,0)]),answer=answerRelations(memory,graph,'matkap',3).answers[0];
 assert.equal(answer.last.visit,2);assert.equal(answer.neighbors.length,0);assert.equal(answer.coVisible.length,0);
});
test('unseen and unchecked views preserve earlier evidence without asserting current location',()=>{
 const p=place(),a=view(p,1,[drill(),red()]),b=view(p,2,[red()]),c=view(p,3,[drill()],false),memory=buildPlaceMemory(p,[a,b,c]);
 const answer=answerRelations(memory,buildRelationGraph(memory,[review(p,a,0),review(p,a,1,35)]),'matkap',2).answers[0];
 assert.equal(answer.last.visit,1);assert.equal(answer.status,'unchecked');assert.match(answer.warning,/has not been reviewed/);
});
test('similar yellow appearances remain separate and later unresolved sightings never become a confirmed history',()=>{
 const p=place(),a=view(p,1,[object('power drill','yellow and black'),object('power drill','yellow and black')]),b=view(p,2,[object('drill','yellow and black')]);
 const memory=buildPlaceMemory(p,[a,b]),answer=answerRelations(memory,buildRelationGraph(memory,[review(p,a,0),review(p,a,1,35),review(p,b,0)]),'matkap en son neredeydi yanında ne vardı',3);
 assert.equal(answer.ambiguity,true);assert.equal(answer.answers.length,2);assert.ok(answer.answers.every(a=>a.last.visit===1&&a.possibleLater.length===1));assert.ok(memory.items.every(i=>i.history.length===1));
 const selected=answerRelations(memory,answer.graph,'matkap',3,answer.answers[0].candidateId);assert.equal(selected.answers.length,1);assert.match(selected.answers[0].warning,/remain unlinked/);
});
test('historical/source/hash context rejects unsupported reviews without changing the matcher projection',()=>{
 const p=place(),a=view(p,1,[drill()]),b=view(p,2,[drill(),red()]),full=buildPlaceMemory(p,[a,b]),past=buildPlaceMemory(p,[a]);
 const reviews=[review(p,b,0),{...review(p,a,0),imageHash:digest('wrong')}];
 assert.equal(buildRelationGraph(past,reviews).edges.filter(e=>e.predicate==='observed_on').length,0);
 const before=JSON.stringify(full);buildRelationGraph(full,reviews);assert.equal(JSON.stringify(full),before);
});
test('question parsing is bounded and candidate selection cannot escape its question or place',()=>{
 assert.equal(relationTerms('Where was the drill last seen, and what was nearby?'),'drill');assert.equal(relationTerms('Mavi matkap en son neredeydi, yanında ne vardı?'),'blue drill');assert.equal(relationTerms('Where was my drill last seen and what was next to it?'),'drill');
 const p=place(),v=view(p,1,[drill(),red()]),memory=buildPlaceMemory(p,[v]),graph=buildRelationGraph(memory,[]);
 assert.throws(()=>answerRelations(memory,graph,'matkap',0,'foreign-candidate'),/does not match/);assert.throws(()=>answerRelations(memory,graph,'neredeydi?',0),/item name/);
});

function persisted(){
 const directory=mkdtempSync(join(tmpdir(),'relation-proof-')),frames=new Store(directory),places=new PlaceStore(directory),relations=new RelationStore(directory),p=places.create('Authored persistence','authored_fixture');
 const png=new PNG({width:200,height:120});png.data.fill(255);const bytes=PNG.sync.write(png),frame=frames.saveFrame({frameId:randomUUID(),capturedAt:'2026-10-27T10:00:00Z',zone:'bench',source:'virtual-camera',referenceView:'workshop-v2-bench',width:200,height:120,imageDataUrl:`data:image/png;base64,${bytes.toString('base64')}`});places.append(p.id,frame);
 const run=frames.saveRun({id:randomUUID(),frameId:frame.id,mode:'replay',provenance:'authored_fixture',model:'authored-relation-test',createdAt:frame.capturedAt,latencyMs:0,usage:{},observations:{summary:'Authored tests only',objects:[drill(),red()]}});
 const visit:PlaceVisit={frame,run},reviews=[review(p,visit,0),review(p,visit,1,35)];
 return {directory,frames,places,relations,p,visit,reviews,close(){relations.close();places.close();frames.close();},remove(){rmSync(directory,{recursive:true,force:true});}};
}
test('review log is immutable/idempotent and retraction invalidates dependent on/near answers with replay',()=>{
 const f=persisted();try{
  const [a,b]=f.reviews;assert.equal(f.relations.append(a,f.frames,f.places),1);assert.equal(f.relations.append(a,f.frames,f.places),1);f.relations.append(b,f.frames,f.places);
  assert.throws(()=>f.relations.append({...a,note:'overwrite'},f.frames,f.places),/Immutable/);
  const memory=buildPlaceMemory(f.p,[f.visit]);
  const build=(rev?:number)=>buildRelationGraph(memory,activeRelationReviews(f.relations.events(f.p.id,rev)));
  assert.equal(answerRelations(memory,build(),'matkap',2).answers[0].neighbors.length,1);
  const retract:RelationReview={id:digest('withdraw'),action:'retract',targetId:a.id,placeId:f.p.id,reviewer:'agent',createdAt:'2026-10-28T00:02:00Z',note:'Authored correction'};
  f.relations.append(retract,f.frames,f.places);const latest=answerRelations(memory,build(),'matkap',3).answers[0];assert.equal(latest.surface,null);assert.equal(latest.neighbors.length,0);assert.doesNotMatch(latest.text,/Long workbench/);
  assert.equal(answerRelations(memory,build(2),'matkap',2).answers[0].surface!.label,'Long workbench');assert.equal(f.relations.events(f.p.id).length,3);
 }finally{f.close();f.remove();}
});
test('invalid provenance, cross-place updates, bad regions and silent replacement are rejected',()=>{
 const f=persisted();try{
  const a=f.reviews[0];
  for(const value of [{...a,id:digest('hash'),imageHash:digest('wrong')},{...a,id:digest('run'),runId:randomUUID()},{...a,id:digest('place'),placeId:randomUUID()}])assert.throws(()=>f.relations.append(value,f.frames,f.places),/place|pixels/);
  assert.throws(()=>f.relations.append({...a,id:digest('bounds'),bounds:{left:0,top:0,right:201,bottom:50}},f.frames,f.places),/exceeds/);
  f.relations.append(a,f.frames,f.places);assert.throws(()=>f.relations.append({...a,id:digest('silent')},f.frames,f.places),/explicit replacement/);
  const replacement={...a,id:digest('replacement'),supersedes:a.id,surfaceLabel:'Revised bench label'};f.relations.append(replacement,f.frames,f.places);
  assert.equal(activeRelationReviews(f.relations.events(f.p.id))[0].surfaceLabel,'Revised bench label');assert.equal(activeRelationReviews(f.relations.events(f.p.id,1))[0].surfaceLabel,'Long workbench');
 }finally{f.close();f.remove();}
});
test('HTTP answers persist across restart, reject mutation, preserve old projections and expose revision views',async()=>{
 const f=persisted();f.reviews.forEach(r=>f.relations.append(r,f.frames,f.places));const placeId=f.p.id;f.close();let calls=0;
 const options={readOnly:true,meta:{count:async()=>{calls++;throw new Error('No network');},generate:async()=>{calls++;throw new Error('No network');}}};let app=createApp(f.directory,options);
 try{
  const memoryPath=`/api/places/${placeId}/memory`,before=(await app.inject(memoryPath)).body,path=`/api/places/${placeId}/relations?q=${encodeURIComponent('matkap en son neredeydi yanında ne vardı')}`;
  const response=await app.inject(path);assert.equal(response.statusCode,200);const value=response.json();assert.equal(value.answers[0].surface.label,'Long workbench');assert.equal(value.answers[0].last.imageUrl,(await app.inject('/api/frames')).json()[0].imageUrl);
  const old=(await app.inject(path+'&revision=0')).json();assert.equal(old.answers[0].surface,null);assert.equal(old.answers[0].neighbors.length,0);
  assert.equal((await app.inject(path+'&revision=99')).statusCode,400);assert.equal((await app.inject(path+'&candidate=foreign')).statusCode,400);assert.equal((await app.inject(path+'&through=4')).statusCode,400);
  const frameId=value.answers[0].last.frameId;assert.equal((await app.inject({method:'POST',url:`/api/frames/${frameId}/observe`,payload:{mode:'live'}})).statusCode,403);assert.equal(calls,0);
  assert.equal((await app.inject(memoryPath)).body,before);await app.close();app=createApp(f.directory,options);assert.equal((await app.inject(path)).body,response.body);
 }finally{await app.close();f.remove();}
});
