import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {ScanStore} from '../src/server/scan-store.ts';
import {createScanReviewApp,type ScanReviewManifest} from '../src/server/scan-review.ts';
import type {ScanReviewView} from '../src/domain/scan-review-contracts.ts';
import {prepareScanReview} from '../scripts/scan-review-prepare.ts';
import type {ScanCommand} from '../src/domain/scan-contracts.ts';

const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const place='synthetic-test-place',other='synthetic-other-place';
const at='2026-10-28T12:00:00.000Z';
/** Authored test pixels and fake cached records exercise HTTP mechanics, not model perception. */
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'scan-review-test-'));
 mkdirSync(join(directory,'assets'));
 const source=new PNG({width:4,height:2});
 for(let y=0;y<2;y++)for(let x=0;x<4;x++)source.data.set(x<2?[255,0,0,255]:[0,0,255,255],(y*4+x)*4);
 const sourceBytes=PNG.sync.write(source),sourceHash=digest(sourceBytes);
 writeFileSync(join(directory,'assets',`${sourceHash}.png`),sourceBytes);
 const manifest:ScanReviewManifest={schemaVersion:1,purpose:'SYNTHETIC TEST ONLY: authored pixels with fake cached-model records; no inference',networkCalls:0,inputHash:digest('fake-input'),cards:[]};
 const store=new ScanStore(directory);
 try{
  for(const [index,placeId] of [place,other].entries()){
   const frameId=`synthetic-${index}`,eventId=`cached-${frameId}`,sessionId=`session-${index}`;
   const observations=[0,...(index===0?[1]:[])].map(cropIndex=>{
    const left=cropIndex*2,bounds={left,top:0,right:left+2,bottom:2},crop=new PNG({width:2,height:2});
    for(let y=0;y<2;y++)for(let x=0;x<2;x++)crop.data.set(source.data.subarray((y*4+left+x)*4,(y*4+left+x)*4+4),(y*2+x)*4);
    const cropBytes=PNG.sync.write(crop),cropHash=digest(cropBytes),regionRef=digest(sourceHash+JSON.stringify([left,0,left+2,2])+cropHash);
    writeFileSync(join(directory,'assets',`${cropHash}.png`),cropBytes);
    const values=Array<number>(24).fill(0),weight=4/Math.sqrt(48);
    for(const bin of cropIndex===0?[7,8,16]:[0,8,23])values[bin]=weight;
    const observationId=`observation-${index}-${cropIndex}`;
    manifest.cards.push({eventId,observationId,regionRef,frameId,placeId,sourceHash,cropHash,sourceWidth:4,sourceHeight:2,bounds,foregroundPixels:4});
    return {id:observationId,regionRef,cropHash,scope:'unknown' as const,feature:{method:'foreground-rgb-histogram-8-v0',values},label:`Fake cached label ${cropIndex}`};
   });
   store.createSession({id:sessionId,placeId,provenance:'cached-model',createdAt:at,label:'Synthetic HTTP fixture only'});
   store.appendEvidence(sessionId,{kind:'observe',id:eventId,placeId,provenance:'cached-model',sourceHash,groupId:`frame-${sourceHash}`,observedAt:at,timeBasis:'provider-response',observations});
  }
 }finally{store.close();}
 writeFileSync(join(directory,'scan-review-manifest.json'),JSON.stringify(manifest));
 return {directory,manifest,sourceBytes,cleanup(){rmSync(directory,{recursive:true,force:true});}};
}
const command=(id:string,action:ScanCommand['action'],placeId=place):ScanCommand=>({id,placeId,createdAt:at,actor:{id:'synthetic-http-test',kind:'user'},utterance:'Synthetic explicit selection',action});
const url=(placeId=place,revision?:number)=>`/api/scan/view?placeId=${encodeURIComponent(placeId)}${revision===undefined?'':`&revision=${revision}`}`;
type App=ReturnType<typeof createScanReviewApp>;
async function view(app:App,placeId=place,revision?:number){const r=await app.inject(url(placeId,revision));assert.equal(r.statusCode,200,r.body);return r.json<ScanReviewView>();}
async function post(app:App,revision:number,c:ScanCommand,headers:Record<string,string>={}){return app.inject({method:'POST',url:'/api/scan/commands',headers,payload:{expectedRevision:revision,command:c}});}

