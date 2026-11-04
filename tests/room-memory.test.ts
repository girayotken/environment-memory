import {roomContainmentRemoval} from '../src/domain/room-containment.ts';
import {findRoomMemory} from '../src/domain/room-find.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import Fastify from 'fastify';
import {PNG} from 'pngjs';
import {CaptureStore} from '../src/server/capture-store.ts';
import {RoomMemoryStore} from '../src/server/room-memory-store.ts';
import {registerRoomMemoryRoutes} from '../src/server/room-memory-routes.ts';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'room-memory-')),captures=new CaptureStore(root),image=new PNG({width:2,height:2});image.data.fill(255);const bytes=PNG.sync.write(image);
 const frames=captures.import({importId:'capture',frames:[{id:'frame',sessionId:'session',capturedAt:'2026-10-29T00:00:00Z',imageDataUrl:`data:image/png;base64,${bytes.toString('base64')}`}]});captures.close();
 const sourceViews=[{viewId:'v1',frameId:'frame',sourceHash:frames[0].sourceHash},{viewId:'v2',frameId:'frame',sourceHash:frames[0].sourceHash}],evidence=[{viewId:'v1',basis:'Visible in pixels'},{viewId:'v2',basis:'Visible in second view'}];
 const graph={scope:'Partial room',sourceViews,nodes:[{id:'n1',label:'Workbench',kind:'support',status:'provisional',attributes:['Wooden top'],evidence},{id:'n2',label:'Box',kind:'container',status:'provisional',attributes:[],evidence}],edges:[{from:'n2',to:'n1',relation:'on',status:'observed',evidence}],identityGroups:[{nodeId:'n1',viewIds:['v1','v2'],status:'provisional',basis:'Visible',alternatives:'Similar objects possible',evidence}],unknowns:['Occluded contents unknown'],nodeOrigins:{n1:[],n2:[]},reviewNotes:[]};
 const initial={schemaVersion:1,importId:'initial',roomId:'room',label:'Workshop',graph};
 const visit={schemaVersion:1,importId:'revisit',roomId:'room',visitId:'visit1',label:'Revisit',summary:'Partial view only',sourceViews,proposals:[{id:'p1',nodeId:'n1',observationId:'new1',status:'likely-same',basis:'Matching visible form',evidence,alternatives:'Similar workbench possible'}]};
 return {root,initial,visit,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('room graph and revisits persist, retry idempotently and preserve independent records',()=>{
 const f=fixture();const prior=Buffer.from('existing scan sentinel');writeFileSync(join(f.root,'scan-workspace.sqlite'),prior);let store=new RoomMemoryStore(f.root);
 try{const first=store.importInitial(f.initial);assert.equal(first.rooms[0].graph.nodes.length,2);assert.equal(first.rooms[0].graph.sourceViews[0].capturedAt,'2026-10-29T00:00:00Z');assert.deepEqual(store.importInitial(f.initial),first);
  const second=store.importVisit(f.visit);assert.equal(second.rooms[0].visits.length,1);assert.equal(second.rooms[0].provenance,'agent-derived');assert.deepEqual(store.importVisit(f.visit),second);assert.deepEqual(second.rooms[0].graph,first.rooms[0].graph);
  assert.throws(()=>store.importInitial({...f.initial,label:'Changed'}),/collision/);assert.throws(()=>store.importVisit({...f.visit,label:'Changed'}),/collision/);assert.deepEqual(store.read(),second);
  store.close();store=new RoomMemoryStore(f.root);assert.deepEqual(store.read(),second);assert.deepEqual(readFileSync(join(f.root,'scan-workspace.sqlite')),prior);
  const captures=new CaptureStore(f.root);assert.equal(captures.frames().length,1);captures.close();
 }finally{store.close();f.cleanup();}
});
test('unknown source, evidence, edge and group references reject atomically',()=>{
 const f=fixture(),store=new RoomMemoryStore(f.root);try{
  const invalid=[{...f.initial.graph,sourceViews:[{...f.initial.graph.sourceViews[0],frameId:'unknown'}]},{...f.initial.graph,nodes:[{...f.initial.graph.nodes[0],evidence:[{viewId:'bad',basis:'Wrong'}]}]}, {...f.initial.graph,edges:[{...f.initial.graph.edges[0],to:'unknown'}]}, {...f.initial.graph,identityGroups:[{...f.initial.graph.identityGroups[0],nodeId:'unknown'}]}, {...f.initial.graph,nodeOrigins:{unknown:[]}}, {...f.initial.graph,identityGroups:[{...f.initial.graph.identityGroups[0],evidence:[f.initial.graph.nodes[0].evidence[0]]}]}, {...f.initial.graph,nodes:[{...f.initial.graph.nodes[0],evidence:[f.initial.graph.nodes[0].evidence[0]]},f.initial.graph.nodes[1]]}, {...f.initial.graph,identityGroups:[{...f.initial.graph.identityGroups[0],viewIds:['v1'],evidence:[f.initial.graph.nodes[0].evidence[0]]}]}, {...f.initial.graph,edges:[{...f.initial.graph.edges[0],relation:'invented'}]}, {...f.initial.graph,nodes:[f.initial.graph.nodes[0],f.initial.graph.nodes[0]]}];
  for(const graph of invalid){assert.throws(()=>store.importInitial({...f.initial,graph}));assert.deepEqual(store.read(),{rooms:[]});}
  store.importInitial(f.initial);for(const visit of [{...f.visit,roomId:'bad'},{...f.visit,proposals:[{...f.visit.proposals[0],nodeId:'bad'}]},{...f.visit,proposals:[{...f.visit.proposals[0],observationId:null}]},{...f.visit,proposals:[...f.visit.proposals,{...f.visit.proposals[0],id:'p2',nodeId:'n2'}]}]){assert.throws(()=>store.importVisit(visit));assert.equal(store.read().rooms[0].visits.length,0);}
 }finally{store.close();f.cleanup();}
});
test('every read rechecks actual capture bytes and HTTP fails closed after source change',async()=>{
 const f=fixture(),store=new RoomMemoryStore(f.root);store.importInitial(f.initial);store.importVisit(f.visit);const app=Fastify();registerRoomMemoryRoutes(app,f.root);
 try{assert.equal((await app.inject('/api/scan/room-memory')).statusCode,200);const url=store.read().rooms[0].graph.sourceViews[0].imageUrl;assert.equal((await app.inject(url)).statusCode,200);assert.equal((await app.inject('/api/scan/room-memory/assets/unknown')).statusCode,404);const db=new DatabaseSync(join(f.root,'scan-captures.sqlite'));db.prepare('UPDATE capture_assets SET bytes=?').run(Buffer.from('changed'));db.close();assert.throws(()=>store.read(),/missing or changed/);assert.equal((await app.inject('/api/scan/room-memory')).statusCode,409);assert.equal((await app.inject(url)).statusCode,409);assert.throws(()=>store.importInitial(f.initial),/missing or changed/);
 }finally{await app.close();store.close();f.cleanup();}
});

test('semantic answers are source-preserving, node-bound, idempotent and reversible after restart',()=>{
 const f=fixture();f.initial.graph.nodes[1].attributes=['Object kind unknown'];let store=new RoomMemoryStore(f.root);
 try{
  store.importInitial(f.initial);store.importVisit(f.visit);const before=store.read().rooms[0],answer={operationId:'answer1',roomId:'room',nodeId:'n2',label:'My test jig'};
  for(const invalid of [{...answer,label:'   '},{...answer,nodeId:'n1'},{...answer,roomId:'elsewhere'},{...answer,nodeId:'absent'},{...answer,unexpected:true}])assert.throws(()=>store.answerSemantic(invalid));
  const after=store.answerSemantic(answer);assert.deepEqual(store.answerSemantic(answer),after);assert.deepEqual(after.rooms[0].graph,before.graph);assert.deepEqual(after.rooms[0].visits,before.visits);assert.equal(after.rooms[0].semanticRevisions?.[0].attribution,'user');
  assert.throws(()=>store.answerSemantic({...answer,label:'Changed'}),/collision/);assert.throws(()=>store.answerSemantic({...answer,operationId:'second'}),/already has/);
  for(const invalid of [{operationId:'undo1',roomId:'room',nodeId:'n1',revisionId:'answer1'},{operationId:'undo1',roomId:'wrong',nodeId:'n2',revisionId:'answer1'}])assert.throws(()=>store.undoSemantic(invalid));
  store.close();store=new RoomMemoryStore(f.root);assert.deepEqual(store.read(),after);
  const undo={operationId:'undo1',roomId:'room',nodeId:'n2',revisionId:'answer1'},undone=store.undoSemantic(undo);assert.equal(undone.rooms[0].semanticRevisions?.[0].withdrawn,true);assert.deepEqual(store.undoSemantic(undo),undone);assert.deepEqual(store.answerSemantic(answer),undone);
  const corrected=store.answerSemantic({...answer,operationId:'answer2',label:'Özel parça'});assert.equal(corrected.rooms[0].semanticRevisions?.[1].label,'Özel parça');assert.deepEqual(corrected.rooms[0].graph,before.graph);
 }finally{store.close();f.cleanup();}
});
test('semantic HTTP rejects cross-site/malformed targets and supports answer plus undo',async()=>{
 const f=fixture();f.initial.graph.nodes[1].attributes=['Object kind unknown'];const store=new RoomMemoryStore(f.root);store.importInitial(f.initial);const app=Fastify();registerRoomMemoryRoutes(app,f.root);
 const answer={operationId:'http-answer',roomId:'room',nodeId:'n2',label:'Test object'};
 try{
  const send=(payload:Record<string,unknown>,headers={})=>app.inject({method:'POST',url:'/api/scan/room-memory/semantic/answer',payload,headers});
  assert.equal((await send(answer,{origin:'http://elsewhere'})).statusCode,403);assert.equal((await send(answer,{'sec-fetch-site':'cross-site'})).statusCode,403);
  assert.equal((await send({...answer,nodeId:'bad'})).statusCode,400);assert.equal((await send({...answer,label:' '})).statusCode,400);
  const accepted=await send(answer);assert.equal(accepted.statusCode,200);assert.deepEqual((await send(answer)).json(),accepted.json());
  assert.equal((await app.inject({method:'POST',url:'/api/scan/room-memory/semantic/undo',payload:{operationId:'http-undo',roomId:'room',nodeId:'n2',revisionId:'http-answer'}})).statusCode,200);
 }finally{await app.close();store.close();f.cleanup();}
});

test('different-appearance proposals preserve memory and require a sourced counterpart',()=>{
 const f=fixture(),store=new RoomMemoryStore(f.root);try{
  const before=store.importInitial(f.initial).rooms[0].graph;const proposal={...f.visit.proposals[0],status:'different',basis:'The counterpart has a different visible outline; replacement remains a possibility.'};
  assert.throws(()=>store.importVisit({...f.visit,proposals:[{...proposal,observationId:null}]}),/observation/);
  const after=store.importVisit({...f.visit,proposals:[proposal]});assert.equal(after.rooms[0].visits[0].proposals[0].status,'different');assert.deepEqual(after.rooms[0].graph,before);
 }finally{store.close();f.cleanup();}
});

test('room user edits are atomic, node bound, durable, stale protected and undoable',()=>{
 const f=fixture();let store=new RoomMemoryStore(f.root);try{
  const original=store.importInitial(f.initial).rooms[0].graph;
  const message={operationId:'edit-1',roomId:'room',nodeId:'n2',expectedRevision:0,text:'Call it Özel kutu and add tools and tamir'};
  const decision={status:'apply' as const,reply:'Saved.',changes:[{kind:'name' as const,value:'Özel kutu'},{kind:'addGroup' as const,value:'tools'},{kind:'addTag' as const,value:'tamir'}]};
  const changed=store.applyUserEdit(message,decision);assert.deepEqual(changed.rooms[0].graph,original);assert.deepEqual(changed.rooms[0].userEdits?.[0],{nodeId:'n2',revision:1,name:'Özel kutu',groups:['tools'],tags:['tamir'],lastRevisionId:'edit-1'});
  assert.deepEqual(store.applyUserEdit(message,decision),changed);assert.throws(()=>store.applyUserEdit({...message,operationId:'stale'},decision),/changed/);assert.throws(()=>store.applyUserEdit({...message,operationId:'wrong',nodeId:'missing'},decision),/Unknown/);
  assert.throws(()=>store.applyUserEdit({...message,operationId:'bad',expectedRevision:1},{...decision,changes:[{kind:'addTag',value:'invented'}]}),/original message/);assert.deepEqual(store.read(),changed);
  store.close();store=new RoomMemoryStore(f.root);assert.deepEqual(store.read(),changed);
  const undo={operationId:'undo-1',roomId:'room',nodeId:'n2',expectedRevision:1,revisionId:'edit-1'},undone=store.undoUserEdit(undo);assert.deepEqual(undone.rooms[0].userEdits?.[0],{nodeId:'n2',revision:2,name:null,groups:[],tags:[],lastRevisionId:null});assert.deepEqual(store.undoUserEdit(undo),undone);assert.throws(()=>store.undoUserEdit({...undo,operationId:'undo-again',expectedRevision:2}),/latest/);
 }finally{store.close();f.cleanup();}
});

test('room edit HTTP validates model decisions, rejects stale targets and permits exact retry',async()=>{
 const f=fixture(),store=new RoomMemoryStore(f.root);store.importInitial(f.initial);let calls=0;const app=Fastify();registerRoomMemoryRoutes(app,f.root,{testOnly:true,editProvider:async()=>{calls++;return {status:'apply',reply:'Saved.',changes:[{kind:'name',value:'Özel kutu'},{kind:'addTag',value:'tamir'}]};}});
 const body={operationId:'turn',roomId:'room',nodeId:'n2',expectedRevision:0,text:'Özel kutu tamir'};const send=(payload:Record<string,unknown>)=>app.inject({method:'POST',url:'/api/scan/room-memory/edit/message',payload});
 try{assert.equal((await send({...body,nodeId:'bad'})).statusCode,400);const first=await send(body);assert.equal(first.statusCode,200);assert.equal(first.json().view.rooms[0].userEdits[0].name,'Özel kutu');assert.equal((await send(body)).statusCode,200);assert.equal(calls,1);assert.equal((await send({...body,operationId:'stale'})).statusCode,409);assert.equal((await send({...body,text:'changed'})).statusCode,409);assert.equal((await app.inject({method:'POST',url:'/api/scan/room-memory/edit/undo',payload:{operationId:'undo',roomId:'room',nodeId:'n2',expectedRevision:1,revisionId:'turn'}})).statusCode,200);
 }finally{await app.close();store.close();f.cleanup();}
});

test('clarification is durable and exact retries do not invoke the interpreter again',async()=>{
 const f=fixture(),store=new RoomMemoryStore(f.root);store.importInitial(f.initial);let calls=0;const app=Fastify();registerRoomMemoryRoutes(app,f.root,{testOnly:true,editProvider:async()=>{calls++;return {status:'clarify',reply:'Which tag should I add?'};}});
 const body={operationId:'question',roomId:'room',nodeId:'n1',expectedRevision:0,text:'Add something'};try{const send=()=>app.inject({method:'POST',url:'/api/scan/room-memory/edit/message',payload:body});const first=await send();assert.equal(first.statusCode,200);assert.equal(first.json().status,'clarify');assert.deepEqual((await send()).json(),first.json());assert.equal(calls,1);assert.deepEqual(store.read().rooms[0].userEdits,[]);}finally{await app.close();store.close();f.cleanup();}
});

test('clarification follow-up receives only same-target unchanged context',async()=>{
 const f=fixture(),store=new RoomMemoryStore(f.root);store.importInitial(f.initial);const seen:Array<{observedLabel:string;clarification:{text:string;reply:string}|null}>=[];const app=Fastify();registerRoomMemoryRoutes(app,f.root,{testOnly:true,editProvider:async(input)=>{seen.push(input);return input.clarification?{status:'apply',reply:'Added.',changes:[{kind:'addTag',value:'repairs'}]}:{status:'clarify',reply:'Which tag?'};}});
 const send=(payload:Record<string,unknown>)=>app.inject({method:'POST',url:'/api/scan/room-memory/edit/message',payload});const base={roomId:'room',nodeId:'n2',expectedRevision:0};try{
  assert.equal((await send({...base,operationId:'ask',text:'Add a tag'})).json().status,'clarify');const result=await send({...base,operationId:'answer',text:'repairs'});assert.equal(result.statusCode,200);assert.deepEqual(result.json().view.rooms[0].userEdits[0].tags,['repairs']);assert.equal(seen[1].observedLabel,'Box');assert.equal(seen[1].clarification?.text,'Add a tag');assert.equal(seen[1].clarification?.reply,'Which tag?');
  await send({...base,nodeId:'n1',operationId:'other',text:'something'});assert.equal(seen[2].clarification,null);
 }finally{await app.close();store.close();f.cleanup();}
});

test('successive undo restores earlier undo target while revisions increase',()=>{
 const f=fixture(),store=new RoomMemoryStore(f.root);try{store.importInitial(f.initial);
  store.applyUserEdit({operationId:'a',roomId:'room',nodeId:'n1',expectedRevision:0,text:'Call it bench'},{status:'apply',reply:'Saved.',changes:[{kind:'name',value:'bench'}]});
  store.applyUserEdit({operationId:'b',roomId:'room',nodeId:'n1',expectedRevision:1,text:'Add tag tools'},{status:'apply',reply:'Saved.',changes:[{kind:'addTag',value:'tools'}]});
  const first=store.undoUserEdit({operationId:'undo-b',roomId:'room',nodeId:'n1',expectedRevision:2,revisionId:'b'}).rooms[0].userEdits![0];assert.equal(first.lastRevisionId,'a');assert.equal(first.revision,3);assert.equal(first.name,'bench');assert.deepEqual(first.tags,[]);
  const second=store.undoUserEdit({operationId:'undo-a',roomId:'room',nodeId:'n1',expectedRevision:3,revisionId:'a'}).rooms[0].userEdits![0];assert.equal(second.name,null);assert.equal(second.lastRevisionId,null);assert.equal(second.revision,4);
 }finally{store.close();f.cleanup();}
});

test('explicit containment preserves independent source dates, removal, undo and identity',()=>{
 const f=fixture();f.initial.graph.nodes.push({id:'charger',label:'Charger',kind:'portable',status:'provisional',attributes:[],evidence:f.initial.graph.nodes[1].evidence},{id:'adapter',label:'Similar adapter',kind:'portable',status:'provisional',attributes:[],evidence:f.initial.graph.nodes[1].evidence},{id:'box2',label:'Second box',kind:'container',status:'provisional',attributes:[],evidence:f.initial.graph.nodes[1].evidence});let store=new RoomMemoryStore(f.root);
 try{store.importInitial(f.initial);const put={operationId:'put',roomId:'room',expectedRevision:0,itemId:'charger',containerId:'n2',action:'put-in',statement:'I put the charger in this box'};let room=store.containment(put).rooms[0];assert.equal(room.containment!.active[0].attribution,'user');assert.equal(room.containment!.active[0].source.capturedAt,'2026-10-29T00:00:00Z');assert.equal(room.containment!.active.some(x=>x.itemId==='adapter'),false);assert.deepEqual(store.containment(put).rooms[0].containment,room.containment);assert.throws(()=>store.containment({...put,statement:'changed'}),/collision/);assert.throws(()=>store.containment({...put,operationId:'stale'}),/refresh/);assert.throws(()=>store.containment({...put,operationId:'bad',expectedRevision:1,itemId:'n1'}),/Invalid/);
  const captures=new CaptureStore(f.root),image=new PNG({width:2,height:2});image.data.fill(120);const frame=captures.import({importId:'move-capture',frames:[{id:'moved',sessionId:'session',capturedAt:'2026-11-01T00:00:00Z',imageDataUrl:`data:image/png;base64,${PNG.sync.write(image).toString('base64')}`}]}).find(frame=>frame.id==='moved')!;captures.close();
  store.importVisit({schemaVersion:1,importId:'move',roomId:'room',visitId:'move',label:'Moved',summary:'Box seen later',sourceViews:[{viewId:'moved-view',frameId:'moved',sourceHash:frame.sourceHash}],proposals:[{id:'moved-proposal',nodeId:'n2',observationId:'moved-observation',status:'likely-same',basis:'Similar box',evidence:[{viewId:'moved-view',basis:'Visible box',location:'Hall shelf'}],alternatives:'Similar box possible'}]});room=store.read().rooms[0];assert.equal(room.containment!.active[0].source.capturedAt,'2026-10-29T00:00:00Z');assert.equal(room.containment!.active[0].containerLastSeen?.capturedAt,'2026-11-01T00:00:00Z');assert.equal(room.containment!.active[0].containerLastSeen?.location,'Hall shelf');
  const remove={...put,operationId:'remove',expectedRevision:1,action:'remove',statement:'I took it out'};room=store.containment(remove).rooms[0];assert.equal(room.containment!.active.length,0);const removal=roomContainmentRemoval(room,room.graph.nodes.find(n=>n.id==='charger')!);assert.equal(removal?.containerLabel,'Box');assert.equal(removal?.itemSeenAfterRemoval,false);const found=findRoomMemory([room],{terms:['Charger']});assert.equal(found.matches[0].removal?.containerLabel,'Box');assert.equal(found.matches[0].containment,null);const later=structuredClone(room);later.graph.sourceViews[0].capturedAt='2099-01-01T00:00:00Z';later.graph.sourceViews[1].capturedAt='2099-01-01T00:00:00Z';assert.equal(roomContainmentRemoval(later,later.graph.nodes.find(n=>n.id==='charger')!)?.itemSeenAfterRemoval,true);room=store.containment({operationId:'undo',roomId:'room',expectedRevision:2,targetOperationId:'remove'},true).rooms[0];assert.equal(room.containment!.active[0].itemId,'charger');assert.equal(room.containment!.events[1].withdrawn,true);
  store.containment({operationId:'nested',roomId:'room',expectedRevision:3,itemId:'n2',containerId:'box2',action:'put-in',statement:'Box inside box'});assert.throws(()=>store.containment({operationId:'cycle',roomId:'room',expectedRevision:4,itemId:'box2',containerId:'n2',action:'put-in',statement:'Box inside box'}),/cycle/);store.close();store=new RoomMemoryStore(f.root);assert.equal(store.read().rooms[0].containment!.active.length,2);
 }finally{store.close();f.cleanup();}
});
