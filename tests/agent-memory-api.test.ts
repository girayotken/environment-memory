import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {PNG} from 'pngjs';
import {CaptureStore} from '../src/server/capture-store.ts';
import {RoomMemoryStore} from '../src/server/room-memory-store.ts';
import {registerAgentMemoryApi} from '../src/server/agent-memory-api.ts';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'room-memory-')),captures=new CaptureStore(root),image=new PNG({width:2,height:2});image.data.fill(255);const bytes=PNG.sync.write(image);
 const frames=captures.import({importId:'capture',frames:[{id:'frame',sessionId:'session',capturedAt:'2026-10-29T00:00:00Z',imageDataUrl:`data:image/png;base64,${bytes.toString('base64')}`}]});captures.close();
 const sourceViews=[{viewId:'v1',frameId:'frame',sourceHash:frames[0].sourceHash},{viewId:'v2',frameId:'frame',sourceHash:frames[0].sourceHash}],evidence=[{viewId:'v1',basis:'Visible in pixels'},{viewId:'v2',basis:'Visible in second view'}];
 const graph={scope:'Partial room',sourceViews,nodes:[{id:'n1',label:'Workbench',kind:'support',status:'provisional',attributes:['Wooden top'],evidence},{id:'n2',label:'Box',kind:'container',status:'provisional',attributes:[],evidence}],edges:[{from:'n2',to:'n1',relation:'on',status:'observed',evidence}],identityGroups:[{nodeId:'n1',viewIds:['v1','v2'],status:'provisional',basis:'Visible',alternatives:'Similar objects possible',evidence}],unknowns:['Occluded contents unknown'],nodeOrigins:{n1:[],n2:[]},reviewNotes:[]};
 const initial={schemaVersion:1,importId:'initial',roomId:'room',label:'Workshop',graph};
 const visit={schemaVersion:1,importId:'revisit',roomId:'room',visitId:'visit1',label:'Revisit',summary:'Partial view only',sourceViews,proposals:[{id:'p1',nodeId:'n1',observationId:'new1',status:'likely-same',basis:'Matching visible form',evidence,alternatives:'Similar workbench possible'}]};
 return {root,initial,visit,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('bounded agent access shares memory, checks cursors, provenance and edit idempotency',async()=>{
 const f=fixture(),store=new RoomMemoryStore(f.root),app=Fastify();store.importInitial(f.initial);registerAgentMemoryApi(app,store);
 const post=(path:string,payload:Record<string,unknown>,headers:Record<string,string>={})=>app.inject({method:'POST',url:`/api/agent/v1/${path}`,payload,headers});
 try{
  assert.equal((await post('read',{op:'rooms'},{origin:'http://evil.example'})).statusCode,403);assert.equal((await post('read',{op:'rooms'},{host:'evil.example',origin:'http://evil.example'})).statusCode,403);
  const rooms=(await post('read',{op:'rooms'})).json();assert.equal(rooms.items[0].roomId,'room');
  const first=(await post('read',{op:'objects',roomId:'room',limit:1})).json();assert.equal(first.items.length,1);assert.ok(first.nextCursor);
  const detail=(await post('read',{op:'object',roomId:'room',nodeId:'n1'})).json();assert.equal(detail.lastSeen.source.sourceHash.length,64);assert.equal(detail.lastSeen.identityMatch,null);assert.equal(detail.personal.revision,0);assert.equal(detail.graph,undefined);assert.equal((await post('read',{op:'object',roomId:'room',nodeId:'n1',ifRevision:detail.revision})).json().unchanged,true);
  assert.equal((await post('read',{op:'find',term:'wood'})).json().items[0].nodeId,'n1');
  const change={operationId:'e1',roomId:'room',nodeId:'n1',expectedRevision:0,text:'Call it Desk and tag repair',changes:[{kind:'name',value:'Desk'},{kind:'addTag',value:'repair'}]};
  const saved=await post('edit',change);assert.equal(saved.statusCode,200);assert.equal(saved.json().revision,1);const changed=(await post('read',{op:'object',roomId:'room',nodeId:'n1',ifRevision:detail.revision})).json();assert.notEqual(changed.revision,detail.revision);assert.equal(changed.unchanged,undefined);assert.equal((await post('edit',change)).statusCode,200);
  assert.equal((await post('edit',{...change,changes:[{kind:'name',value:'Desk'}]})).statusCode,409);
  assert.equal((await post('read',{op:'objects',roomId:'room',limit:1,cursor:first.nextCursor})).statusCode,409);
  assert.equal((await post('edit',{...change,operationId:'e2',expectedRevision:1,changes:[{kind:'name',value:'invented'}]})).statusCode,400);
  const undo={operationId:'u1',roomId:'room',nodeId:'n1',expectedRevision:1,revisionId:'e1'};assert.equal((await post('undo',undo)).json().revision,2);assert.equal((await post('undo',undo)).statusCode,200);
  assert.equal((await post('read',{op:'object',roomId:'room',nodeId:'n1'})).json().personal.name,null);
 }finally{await app.close();store.close();f.cleanup();}
});
