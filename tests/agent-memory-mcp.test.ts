import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import Fastify from 'fastify';
import {PNG} from 'pngjs';
import {CaptureStore} from '../src/server/capture-store.ts';
import {RoomMemoryStore} from '../src/server/room-memory-store.ts';
import {registerAgentMemoryApi} from '../src/server/agent-memory-api.ts';
import {localMemoryOrigin} from '../src/server/agent-memory-mcp.ts';

test('MCP bridge accepts only explicit local origins',()=>{
 assert.equal(localMemoryOrigin('http://127.0.0.1:7430'),'http://127.0.0.1:7430');
 for(const origin of ['https://example.com','http://127.0.0.1.evil.test','http://user:secret@localhost','http://localhost/api','file:///tmp','http://localhost?url=evil'])assert.throws(()=>localMemoryOrigin(origin));
});

test('real MCP stdio reads, edits, retries, undoes and retrieves a hash-bound image without a model',async()=>{
 const root=mkdtempSync(join(tmpdir(),'memory-mcp-')),captures=new CaptureStore(root),store=new RoomMemoryStore(root),app=Fastify();
 const png=new PNG({width:2,height:2});png.data.fill(255);const bytes=PNG.sync.write(png);
 const [frame]=captures.import({importId:'capture',frames:[{id:'f1',sessionId:'s1',capturedAt:'2026-10-31T00:00:00Z',imageDataUrl:`data:image/png;base64,${bytes.toString('base64')}`}]});
 const sourceViews=[{viewId:'v1',frameId:frame.id,sourceHash:frame.sourceHash},{viewId:'v2',frameId:frame.id,sourceHash:frame.sourceHash}],evidence=sourceViews.map(v=>({viewId:v.viewId,basis:'Visible tool',location:'On the workbench'}));
 store.importInitial({schemaVersion:1,importId:'seed',roomId:'room',label:'Workshop',graph:{scope:'Test room',sourceViews,nodes:[{id:'drill',label:'Drill',kind:'portable',status:'provisional',attributes:['teal'],evidence}],edges:[],identityGroups:[{nodeId:'drill',viewIds:['v1','v2'],status:'provisional',basis:'Matching tool',alternatives:'A similar tool is possible',evidence}],unknowns:[],nodeOrigins:{drill:[]},reviewNotes:[]}});
 registerAgentMemoryApi(app,store);
 app.get<{Params:{hash:string}}>('/api/scan/room-memory/assets/:hash',(req,reply)=>{const b=store.asset(req.params.hash);return b?reply.type('image/png').send(b):reply.code(404).send({error:'Unknown source'});});
 const address=await app.listen({host:'127.0.0.1',port:0});
 const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx',resolve('scripts/memory-mcp.ts')],cwd:resolve('.'),env:{...Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>typeof e[1]==='string')),ENVIRONMENT_MEMORY_URL:address},stderr:'pipe'});
 const client=new Client({name:'memory-test',version:'1.0.0'});
 const call=async(name:string,args:Record<string,unknown>)=>client.callTool({name,arguments:args});
 const data=(result:Awaited<ReturnType<typeof call>>)=>{assert.ok(!result.isError,JSON.stringify(result));const block=result.content?.[0];assert.equal(block?.type,'text');return JSON.parse((block as {text:string}).text);};
 try{
  await client.connect(transport);
  const list=await client.listTools();assert.deepEqual(list.tools.map(t=>t.name).sort(),['memory_edit','memory_image','memory_read','memory_undo']);
  const resources=await client.listResources();assert.equal(resources.resources[0].uri,'memory://guide');assert.ok((await client.readResource({uri:'memory://guide'})).contents.length);
  const found=data(await call('memory_read',{op:'find',term:'drill'}));assert.equal(found.items[0].nodeId,'drill');assert.equal(found.items[0].lastSeen.source.sourceHash,frame.sourceHash);
  const edit={operationId:'edit-1',roomId:'room',nodeId:'drill',expectedRevision:0,text:'Call it my model drill and tag repairs',changes:[{kind:'name',value:'my model drill'},{kind:'addTag',value:'repairs'}]};
  assert.equal(data(await call('memory_edit',edit)).revision,1);assert.equal(data(await call('memory_edit',edit)).revision,1);
  assert.equal(data(await call('memory_read',{op:'object',roomId:'room',nodeId:'drill'})).personal.name,'my model drill');
  const conflict=await call('memory_edit',{...edit,operationId:'stale'});assert.equal(conflict.isError,true);
  assert.equal((await call('memory_read',{op:'object',roomId:'other',nodeId:'drill'})).isError,true);
  assert.equal(data(await call('memory_undo',{operationId:'undo-1',roomId:'room',nodeId:'drill',expectedRevision:1,revisionId:'edit-1'})).revision,2);
  assert.equal(data(await call('memory_read',{op:'object',roomId:'room',nodeId:'drill'})).personal.name,null);
  const image=await call('memory_image',{sourceHash:frame.sourceHash});assert.ok(!image.isError);assert.equal(image.content?.[0].type,'image');
  assert.equal((await call('memory_image',{sourceHash:'0'.repeat(64)})).isError,true);
 }finally{await client.close();await transport.close();await app.close();captures.close();store.close();rmSync(root,{recursive:true,force:true});}
});
