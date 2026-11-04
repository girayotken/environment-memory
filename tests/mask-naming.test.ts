import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PNG} from 'pngjs';
import {foregroundColor,nameSameImageMasks,type MaskColorProfile} from '../src/domain/mask-naming.ts';
import {extractAutomaticRelations,type SamMask} from '../src/domain/automatic-relations.ts';
import {buildPlaceMemory,type Place,type PlaceVisit} from '../src/domain/place-memory.ts';
import type {VisualBundle} from '../src/domain/visual-evidence.ts';
import {digest} from '../src/server/sam-crops.ts';
import {VisualStore} from '../src/server/visual-store.ts';
import {Store} from '../src/server/store.ts';
import {PlaceStore} from '../src/server/place-store.ts';
import {createApp} from '../src/server/app.ts';
const object=(color='blue',label='corded tool',location='right-center of bench top',uncertainty='clear, type uncertain')=>({label,appearance:`${color} and black body`,locationDescription:location,uncertainty,bbox:null});
function fixture(objects=[object()]){
 const p:Place={id:randomUUID(),name:'Authored room',source:'authored_fixture',createdAt:'2026-10-28T00:00:00Z'};
 const frame={id:randomUUID(),capturedAt:'2026-10-28T10:00:00Z',zone:'bench' as const,source:'virtual-camera' as const,width:200,height:120,imageHash:digest('source'),imageUrl:'/source',referenceView:'workshop-v2-bench' as const};
 const v:PlaceVisit={frame,run:{id:randomUUID(),frameId:frame.id,mode:'replay',provenance:'authored_fixture',model:'authored',createdAt:frame.capturedAt,latencyMs:0,usage:{},observations:{summary:'Authored fixture only',objects}}};
 const b:VisualBundle={id:digest(frame.id),placeId:p.id,media:'image',model:'sam-3.1',concept:'drill',sourceSha256:frame.imageHash,recordsSha256:digest('record'),recordedAt:frame.capturedAt,width:200,height:120,pixelSource:'exact-saved-still',placeAssociation:'operator-declared',segments:[]};
 return {p,v,b,memory:buildPlaceMemory(p,[v])};
}
function mask(b:VisualBundle,id:string,x=120):SamMask{
 const pixels:number[]=[],boundary:[number,number][]=[];for(let y=20;y<28;y++)for(let i=x;i<x+8;i++){pixels.push(y*b.width+i);if(y===20||y===27||i===x||i===x+7)boundary.push([i,y]);}
 return {bundle:b,segment:{id:digest(id),trackId:id,frameIndex:0,sourceAsset:b.sourceSha256,cutoutAsset:digest('cutout'+id),contextAsset:digest('context'+id),bounds:{left:x,top:20,right:x+8,bottom:28},width:8,height:8,foregroundPixels:64},pixels,boundary};
}
const profile=(color='blue'):MaskColorProfile=>foregroundColor(Array.from({length:64},()=>color==='yellow'?[230,210,20,255]:[30,90,220,255]).flat());
test('foreground RGB excludes transparent background and demands enough chromatic evidence and separation',()=>{
 const pixels=[...Array.from({length:100},()=>[250,20,20,0]).flat(),...Array.from({length:6},()=>[30,90,220,255]).flat(),...Array.from({length:4},()=>[20,20,20,255]).flat()];
 const blue=foregroundColor(pixels);assert.equal(blue.dominant,'blue');assert.equal(blue.opaquePixels,10);assert.equal(blue.shares.red,0);
 assert.equal(foregroundColor([20,20,20,255]).dominant,null);assert.equal(foregroundColor([255,0,0,255,0,0,255,255]).dominant,null);assert.equal(foregroundColor([255,0,0,0]).dominant,null);
});
test('coarse class plus reciprocal unique color names the blue tool, never the blue storage bin or two yellow subtypes',()=>{
 const f=fixture([object('yellow','power drill','left side of bench top'),object('yellow','power driver','center-left of bench top'),object(),object('blue','storage bin','middle shelf')]);
 const masks=[mask(f.b,'0',50),mask(f.b,'1',80),mask(f.b,'2',120)],profiles=Object.fromEntries(masks.map((m,i)=>[m.segment.id,profile(i<2?'yellow':'blue')]));
 const result=nameSameImageMasks(f.memory,masks,profiles);assert.equal(result.counts.accepted,1);assert.equal(result.counts.ambiguous,2);assert.equal(result.links[0].index,2);assert.equal(result.links[0].association,'automatic-same-image');
 assert.ok(result.decisions.filter(d=>d.color?.dominant==='yellow').every(d=>d.acceptedObservationId===null&&d.candidates.length===2));
});
test('same-color observations remain unresolved even when position could choose a forced permutation',()=>{
 const f=fixture([object('yellow','power drill','left side of bench top'),object('yellow','power driver','right side of bench top')]);
 for(const positions of [[5,180],[180,5]]){
  const masks=positions.map((x,i)=>mask(f.b,String(i),x)),profiles=Object.fromEntries(masks.map(m=>[m.segment.id,profile('yellow')]));const r=nameSameImageMasks(f.memory,masks,profiles);
  assert.equal(r.links.length,0);assert.equal(r.counts.ambiguous,2);
 }
});
test('two similarly colored masks cannot claim the same observation, including duplicate/overlapping regions',()=>{
 const f=fixture(),a=mask(f.b,'0'),b=mask(f.b,'1',150);
 const result=nameSameImageMasks(f.memory,[a,b],{[a.segment.id]:profile(),[b.segment.id]:profile()});assert.equal(result.links.length,0);assert.equal(result.counts.ambiguous,2);
 const overlap={...a,segment:{...a.segment,id:digest('overlap')}};assert.equal(nameSameImageMasks(f.memory,[a,overlap],{[a.segment.id]:profile(),[overlap.segment.id]:profile('yellow')}).links.length,0);
 assert.equal(nameSameImageMasks(f.memory,[a,a],{[a.segment.id]:profile()}).links.length,0);
});
test('color uncertainty and multiple chromatic caption terms block naming while uncertain subtype is retained',()=>{
 for(const [appearance,uncertainty,expected] of [['blue body','color uncertain',0],['blue and yellow body','clear',0],['blue body','tip type uncertain',1]] as const){
  const f=fixture([{...object(),appearance,uncertainty}]),m=mask(f.b,'0');assert.equal(nameSameImageMasks(f.memory,[m],{[m.segment.id]:profile()}).links.length,expected);
 }
});
test('extreme location contradiction can veto a unique association but never positively supplies a name',()=>{
 const f=fixture([object('blue','corded tool','left side of bench top')]),m=mask(f.b,'0',180),result=nameSameImageMasks(f.memory,[m],{[m.segment.id]:profile()});assert.equal(result.links.length,0);assert.equal(result.counts.conflicts,1);
 assert.equal(nameSameImageMasks(f.memory,[m],{[m.segment.id]:{...profile(),dominant:null}}).links.length,0);
});
test('wrong source/place/dimensions/region/frame and unprojected runs cannot produce names',()=>{
 const f=fixture(),m=mask(f.b,'0'),profiles={[m.segment.id]:profile()};
 const variants=[{...m,bundle:{...f.b,placeId:randomUUID()}},{...m,bundle:{...f.b,sourceSha256:digest('wrong')}},{...m,bundle:{...f.b,width:201}},{...m,segment:{...m.segment,sourceAsset:digest('wrong')}},{...m,segment:{...m.segment,frameIndex:1}},{...m,segment:{...m.segment,bounds:{...m.segment.bounds,right:201}}}];
 for(const candidate of variants)assert.equal(nameSameImageMasks(f.memory,[candidate],profiles).links.length,0);
 assert.equal(nameSameImageMasks(buildPlaceMemory(f.p,[{...f.v,run:null}]),[m],profiles).links.length,0);
 const wrongRun={...f.v,run:{...f.v.run!,frameId:randomUUID()}};assert.equal(nameSameImageMasks(buildPlaceMemory(f.p,[wrongRun]),[m],profiles).links.length,0);
});
test('independent video and duplicate source-pixel visits cannot borrow model names',()=>{
 const f=fixture(),m=mask(f.b,'0'),profiles={[m.segment.id]:profile()};
 assert.equal(nameSameImageMasks(f.memory,[{...m,bundle:{...f.b,media:'video',pixelSource:'decoded-uploaded-video'}}],profiles).links.length,0);
 const second={frame:{...f.v.frame,id:randomUUID(),capturedAt:'2026-10-28T10:01:00Z'},run:{...f.v.run!,id:randomUUID()}};second.run.frameId=second.frame.id;
 assert.equal(nameSameImageMasks(buildPlaceMemory(f.p,[f.v,second]),[m],profiles).links.length,0);
});
test('group, container and unsupported concept descriptions do not supply unique tool names',()=>{
 for(const label of ['several blue drills','drill case','storage bin','parts tray']){
  const f=fixture([object('blue',label)]),m=mask(f.b,'0');assert.equal(nameSameImageMasks(f.memory,[m],{[m.segment.id]:profile()}).links.length,0,label);
 }
 const f=fixture(),m=mask({...f.b,concept:'anything'},'0');assert.equal(nameSameImageMasks(f.memory,[m],{[m.segment.id]:profile()}).links.length,0);
});
test('array order and SAM track numbers do not decide names; no matcher history or evidence is mutated',()=>{
 const f=fixture([object(),object('yellow','power drill','left side')]),a=mask(f.b,'0'),b=mask(f.b,'1',50),profiles={[a.segment.id]:profile(),[b.segment.id]:profile('yellow')},before=JSON.stringify(f.memory);
 const first=nameSameImageMasks(f.memory,[a,b],profiles),reverse=nameSameImageMasks(f.memory,[b,a],profiles);assert.deepEqual(first,reverse);
 const renumber=nameSameImageMasks(f.memory,[{...a,segment:{...a.segment,trackId:'927'}},{...b,segment:{...b.segment,trackId:'593'}}],profiles);assert.deepEqual(first,renumber);assert.equal(JSON.stringify(f.memory),before);
 const relations=extractAutomaticRelations(f.memory,[a,b],first.links);assert.equal(relations.counts.namedMasks,2);assert.equal(JSON.stringify(f.memory),before);
});
test('a naming association contains exact mask/run ancestry and is not a reviewed visual link',()=>{
 const f=fixture(),m=mask(f.b,'0'),r=nameSameImageMasks(f.memory,[m],{[m.segment.id]:profile()}),d=r.decisions[0];
 assert.equal(d.status,'accepted');assert.ok(d.dependsOn.includes(f.v.run!.id)&&d.dependsOn.includes(m.segment.cutoutAsset));assert.equal(r.links[0].frameId,f.v.frame.id);assert.notEqual(r.links[0].association,'reviewed-same-image');
 assert.equal(extractAutomaticRelations(f.memory,[m],r.links).regions[d.acceptedObservationId!].segmentId,m.segment.id);
});
test('HTTP automatic names require no prior agent links, never call a provider, and leave previous views exact',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'mask-naming-')),frames=new Store(directory),places=new PlaceStore(directory),visual=new VisualStore(directory),p=places.create('Authored room','authored_fixture');
 const source=new PNG({width:200,height:120});source.data.fill(255);const cutout=new PNG({width:8,height:8});
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){const color=Buffer.from([30,90,220,255]);color.copy(cutout.data,(y*8+x)*4);color.copy(source.data,((20+y)*200+120+x)*4);}
 const sourceBytes=PNG.sync.write(source),cutoutBytes=PNG.sync.write(cutout),frame=frames.saveFrame({frameId:randomUUID(),capturedAt:'2026-10-28T10:00:00Z',zone:'bench',source:'virtual-camera',width:200,height:120,referenceView:'workshop-v2-bench',imageDataUrl:'data:image/png;base64,'+sourceBytes.toString('base64')});places.append(p.id,frame);
 frames.saveRun({id:randomUUID(),frameId:frame.id,mode:'replay',provenance:'authored_fixture',model:'authored',createdAt:frame.capturedAt,latencyMs:0,usage:{},observations:{summary:'Authored only',objects:[object()]}});
 const b={...fixture().b,placeId:p.id,sourceSha256:frame.imageHash},m=mask(b,'0'),s={...m.segment,cutoutAsset:digest(cutoutBytes),contextAsset:digest(cutoutBytes),sourceAsset:digest(sourceBytes)};visual.saveBundle({...b,segments:[s]},new Map([[digest(sourceBytes),sourceBytes],[digest(cutoutBytes),cutoutBytes]]));visual.close();frames.close();places.close();
 let calls=0;const app=createApp(directory,{readOnly:true,meta:{count:async()=>{calls++;throw Error('No provider');},generate:async()=>{calls++;throw Error('No provider');}}});
 const path=`/api/places/${p.id}/automatic-relations`,memoryPath=`/api/places/${p.id}/memory`,before=(await app.inject(path)).body,memoryBefore=(await app.inject(memoryPath)).body,original=VisualStore.prototype.links;
 try{
  VisualStore.prototype.links=function(){throw Error('Prior names must not be read');};
  const r=await app.inject(path+'?naming=automatic-v1');assert.equal(r.statusCode,200);assert.equal(r.json().maskNaming.counts.accepted,1);assert.equal(r.json().automatic.counts.namedMasks,1);assert.equal(calls,0);
  assert.equal((await app.inject(path+'?naming=unknown')).statusCode,400);assert.equal((await app.inject({method:'POST',url:path,payload:{naming:'automatic-v1'}})).statusCode,403);
  VisualStore.prototype.links=original;assert.equal((await app.inject(path)).body,before);assert.equal((await app.inject(memoryPath)).body,memoryBefore);
 }finally{VisualStore.prototype.links=original;await app.close();rmSync(directory,{recursive:true,force:true});}
});
