import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import Fastify from 'fastify';
import {PNG} from 'pngjs';
import {registerCaptureRoutes} from '../src/server/capture-routes.ts';
import {CAPTURE_BODY_LIMIT,CAPTURE_MAX_PNG_BYTES,type CaptureFrameInput} from '../src/domain/capture-contracts.ts';
const at='2026-10-28T12:00:00.000Z';
function png(){const image=new PNG({width:4,height:2});image.data.fill(255);return PNG.sync.write(image);}
const data=(bytes:Buffer)=>`data:image/png;base64,${bytes.toString('base64')}`;
const frame=(id:string,bytes=png()):CaptureFrameInput=>({id,sessionId:'virtual-session',capturedAt:at,imageDataUrl:data(bytes)});
function setup(){
 const root=mkdtempSync(join(tmpdir(),'capture-test-'));
 const start=()=>{const app=Fastify({bodyLimit:64*1024});registerCaptureRoutes(app,root);return app;};
 return {root,start,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const post=(app:ReturnType<typeof Fastify>,importId:string,frames:unknown[],headers:Record<string,string>={})=>app.inject({method:'POST',url:'/api/scan/captures',headers,payload:{importId,frames}});

test('capture selection persists only submitted frames and exact source pixels across restart',async()=>{
 const f=setup();let app=f.start();
 try{
  // Captures never write the independent observation workspace.
  const prior=Buffer.from('existing workspace sentinel');writeFileSync(join(f.root,'scan-workspace.sqlite'),prior);
  assert.deepEqual((await app.inject('/api/scan/captures')).json(),{frames:[]});
  const bytes=png(),response=await post(app,'selection',[frame('selected',bytes)]);
  assert.equal(response.statusCode,200,response.body);
  const saved=response.json().frames;assert.equal(saved.length,1);
  assert.deepEqual(saved[0],{id:'selected',sessionId:'virtual-session',capturedAt:at,width:4,height:2,sourceHash:createHash('sha256').update(bytes).digest('hex'),imageUrl:`/api/scan/captures/assets/${createHash('sha256').update(bytes).digest('hex')}`,analysisStatus:'not-analyzed'});
  assert.deepEqual((await app.inject(saved[0].imageUrl)).rawPayload,bytes);
  assert.equal((await app.inject('/api/scan/captures/assets/unknown')).statusCode,404);
  const second=await post(app,'later',[frame('second')]);assert.equal(second.statusCode,200);
  assert.deepEqual(second.json().frames[0],saved[0]);
  assert.deepEqual(readFileSync(join(f.root,'scan-workspace.sqlite')),prior);
  await app.close();app=f.start();assert.deepEqual((await app.inject('/api/scan/captures')).json(),second.json());
 }finally{await app.close();f.cleanup();}
});

test('immutable frame/import IDs and exact retries are atomic',async()=>{
 const f=setup(),app=f.start();try{
  const a=frame('a');assert.equal((await post(app,'first',[a])).statusCode,200);
  assert.equal((await post(app,'second',[frame('b')])).statusCode,200);
  const latest=(await app.inject('/api/scan/captures')).json();
  assert.deepEqual((await post(app,'first',[a])).json(),latest);
  assert.equal((await post(app,'first',[frame('changed')])).statusCode,409);
  assert.equal((await post(app,'collision',[frame('must-rollback'),{...a,sessionId:'changed'}])).statusCode,409);
  assert.deepEqual((await app.inject('/api/scan/captures')).json(),latest);
  assert.equal((await post(app,'subset',[a])).statusCode,200);
  assert.deepEqual((await app.inject('/api/scan/captures')).json(),latest);
 }finally{await app.close();f.cleanup();}
});

test('invalid dimensions, corrupt PNG, metadata and batch limits leave no captures',async()=>{
 const f=setup(),app=f.start();try{
  const large=png();large.writeUInt32BE(0x7fffffff,16);
  const invalid:unknown[][]=[
   [frame('valid'),frame('huge',large)],
   [frame('bad',Buffer.from('not png'))],
   [{...frame('extra'),objectId:'simulator-private'}],
   [{...frame('extra'),sourceHash:'client-asserted'}],
   [{...frame('bad-date'),capturedAt:'yesterday'}],
   [{...frame('bad-url'),imageDataUrl:'data:image/jpeg;base64,AAAA'}],
   [frame('oversize',Buffer.alloc(CAPTURE_MAX_PNG_BYTES+1))],
   [frame('a'),frame('a')],[],Array.from({length:13},(_,i)=>frame(`f-${i}`)),
  ];
  for(const [index,frames] of invalid.entries()){
   const response=await post(app,`invalid-${index}`,frames);assert.equal(response.statusCode,400,response.body);
   assert.deepEqual((await app.inject('/api/scan/captures')).json(),{frames:[]});
  }
  const extra=await app.inject({method:'POST',url:'/api/scan/captures',payload:{importId:'x',frames:[frame('a')],placeId:'truth'}});assert.equal(extra.statusCode,400);
 }finally{await app.close();f.cleanup();}
});

test('same-origin JSON and route-specific body cap are enforced',async()=>{
 const f=setup(),app=f.start();try{
  for(const headers of ([{host:'localhost:7394',origin:'https://foreign.invalid'},{host:'localhost:7394',origin:'null'},{'sec-fetch-site':'cross-site'}] as Record<string,string>[]))assert.equal((await post(app,'cross',[frame('a')],headers)).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/scan/captures',headers:{'content-type':'text/plain'},payload:'text'})).statusCode,415);
  assert.equal((await app.inject({method:'POST',url:'/api/scan/captures',headers:{'content-type':'application/json'},payload:' '.repeat(CAPTURE_BODY_LIMIT+1)})).statusCode,413);
  assert.deepEqual((await app.inject('/api/scan/captures')).json(),{frames:[]});
  // A valid padded PNG passes above the app's 64KB global body limit.
  const image=new PNG({width:200,height:200});for(let i=0;i<image.data.length;i++)image.data[i]=(i*73+(i>>8)*97)%256;
  const bytes=PNG.sync.write(image,{deflateLevel:0});assert.ok(bytes.length>64*1024);
  const response=await post(app,'allowed',[frame('a',bytes)],{host:'localhost:7394',origin:'http://localhost:7394'});assert.equal(response.statusCode,200,response.body);
 }finally{await app.close();f.cleanup();}
});

test('SQLite write failure rolls back assets, frames and import identity',async()=>{
 const f=setup(),app=f.start();try{
  const db=new DatabaseSync(join(f.root,'scan-captures.sqlite'));
  db.exec("CREATE TRIGGER fail_capture BEFORE INSERT ON capture_frames WHEN NEW.id='fail' BEGIN SELECT RAISE(ABORT,'authored write failure'); END;");
  const failed=await post(app,'retry-after-failure',[frame('first'),frame('fail')]);assert.equal(failed.statusCode,500);
  assert.deepEqual((await app.inject('/api/scan/captures')).json(),{frames:[]});
  for(const table of ['capture_assets','capture_frames','capture_imports'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,0);
  db.exec('DROP TRIGGER fail_capture');db.close();
  assert.equal((await post(app,'retry-after-failure',[frame('first'),frame('fail')])).statusCode,200);
 }finally{await app.close();f.cleanup();}
});


test('a saved PNG above the former 2 MiB limit remains usable by the room observer',async()=>{
 const f=setup(),app=f.start();try{
  const image=new PNG({width:800,height:800});
  for(let i=0;i<image.data.length;i++)image.data[i]=(i*73+(i>>8)*97)%256;
  const bytes=PNG.sync.write(image,{deflateLevel:0});
  assert.ok(bytes.length>2*1024*1024 && bytes.length<CAPTURE_MAX_PNG_BYTES);
  const response=await post(app,'large-phone',[frame('large-phone',bytes)]);
  assert.equal(response.statusCode,200,response.body);
  const saved=response.json().frames[0];
  assert.deepEqual((await app.inject(saved.imageUrl)).rawPayload,bytes);
  const {validateRoomObserverInput}=await import('../src/server/room-observer-provider.ts');
  validateRoomObserverInput({frame:saved,frameBytes:bytes,references:[],room:{graph:{sourceViews:[]},visits:[]}} as unknown as Parameters<typeof validateRoomObserverInput>[0]);
 }finally{await app.close();f.cleanup();}
});

test('capture source provenance persists, remains unknown for legacy frames, and is immutable',async()=>{
 const f=setup();let app=f.start();try{
  assert.equal((await post(app,'old',[frame('old')])).statusCode,200);
  const device={...frame('phone'),sourceKind:'device-camera' as const};
  const virtual={...frame('virtual'),sourceKind:'virtual-camera' as const};
  assert.equal((await post(app,'new',[device,virtual])).statusCode,200);
  assert.equal((await post(app,'invalid-source',[{...frame('invalid'),sourceKind:'other'}])).statusCode,400);
  assert.equal((await post(app,'collision-source',[{...device,sourceKind:'virtual-camera'}])).statusCode,409);
  await app.close();app=f.start();const saved=(await app.inject('/api/scan/captures')).json().frames;
  assert.equal(saved[0].sourceKind,undefined);assert.equal(saved[1].sourceKind,'device-camera');assert.equal(saved[2].sourceKind,'virtual-camera');
 }finally{await app.close();f.cleanup();}
});

test('restricted capture route only accepts explicitly declared device frames',async()=>{
 const root=mkdtempSync(join(tmpdir(),'phone-capture-test-')),app=Fastify();registerCaptureRoutes(app,root,undefined,'device-camera');try{
  assert.equal((await post(app,'unknown',[frame('unknown')])).statusCode,400);
  assert.equal((await post(app,'virtual',[{...frame('virtual'),sourceKind:'virtual-camera'}])).statusCode,400);
  assert.equal((await post(app,'device',[{...frame('device'),sourceKind:'device-camera'}])).statusCode,200);
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