test('review cards bind exact source pixels, crop bounds and observation anchors; assets are allowlisted',async()=>{
 const f=fixture(),app=createScanReviewApp(f.directory);try{
  const places=(await app.inject('/api/scan/places')).json().places;
  assert.deepEqual(places.map((p:{id:string;candidateCount:number})=>[p.id,p.candidateCount]),[[place,2],[other,1]]);
  const v=await view(app);assert.equal(v.cards.length,2);
  for(const card of v.cards){
   const entity=v.belief.entities.find(e=>e.id===card.candidateId)!;
   assert.equal(card.observationRef,entity.anchorObservation);assert.equal(card.regionRef,entity.history[0].regionRef);
   const binding=f.manifest.cards.find(c=>c.regionRef===card.regionRef)!;
   assert.deepEqual(card.bounds,binding.bounds);assert.equal(card.scope,'unknown');assert.match(card.modelLabel!,/^Fake cached label/);
   for(const [assetUrl,expectedHash] of [[card.sourceUrl,card.sourceHash],[card.cropUrl,card.cropHash]]){
    const response=await app.inject(assetUrl);assert.equal(response.statusCode,200);assert.match(response.headers['content-type']!,/^image\/png/);assert.equal(digest(response.rawPayload),expectedHash);
   }
   assert.deepEqual((await app.inject(card.sourceUrl)).rawPayload,f.sourceBytes);
  }
  const unlisted=digest('unlisted-file');writeFileSync(join(f.directory,'assets',`${unlisted}.png`),f.sourceBytes);
  for(const path of [`/api/scan/assets/${unlisted}`,'/api/scan/assets/scan-workspace.sqlite','/api/scan/assets/%2e%2e%2fscan-workspace.sqlite','/api/frames','/api/places'])assert.notEqual((await app.inject(path)).statusCode,200,path);
 }finally{await app.close();f.cleanup();}
});

test('selected claims preserve beliefs and other-place state; invalid selections and stale revisions write nothing',async()=>{
 const f=fixture(),app=createScanReviewApp(f.directory);try{
  const initial=await view(app),foreign=await view(app,other),[a,b]=initial.cards.map(c=>c.candidateId);
  const accepted=await post(app,initial.revision,command('label',{type:'set-label',candidateIds:[a],label:'Personal test label'}));assert.equal(accepted.statusCode,200,accepted.body);
  const changed=accepted.json<ScanReviewView>();assert.deepEqual(changed.belief,initial.belief);
  assert.equal(changed.claims.objects.find(o=>o.candidateId===a)?.userLabel,'Personal test label');assert.equal(changed.claims.objects.find(o=>o.candidateId===b)?.userLabel,null);
  assert.deepEqual(await view(app,other),foreign);
  const rejected=await post(app,initial.revision,command('stale',{type:'add-tag',candidateIds:[b],tag:'stale'}));assert.equal(rejected.statusCode,409);
  for(const ids of [[a,'missing'],[a,foreign.cards[0].candidateId],[],[a,a]]){
   const response=await post(app,changed.revision,command(`invalid-${JSON.stringify(ids)}`,{type:'add-tag',candidateIds:ids,tag:'invalid'}));assert.equal(response.statusCode,400,response.body);
   assert.deepEqual(await view(app),changed);
  }
  const cross=await post(app,foreign.revision,command('cross-place',{type:'add-tag',candidateIds:[a],tag:'invalid'},other));assert.equal(cross.statusCode,400);assert.deepEqual(await view(app,other),foreign);
  assert.deepEqual(await view(app),changed);
 }finally{await app.close();f.cleanup();}
});

test('command retries are immutable and idempotent, including after subsequent edits',async()=>{
 const f=fixture(),app=createScanReviewApp(f.directory);try{
  const first=await view(app),a=first.cards[0].candidateId,c=command('retry',{type:'add-tag',candidateIds:[a],tag:'repair'});
  const response=await post(app,first.revision,c);assert.equal(response.statusCode,200);const accepted=response.json<ScanReviewView>();
  assert.equal((await post(app,accepted.revision,command('later',{type:'set-label',candidateIds:[a],label:'Later'}))).statusCode,200);
  const latest=await view(app),retry=await post(app,first.revision,structuredClone(c));assert.equal(retry.statusCode,200);
  assert.deepEqual(retry.json(),latest);assert.equal(retry.json().revision,latest.revision);assert.deepEqual(await view(app),latest);
  const collision=await post(app,latest.revision,{...c,action:{type:'add-tag',candidateIds:[a],tag:'changed'}});assert.equal(collision.statusCode,409);assert.deepEqual(await view(app),latest);
 }finally{await app.close();f.cleanup();}
});

