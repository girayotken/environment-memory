import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PNG} from 'pngjs';
import {ScanStore} from '../src/server/scan-store.ts';
import {createScanReviewApp,scanHash,verifyScanPixels} from '../src/server/scan-review.ts';
import {CaptureStore} from '../src/server/capture-store.ts';
import type {DetectionProvider} from '../src/server/scan-detector.ts';
const at='2026-10-28T10:00:00.000Z';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'detection-test-'));mkdirSync(join(root,'assets'));
 const image=new PNG({width:2,height:2});for(let i=0;i<16;i+=4)image.data.set([200,80,40,255],i);
 const bytes=PNG.sync.write(image),hash=scanHash(bytes),regionRef=scanHash(hash+JSON.stringify([0,0,2,2])+hash);
 const card={eventId:'cached-test',observationId:'old',regionRef,frameId:'test',placeId:'old-place',sourceHash:hash,cropHash:hash,sourceWidth:2,sourceHeight:2,bounds:{left:0,top:0,right:2,bottom:2},foregroundPixels:4};
 writeFileSync(join(root,'assets',hash+'.png'),bytes);
 writeFileSync(join(root,'scan-review-manifest.json'),JSON.stringify({schemaVersion:1,purpose:'Authored offline mechanics fixture',networkCalls:0,inputHash:scanHash('input'),cards:[card]}));
 const store=new ScanStore(root);store.createSession({id:'old-session',placeId:'old-place',createdAt:at,label:'Offline fixture',provenance:'cached-model'});store.appendEvidence('old-session',{kind:'observe',id:'cached-test',placeId:'old-place',provenance:'cached-model',sourceHash:hash,groupId:'old-group',observedAt:at,timeBasis:'capture',observations:[{id:'old',regionRef,cropHash:hash,scope:'unknown',feature:{method:'foreground-rgb-histogram-8-v0',values:verifyScanPixels(card,bytes,bytes)}}]});store.close();
 const captures=new CaptureStore(root);captures.import({importId:'import',frames:['saved-a','saved-b'].map(id=>({id,sessionId:'camera',capturedAt:at,imageDataUrl:'data:image/png;base64,'+bytes.toString('base64')}))});captures.close();
 const manifest=readFileSync(join(root,'scan-review-manifest.json'));
 return {root,bytes,manifest,cleanup(){rmSync(root,{recursive:true,force:true});}};
}
const analyze=(app:ReturnType<typeof createScanReviewApp>,frame='saved-a',payload:Record<string,unknown>={})=>app.inject({method:'POST',url:`/api/scan/captures/${frame}/analyze`,payload});
const provider=(f:ReturnType<typeof fixture>,extra:Partial<Awaited<ReturnType<DetectionProvider>>>={}):DetectionProvider=>async({frame,bytes})=>{assert.equal(frame.capturedAt,at);assert.deepEqual(bytes,f.bytes);return {model:'authored-offline-test',sourceHash:frame.sourceHash,regions:[{bounds:{left:0,top:0,right:2,bottom:2},crop:bytes,label:'Authored test object'}],receipt:{testOnly:true},...extra};};
test('saved frame detection coalesces, binds pixels, supports edits and survives disabled restart',async()=>{
 const f=fixture();let calls=0;let app=createScanReviewApp(f.root,{detection:{testOnly:true,provider:async input=>{calls++;await new Promise(r=>setTimeout(r,10));return provider(f)(input);}}});
 try{
  assert.equal((await app.inject('/api/scan/detection')).json().analyses.length,0);assert.equal(calls,0);
  const [a,b]=await Promise.all([analyze(app),analyze(app)]);assert.equal(a.statusCode,200,a.body);assert.deepEqual(a.json(),b.json());assert.equal(calls,1);
  const record=a.json().analysis;assert.equal(record.status,'completed');assert.equal(record.candidateCount,1);
  const view=(await app.inject(`/api/scan/view?placeId=${record.placeId}`)).json();assert.equal(view.cards.length,1);assert.equal(view.cards[0].observedAt,at);assert.equal(view.cards[0].timeBasis,'capture');assert.equal(view.sessions[0].provenance,'authored-scenario');assert.equal(view.cards[0].scope,'unknown');
  assert.deepEqual((await app.inject(view.cards[0].sourceUrl)).rawPayload,f.bytes);assert.deepEqual((await app.inject(view.cards[0].cropUrl)).rawPayload,f.bytes);
  const edited=await app.inject({method:'POST',url:'/api/scan/commands',payload:{expectedRevision:view.revision,command:{id:'name-live',placeId:record.placeId,createdAt:at,actor:{id:'user',kind:'user'},action:{type:'set-label',candidateIds:[view.cards[0].candidateId],label:'My object'}}}});assert.equal(edited.statusCode,200,edited.body);
  await app.close();app=createScanReviewApp(f.root);
  assert.equal((await app.inject('/api/scan/detection')).json().enabled,false);
  assert.deepEqual((await analyze(app)).json().analysis,record);
  const restored=(await app.inject(`/api/scan/view?placeId=${record.placeId}`)).json();assert.equal(restored.claims.objects[0].userLabel,'My object');
  assert.equal((await analyze(app,'saved-b')).statusCode,403);
  assert.deepEqual(readFileSync(join(f.root,'scan-review-manifest.json')),f.manifest);
 }finally{await app.close();f.cleanup();}
});
test('empty results are legitimate; failed validation leaves no session or candidates and never retries',async()=>{
 for(const mode of ['empty','wrong-hash','wrong-pixels','too-many','oversized-crop'] as const){
  const f=fixture();let calls=0;const app=createScanReviewApp(f.root,{detection:{testOnly:true,provider:async input=>{calls++;const r=await provider(f)(input);if(mode==='empty')r.regions=[];if(mode==='wrong-hash')r.sourceHash='0'.repeat(64);if(mode==='oversized-crop'){r.regions[0].bounds.right=1000000000;r.regions[0].crop=Buffer.from(f.bytes);r.regions[0].crop.writeUInt32BE(1000000000,16);}if(mode==='too-many')r.regions=Array(25).fill(r.regions[0]);if(mode==='wrong-pixels'){const p=PNG.sync.read(r.regions[0].crop);p.data[0]++;r.regions[0].crop=PNG.sync.write(p);}return r;}}});
  try{const r=await analyze(app);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().analysis.status,mode==='empty'?'empty':'error');assert.deepEqual((await analyze(app)).json(),r.json());assert.equal(calls,1);const places=(await app.inject('/api/scan/places')).json().places;assert.equal(places.length,mode==='empty'?2:1);if(mode==='empty')assert.equal(places[1].candidateCount,0);}finally{await app.close();f.cleanup();}
 }
});
test('interrupted jobs become unknown errors and cannot trigger a second provider call',async()=>{
 const f=fixture(),db=new DatabaseSync(join(f.root,'scan-detections.sqlite'));db.exec('CREATE TABLE detection_jobs(frame_id TEXT PRIMARY KEY,analysis TEXT NOT NULL,bundle TEXT)');db.prepare('INSERT INTO detection_jobs VALUES(?,?,NULL)').run('saved-a',JSON.stringify({frameId:'saved-a',status:'processing',placeId:null,candidateCount:0,error:null}));db.close();let calls=0;
 const app=createScanReviewApp(f.root,{detection:{testOnly:true,provider:async input=>{calls++;return provider(f)(input);}}});try{const r=await analyze(app);assert.equal(r.json().analysis.status,'error');assert.match(r.json().analysis.error,/unknown/);assert.equal(calls,0);}finally{await app.close();f.cleanup();}
});
test('detection route rejects supplied pixels, unknown captures and cross-origin actions',async()=>{
 const f=fixture();const app=createScanReviewApp(f.root,{detection:{testOnly:true,provider:provider(f)}});try{
  assert.equal((await analyze(app,'missing')).statusCode,404);assert.equal((await analyze(app,'saved-a',{pixels:'arbitrary'})).statusCode,422);
  assert.equal((await app.inject({method:'POST',url:'/api/scan/captures/saved-a/analyze',headers:{origin:'https://other.invalid'},payload:{}})).statusCode,403);
  assert.equal((await app.inject('/api/scan/detection')).json().analyses.length,0);
  assert.throws(()=>createScanReviewApp(f.root,{detection:{provider:provider(f)}}),/requires explicit testOnly/);
 }finally{await app.close();f.cleanup();}
});

