import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DemoBudget} from '../src/server/demo-budget.ts';
import {LabContinuationBudget} from '../src/server/lab-continuation-budget.ts';
import {ROOM_OBSERVER_LIMITS,roomObserverCost} from '../src/server/room-observer-budget.ts';
const original={authorizationId:'meta_box_protocol_lab_20261103',capUsd:1,requestLimit:24,frameLimit:3,outputTokens:4096};
test('continuation preserves baseline and bounds two four-request frames',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lab-budget-'));
 try{
  const old=new DemoBudget(dir,original),insert=old.db.prepare("INSERT INTO requests(source_hash,kind,status,reserved,estimated,receipt) VALUES(?,'count','completed',?,0,'{}')");for(let i=0;i<24;i++)insert.run(String(i),.700416/24);const baseline=JSON.stringify(old.receipts());old.close();
  let b=new LabContinuationBudget(dir);assert.equal(JSON.stringify(b.receipts()),baseline);assert.equal(b.snapshot().requestLimit,32);b.preflight(4);
  const count=roomObserverCost(ROOM_OBSERVER_LIMITS.inputTokens,0),generate=roomObserverCost(ROOM_OBSERVER_LIMITS.inputTokens,4096);
  for(let n=1;n<=2;n++){
   const sourceHash=String(n).repeat(64),frameId=`frame-${n}`;b.claim(frameId,sourceHash);
   for(let i=0;i<4;i++){const kind=i%2?'generate':'count',requestHash=String(5+Math.floor(i/2)).repeat(64),receipt={sourceHash,frameId,requestHash,stage:i<2?'compare':'encode'};if(i===0)assert.throws(()=>b.reserve(sourceHash,'generate',generate,receipt));const id=b.reserve(sourceHash,kind,kind==='count'?count:generate,receipt);b.record(id,receipt);b.finish(id,0);}
   b.finishFrame(sourceHash,'completed');
  }
  assert.equal(b.snapshot().requests,32);assert.ok(b.snapshot().reservedUsd<1);assert.throws(()=>b.claim('frame-3','3'.repeat(64)));b.close();
  b=new LabContinuationBudget(dir);assert.equal(b.snapshot().requests,32);assert.equal(JSON.stringify(b.receipts().slice(0,24)),baseline);b.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('regular budget rejects a four-request preflight before claiming a frame',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lab-preflight-'));
 try{const b=new DemoBudget(dir,{...original,authorizationId:'other_test_policy',capUsd:.1});assert.throws(()=>b.preflight(4));assert.equal(b.snapshot().requests,0);b.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