test('group history, undo and reopen preserve exact memberships and revisions',async()=>{
 const f=fixture();let app=createScanReviewApp(f.directory);try{
  const initial=await view(app),[a,b]=initial.cards.map(c=>c.candidateId);
  const created=await post(app,initial.revision,command('create',{type:'create-group',groupId:'my-group',name:'Test kit',candidateIds:[a,b]}));assert.equal(created.statusCode,200);
  const grouped=created.json<ScanReviewView>();
  const removed=await post(app,grouped.revision,command('remove',{type:'remove-from-group',groupId:'my-group',candidateIds:[b]}));assert.equal(removed.statusCode,200);assert.deepEqual(removed.json<ScanReviewView>().claims.groups[0].memberIds,[a]);
  const undone=await post(app,removed.json().revision,command('undo',{type:'undo',targetCommandId:'remove'}));assert.equal(undone.statusCode,200);
  const current=undone.json<ScanReviewView>();assert.deepEqual(current.claims.groups[0].memberIds,[a,b]);assert.deepEqual(current.belief,initial.belief);
  assert.equal(current.claims.commands.find(c=>c.commandId==='remove')?.status,'undone');assert.deepEqual((await view(app,place,grouped.revision)).claims,grouped.claims);
  await app.close();app=createScanReviewApp(f.directory);assert.deepEqual(await view(app),current);assert.deepEqual((await view(app,place,initial.revision)).belief,initial.belief);
  for(const suffix of ['-1','1.5','nope',String(current.revision+1)])assert.equal((await app.inject(`/api/scan/view?placeId=${place}&revision=${suffix}`)).statusCode,400);
  assert.equal((await app.inject(url('unknown-place'))).statusCode,404);
 }finally{await app.close();f.cleanup();}
});

test('cross-origin and cross-site commands are rejected before mutation; same-origin JSON works',async()=>{
 const f=fixture(),app=createScanReviewApp(f.directory);try{
  const initial=await view(app),c=command('origin',{type:'add-tag',candidateIds:[initial.cards[0].candidateId],tag:'origin'});
  for(const headers of ([{host:'127.0.0.1:7394',origin:'https://foreign.invalid'},{host:'127.0.0.1:7394',origin:'null'},{host:'127.0.0.1:7394',origin:'http://127.0.0.1:7394','sec-fetch-site':'cross-site'}] as Record<string,string>[])){
   const response=await post(app,initial.revision,c,headers);assert.equal(response.statusCode,403);assert.deepEqual(await view(app),initial);
  }
  const text=await app.inject({method:'POST',url:'/api/scan/commands',headers:{'content-type':'text/plain'},payload:JSON.stringify({expectedRevision:initial.revision,command:c})});assert.equal(text.statusCode,415);assert.deepEqual(await view(app),initial);
  const accepted=await post(app,initial.revision,c,{host:'127.0.0.1:7394',origin:'http://127.0.0.1:7394'});assert.equal(accepted.statusCode,200);
 }finally{await app.close();f.cleanup();}
});

for(const kind of ['sourceHash','cropHash'] as const)test(`changed ${kind} asset is refused during serving and restart`,async()=>{
 const f=fixture(),app=createScanReviewApp(f.directory);try{
  const card=(await view(app)).cards[0],asset=join(f.directory,'assets',`${card[kind]}.png`);
  // Warm the derived descriptor cache before corrupting its content-addressed asset.
  const identityUrl=`/api/scan/identity?placeId=${encodeURIComponent(place)}&candidateId=${encodeURIComponent(card.candidateId)}`;
  assert.equal((await app.inject(identityUrl)).statusCode,200);
  writeFileSync(asset,Buffer.from('tampered synthetic asset'));
  assert.equal((await app.inject(identityUrl)).statusCode,409);
  const remaining=await app.inject(`/api/scan/identity?placeId=${encodeURIComponent(place)}`);
  assert.equal(remaining.statusCode,200);assert.ok(remaining.json().overlays.every((o:{candidateId:string})=>o.candidateId!==card.candidateId));
  assert.equal(remaining.json().overlays.length,kind==='sourceHash'?0:1);
  assert.equal((await app.inject(kind==='sourceHash'?card.sourceUrl:card.cropUrl)).statusCode,409);
  assert.throws(()=>createScanReviewApp(f.directory),/hash changed/);
 }finally{await app.close();f.cleanup();}
});

