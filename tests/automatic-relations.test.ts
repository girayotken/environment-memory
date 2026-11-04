import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PNG} from 'pngjs';
import {buildPlaceMemory,type Place,type PlaceVisit} from '../src/domain/place-memory.ts';
import {surfacePhrase,extractAutomaticRelations,answerAutomaticRelations,type SamMask} from '../src/domain/automatic-relations.ts';
import type {VisualBundle,VisualLink} from '../src/domain/visual-evidence.ts';
import {digest} from '../src/server/sam-crops.ts';
import {createApp} from '../src/server/app.ts';
import {Store} from '../src/server/store.ts';
import {PlaceStore} from '../src/server/place-store.ts';
const object=(color='blue',location='bench top')=>({label:'power drill',appearance:`${color} body`,locationDescription:location,uncertainty:'clear, tip uncertain',bbox:null});
const place=():Place=>({id:randomUUID(),name:'Authored room',source:'authored_fixture',createdAt:'2026-10-28T00:00:00Z'});
function visit(n:number,objects=[object()]):PlaceVisit{
 const frame={id:randomUUID(),capturedAt:`2026-10-28T10:0${n}:00Z`,zone:'bench' as const,source:'virtual-camera' as const,width:200,height:120,imageHash:digest(`image-${n}`),imageUrl:`/source-${n}`,referenceView:'workshop-v2-bench' as const};
 return {frame,run:{id:randomUUID(),frameId:frame.id,mode:'replay',model:'authored',provenance:'authored_fixture',createdAt:frame.capturedAt,latencyMs:0,usage:{},observations:{summary:'Authored only',objects}}};
}
function bundle(p:Place,v:PlaceVisit):VisualBundle{return {id:digest(v.frame.id),placeId:p.id,media:'image',model:'sam-3.1',concept:'tool',sourceSha256:v.frame.imageHash,recordsSha256:digest('authored mask record'),recordedAt:v.frame.capturedAt,width:200,height:120,pixelSource:'exact-saved-still',placeAssociation:'operator-declared',segments:[]};}
function mask(b:VisualBundle,x:number,id:string):SamMask{
 const pixels:number[]=[],boundary:[number,number][]=[];for(let y=20;y<28;y++)for(let i=x;i<x+8;i++){pixels.push(y*b.width+i);if(y===20||y===27||i===x||i===x+7)boundary.push([i,y]);}
 return {bundle:b,segment:{id:digest(id),trackId:id,frameIndex:0,sourceAsset:b.sourceSha256,cutoutAsset:digest('cutout'+id),contextAsset:digest('context'+id),bounds:{left:x,top:20,right:x+8,bottom:28},width:8,height:8,foregroundPixels:64},pixels,boundary};
}
function link(p:Place,v:PlaceVisit,m:SamMask,index:number):VisualLink{return {id:digest('link'+m.segment.id),placeId:p.id,bundleId:m.bundle.id,segmentId:m.segment.id,frameId:v.frame.id,runId:v.run!.id,index,association:'reviewed-same-image',note:'Authored prior agent mapping'};}
function fixture(){const p=place(),v=visit(1,[object(),object('red')]),b=bundle(p,v),masks=[mask(b,10,'0'),mask(b,24,'1')],links=masks.map((m,i)=>link(p,v,m,i)),memory=buildPlaceMemory(p,[v]);return {p,v,b,masks,links,memory};}
test('surface parser uses supported location phrases, abstains on negation/ambiguity and invents no long-bench anchor',()=>{
 assert.deepEqual(surfacePhrase('left side of bench top'),{key:'bench-top',label:'Workbench top'});
 assert.equal(surfacePhrase('middle shelf behind bench')?.key,'middle-shelf');assert.equal(surfacePhrase('top shelf left of rack')?.key,'top-shelf');
 for(const text of ['not on the bench','under bench top','near workbench','between benches','maybe on the table','bench top or middle shelf','unknown','left side'])assert.equal(surfacePhrase(text),null,text);
});
test('automatic surfaces preserve quotes/uncertainty and use frame-scoped referents without review inputs',()=>{
 const {p,v}=fixture(),next=visit(2,[object()]),memory=buildPlaceMemory(p,[v,next]);const result=extractAutomaticRelations(memory,[],[]);
 assert.equal(result.surfaces.length,3);assert.notEqual(result.surfaces.find(s=>s.frameId===v.frame.id)!.to,result.surfaces.find(s=>s.frameId===next.frame.id)!.to);
 assert.equal(result.surfaces[0].quote,'bench top');assert.equal(result.surfaces[0].uncertainty,'clear, tip uncertain');assert.equal(result.surfaces[0].status,'candidate');
 assert.ok(result.surfaces.every(s=>s.dependsOn.includes(s.runId)&&s.method==='saved-model-statement'));
});
test('named neighbors derive from alpha boundary distance with explicit prior-link ancestry',()=>{
 const f=fixture(),a=extractAutomaticRelations(f.memory,f.masks,f.links);assert.equal(a.namedNeighbors.length,1);assert.equal(a.maskNeighbors[0].distancePx,7);
 assert.ok(a.namedNeighbors[0].dependsOn.includes(f.links[0].id)&&a.namedNeighbors[0].dependsOn.includes(f.links[1].id));
 const answer=answerAutomaticRelations(f.memory,a,'mavi matkap').answers[0];assert.equal(answer.neighbors.length,1);assert.equal(answer.surface!.reviewId,null);assert.match(answer.text,/Surface candidate/);assert.match(answer.text,/SAM image-neighbor candidates/);
 assert.equal(answer.last.frameId,f.v.frame.id);assert.deepEqual(answer.region,f.masks[0].segment.bounds);
});
test('removing prior mask naming links leaves anonymous geometry, never automatic semantic association',()=>{
 const f=fixture(),a=extractAutomaticRelations(f.memory,f.masks,[]);assert.equal(a.maskNeighbors.length,1);assert.equal(a.namedNeighbors.length,0);
 assert.equal(answerAutomaticRelations(f.memory,a,'matkap').answers[0].neighbors.length,0);
});
test('foreign place/hash/run, duplicate mask associations and invalid region extents cannot name neighbors',()=>{
 const f=fixture();
 for(const links of [f.links.map(l=>({...l,runId:randomUUID()})),[...f.links,{...f.links[0],id:digest('duplicate')}],f.links.map(l=>({...l,placeId:randomUUID()}))])assert.equal(extractAutomaticRelations(f.memory,f.masks,links).namedNeighbors.length,0);
 for(const masks of [f.masks.map(m=>({...m,bundle:{...m.bundle,placeId:randomUUID()}})),f.masks.map(m=>({...m,bundle:{...m.bundle,sourceSha256:digest('foreign')}})),f.masks.map(m=>({...m,segment:{...m.segment,bounds:{...m.segment.bounds,right:201}}}))])assert.equal(extractAutomaticRelations(f.memory,masks,f.links).namedNeighbors.length,0);
});
test('same-image support is required, grouped records never supply individual regions or surfaces',()=>{
 const f=fixture(),future=visit(2,[object()]),memory=buildPlaceMemory(f.p,[f.v,future]);
 const altered=f.masks.map((m,i)=>i?{...m,segment:{...m.segment,sourceAsset:digest('different pixels')}}:m);
 assert.equal(extractAutomaticRelations(memory,altered,f.links).namedNeighbors.length,0);
 const grouped=visit(1,[{...object(),label:'several power drills'}]);assert.equal(extractAutomaticRelations(buildPlaceMemory(f.p,[grouped]),[],[]).surfaces.length,0);
});
test('overlapping and duplicate masks are rejected and overlapping boxes alone cannot create proximity',()=>{
 const f=fixture();const duplicate={...f.masks[0],segment:{...f.masks[0].segment,id:digest('dup')}};
 const overlap=extractAutomaticRelations(f.memory,[f.masks[0],duplicate],[]);assert.equal(overlap.maskNeighbors.length,0);assert.match(overlap.diagnostics[0].reason,/Overlapping/);
 const wide=(x:number,id:string):SamMask=>({...mask(f.b,10,id),segment:{...mask(f.b,10,id).segment,bounds:{left:0,top:0,right:190,bottom:110},width:190,height:110,foregroundPixels:1},pixels:[20*200+x],boundary:[[x,20]]});
 assert.equal(extractAutomaticRelations(f.memory,[wide(10,'2'),wide(170,'3')],[]).maskNeighbors.length,0);
});
test('video relations remain source/frame local and cannot borrow still names or surfaces',()=>{
 const f=fixture(),p={...f.p,source:'live' as const};const visits=[f.v,visit(2),visit(3)].map(v=>({...v,run:{...v.run!,mode:'live' as const,provenance:undefined}}));const memory=buildPlaceMemory(p,visits);
 const video={...f.b,id:digest('video'),media:'video' as const,sourceSha256:digest('mp4'),pixelSource:'decoded-uploaded-video' as const};
 const masks=f.masks.map(m=>({...m,bundle:video,segment:{...m.segment,sourceAsset:digest('decoded source')}}));
 const a=extractAutomaticRelations(memory,masks,f.links);assert.equal(a.maskNeighbors.length,1);assert.equal(a.namedNeighbors.length,0);
 assert.equal(extractAutomaticRelations(memory,[masks[0],{...masks[1],segment:{...masks[1].segment,frameIndex:1}}],[]).maskNeighbors.length,0);
 assert.equal(extractAutomaticRelations(buildPlaceMemory(p,visits.slice(0,1)),masks,[]).maskNeighbors.length,0);
});
test('last linked answer does not carry old neighbors forward or promote unresolved similar tools',()=>{
 const f=fixture(),later=visit(2,[object()]),memory=buildPlaceMemory(f.p,[f.v,later]);
 const a=extractAutomaticRelations(memory,f.masks,f.links),answer=answerAutomaticRelations(memory,a,'mavi matkap').answers[0];assert.equal(answer.last.visit,2);assert.equal(answer.neighbors.length,0);assert.equal(answer.region,null);
 const twins=visit(1,[object('yellow'),object('yellow')]),next=visit(2,[object('yellow')]),ambiguous=buildPlaceMemory(f.p,[twins,next]);const before=JSON.stringify(ambiguous),view=answerAutomaticRelations(ambiguous,extractAutomaticRelations(ambiguous,[],[]),'matkap');
 assert.equal(view.answers.length,2);assert.ok(view.answers.every(a=>a.last.visit===1&&a.possibleLater.length===1));assert.equal(JSON.stringify(ambiguous),before);
});
test('mask/observation ordering does not change extracted relation identities or geometry',()=>{
 const f=fixture(),a=extractAutomaticRelations(f.memory,f.masks,f.links),b=extractAutomaticRelations(f.memory,[...f.masks].reverse(),[...f.links].reverse());assert.deepEqual(a.maskNeighbors,b.maskNeighbors);assert.deepEqual(a.namedNeighbors,b.namedNeighbors);
});
test('HTTP automatic view is source-scoped, read-only, repeatable and never invokes a provider',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'auto-relations-')),frames=new Store(dir),places=new PlaceStore(dir),p=places.create('Authored room','authored_fixture');const png=new PNG({width:200,height:120});png.data.fill(255);
 const frame=frames.saveFrame({frameId:randomUUID(),capturedAt:'2026-10-28T10:00:00Z',zone:'bench',source:'virtual-camera',width:200,height:120,referenceView:'workshop-v2-bench',imageDataUrl:'data:image/png;base64,'+PNG.sync.write(png).toString('base64')});places.append(p.id,frame);
 frames.saveRun({id:randomUUID(),frameId:frame.id,mode:'replay',provenance:'authored_fixture',model:'authored',createdAt:frame.capturedAt,latencyMs:0,usage:{},observations:{summary:'Authored fixture only',objects:[object()]}});frames.close();places.close();let calls=0;
 const app=createApp(dir,{readOnly:true,meta:{count:async()=>{calls++;throw Error('No network');},generate:async()=>{calls++;throw Error('No network');}}});
 try{
  const memoryPath=`/api/places/${p.id}/memory`,reviewPath=`/api/places/${p.id}/relations`,path=`/api/places/${p.id}/automatic-relations?q=matkap`;
  const before=(await app.inject(memoryPath)).body,review=(await app.inject(reviewPath)).body,response=await app.inject(path);assert.equal(response.statusCode,200);assert.equal(response.json().automatic.counts.surfaceCandidates,1);assert.equal(response.json().answers[0].surface.reviewId,null);
  assert.equal((await app.inject(path)).body,response.body);assert.equal((await app.inject(path+'&through=4')).statusCode,400);assert.equal((await app.inject(path+'&candidate=foreign')).statusCode,400);assert.equal((await app.inject(path+'&revision=3')).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:`/api/frames/${frame.id}/observe`,payload:{mode:'live'}})).statusCode,403);assert.equal((await app.inject({method:'POST',url:path})).statusCode,403);assert.equal(calls,0);
  assert.equal((await app.inject(memoryPath)).body,before);assert.equal((await app.inject(reviewPath)).body,review);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
