import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalRoomEditProvider} from '../src/server/local-room-edit-provider.ts';
test('local text relay binds response to the fresh request and validates decision',async()=>{
 const root=mkdtempSync(join(tmpdir(),'room-edit-relay-'));try{
  const provider=createLocalRoomEditProvider(root,2000),input={roomId:'room',nodeId:'node',expectedRevision:0,text:'Name it Özel',observedLabel:'Box',clarification:null,state:{nodeId:'node',revision:0,name:null,groups:[],tags:[],lastRevisionId:null}},pending=provider(input);
  const folder=join(root,readdirSync(root)[0]),ready=JSON.parse(readFileSync(join(folder,'ready.json'),'utf8'));assert.match(readFileSync(join(folder,'prompt.txt'),'utf8'),/Özel/);assert.deepEqual(ready.responseContract,{requestHash:ready.requestHash,responseToken:ready.responseToken,provider:ready.provider,result:'decision matching schema.json'});
  writeFileSync(join(folder,'response.json'),JSON.stringify({requestHash:ready.requestHash,responseToken:ready.responseToken,provider:ready.provider,result:{status:'apply',reply:'Saved',changes:[{kind:'name',value:'Özel'}]}}));assert.equal((await pending).status,'apply');
  const second=provider(input),other=join(root,readdirSync(root).find(x=>x!==ready.requestHash)!);const r=JSON.parse(readFileSync(join(other,'ready.json'),'utf8'));writeFileSync(join(other,'response.json'),JSON.stringify({requestHash:r.requestHash,responseToken:'wrong',provider:r.provider,result:{status:'clarify',reply:'Which?'}}));await assert.rejects(second,/binding mismatch/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('local decision allowance survives provider recreation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'room-edit-limit-'));try{
  const input={roomId:'room',nodeId:'node',expectedRevision:0,text:'tag?',observedLabel:'Box',clarification:null,state:{nodeId:'node',revision:0,name:null,groups:[],tags:[],lastRevisionId:null}};
  for(let i=0;i<3;i++){const pending=createLocalRoomEditProvider(root,1000)(input);const folders=readdirSync(root),folder=folders.map(name=>join(root,name)).find(path=>!readdirSync(path).includes('response.json'))!;const ready=JSON.parse(readFileSync(join(folder,'ready.json'),'utf8'));writeFileSync(join(folder,'response.json'),JSON.stringify({requestHash:ready.requestHash,responseToken:ready.responseToken,provider:ready.provider,result:{status:'clarify',reply:'Which tag?'}}));await pending;}
  await assert.rejects(createLocalRoomEditProvider(root,1000)(input),/allowance is exhausted/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