test('manifest substitution and symlink escapes cannot bind an unrelated source',()=>{
 const f=fixture(),outside=mkdtempSync(join(tmpdir(),'scan-review-outside-'));try{
  const path=join(f.directory,'scan-review-manifest.json'),manifest=structuredClone(f.manifest);
  manifest.cards[0].observationId='unrelated';writeFileSync(path,JSON.stringify(manifest));assert.throws(()=>createScanReviewApp(f.directory),/bind saved observation/);
  writeFileSync(path,JSON.stringify(f.manifest));const card=f.manifest.cards[0],asset=join(f.directory,'assets',`${card.sourceHash}.png`),outsideAsset=join(outside,'source.png');
  writeFileSync(outsideAsset,readFileSync(asset));rmSync(asset);symlinkSync(outsideAsset,asset);assert.throws(()=>createScanReviewApp(f.directory),/escaped workspace/);
 }finally{f.cleanup();rmSync(outside,{recursive:true,force:true});}
});


test('cached preparation verifies source/crop bytes before writing and refuses existing output',async()=>{
 const f=fixture();try{
  const packet=join(f.directory,'packet'),predictor=join(packet,'predictor'),trial=join(f.directory,'trial'),input=join(f.directory,'input.json'),output=join(f.directory,'prepared');
  mkdirSync(predictor,{recursive:true});mkdirSync(join(trial,'call-1'),{recursive:true});
  const original=new ScanStore(f.directory);let event;
  try{const row=original.events(place).find(r=>r.kind==='evidence'&&r.event.kind==='observe');assert.ok(row&&row.kind==='evidence'&&row.event.kind==='observe');event=structuredClone(row.event);}finally{original.close();}
  event.placeId='declared-experiment-sequence-test';event.observations=event.observations.map(o=>{const {label,...rest}=o;return {...rest,id:o.regionRef};});
  writeFileSync(input,JSON.stringify({schemaVersion:1,purpose:'SYNTHETIC TEST ONLY fake cached records; no model call',networkCalls:0,events:[event]}));
  writeFileSync(join(predictor,'source.png'),f.sourceBytes);
  writeFileSync(join(predictor,'inputs.json'),JSON.stringify({frames:[{id:'synthetic-0',image:'source.png',sha256:event.sourceHash,width:4,height:2,sequence:'test',split:'development'}]}));
  writeFileSync(join(trial,'ledger.json'),JSON.stringify([{key:event.sourceHash+':discover',status:'completed'}]));
  writeFileSync(join(trial,'call-1','response.json'),JSON.stringify({created_at:Date.parse(at)/1000}));
  for(const card of f.manifest.cards.filter(c=>c.placeId===place)){
   writeFileSync(join(trial,`${card.regionRef}.json`),JSON.stringify({id:card.regionRef,frame:card.frameId,sourceSha256:card.sourceHash,bounds:card.bounds,foregroundPixels:card.foregroundPixels,concept:'synthetic-test',method:'automatic-sam-proposal'}));
   writeFileSync(join(trial,`${card.regionRef}.png`),readFileSync(join(f.directory,'assets',`${card.cropHash}.png`)));
  }
  const inputBefore=readFileSync(input),sourcePath=join(predictor,'source.png');
  writeFileSync(sourcePath,Buffer.from('changed source'));assert.throws(()=>prepareScanReview(input,packet,trial,output),/hash changed/);assert.equal(existsSync(output),false);
  writeFileSync(sourcePath,f.sourceBytes);
  const first=f.manifest.cards[0],cropPath=join(trial,`${first.regionRef}.png`),cropBefore=readFileSync(cropPath);
  writeFileSync(cropPath,Buffer.from('changed crop'));assert.throws(()=>prepareScanReview(input,packet,trial,output),/hash changed/);assert.equal(existsSync(output),false);
  writeFileSync(cropPath,cropBefore);
  const summary=prepareScanReview(input,packet,trial,output);assert.equal(summary.cards,2);assert.equal(summary.networkCalls,0);assert.deepEqual(readFileSync(input),inputBefore);assert.deepEqual(readFileSync(sourcePath),f.sourceBytes);
  const app=createScanReviewApp(output);try{assert.equal((await view(app,event.placeId)).cards.length,2);}finally{await app.close();}
  const before=readFileSync(join(output,'scan-review-manifest.json'));assert.throws(()=>prepareScanReview(input,packet,trial,output),/already exists/);assert.deepEqual(readFileSync(join(output,'scan-review-manifest.json')),before);
 }finally{f.cleanup();}
});