test('staged result recovers atomic publication without invoking inference',async()=>{
 const f=fixture();let app=createScanReviewApp(f.root,{detection:{testOnly:true,provider:provider(f)}});
 try{
  const record=(await analyze(app)).json().analysis;await app.close();
  const workspace=new DatabaseSync(join(f.root,'scan-workspace.sqlite'));workspace.prepare('DELETE FROM scan_events WHERE place_id=?').run(record.placeId);workspace.close();
  const jobs=new DatabaseSync(join(f.root,'scan-detections.sqlite'));jobs.prepare('UPDATE detection_jobs SET analysis=? WHERE frame_id=?').run(JSON.stringify({...record,status:'processing',placeId:null,candidateCount:0}),'saved-a');jobs.close();
  app=createScanReviewApp(f.root);
  const status=(await app.inject('/api/scan/detection')).json();assert.equal(status.analyses[0].status,'completed');assert.equal(status.analyses[0].placeId,record.placeId);
  const view=(await app.inject(`/api/scan/view?placeId=${record.placeId}`)).json();assert.equal(view.cards.length,1);assert.equal(view.sessions.length,1);
  assert.deepEqual((await analyze(app)).json().analysis,record);
 }finally{await app.close();f.cleanup();}
});
test('dynamic source/crop changes are rejected on restart independently of sealed cached manifest',async()=>{
 const f=fixture();let app=createScanReviewApp(f.root,{detection:{testOnly:true,provider:provider(f)}});
 try{
  await analyze(app);await app.close();
  const db=new DatabaseSync(join(f.root,'scan-detections.sqlite'));db.prepare('UPDATE detection_assets SET bytes=?').run(Buffer.from('changed'));db.close();
  assert.throws(()=>createScanReviewApp(f.root),/hash changed/);
  assert.deepEqual(readFileSync(join(f.root,'scan-review-manifest.json')),f.manifest);
 }finally{f.cleanup();}
});

test('graceful close waits for in-flight publication before closing the workspace',async()=>{
 const f=fixture();let release!:()=>void,started!:()=>void;
 const running=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const app=createScanReviewApp(f.root,{detection:{testOnly:true,provider:async input=>{started();await gate;return provider(f)(input);}}});
 try{
  const request=analyze(app);await running;const closed=app.close();release();
  const result=await request;assert.equal(result.json().analysis.status,'completed');await closed;
  const reopened=createScanReviewApp(f.root);try{assert.equal((await reopened.inject('/api/scan/detection')).json().analyses[0].status,'completed');}finally{await reopened.close();}
 }finally{f.cleanup();}
});
