import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeCapture } from '../src/domain/contracts.ts';
import { Store } from '../src/server/store.ts';
import { ECONOMY, estimatedCost, conservativeReservation } from '../src/server/economy.ts';
import { observeLive, type MetaTransport } from '../src/server/observer.ts';

// Signature-only image is sufficient for a stub transport; never sent to Meta.
const image = { bytes: Buffer.from([137,80,78,71,13,10,26,10]), mime: 'image/png' };
const capture = () => makeCapture({ imageDataUrl: `data:image/png;base64,${image.bytes.toString('base64')}`, width: 64, height: 64 }, 'bench');
const temp = () => mkdtempSync(join(tmpdir(), 'environment-economy-'));
async function withTestConfig(action: () => Promise<void>) {
  const keys = ['MODEL_API_KEY', 'META_MODEL', 'ENABLE_LIVE_META_API', 'META_CREDITS_CONFIRMED'] as const;
  const previous = keys.map(key => process.env[key]);
  [process.env.MODEL_API_KEY,process.env.META_MODEL,process.env.ENABLE_LIVE_META_API,process.env.META_CREDITS_CONFIRMED] = ['not-a-real-key',ECONOMY.model,'true','true'];
  try { await action(); } finally { keys.forEach((key,index) => { if(previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }); }
}
test('cost estimate counts cached input separately and does not add reasoning twice', () => {
  assert.equal(estimatedCost(1000, 500, 200), (800*1.25+200*.15+500*4.25)/1_000_000);
  assert.throws(() => estimatedCost(100, 10, 101)); assert.throws(() => conservativeReservation(4097));
  assert.ok(conservativeReservation(4096)*3 < ECONOMY.budgetUsd);
});
test('reservations survive reopen and failures, reject duplicate frame, and stop after three calls', () => {
  const directory=temp();let store=new Store(directory);
  try {
    const first=store.saveFrame(capture()), attempt=store.reserveLiveAttempt(first.id,1000);
    attempt.status='provider_error';store.finishLiveAttempt(attempt);
    assert.throws(()=>store.reserveLiveAttempt(first.id,1000));
    store.close();store=new Store(directory);
    assert.equal(store.liveAttempts()[0].status,'provider_error');
    for(let i=0;i<2;i++)store.reserveLiveAttempt(store.saveFrame(capture()).id,4096);
    assert.throws(()=>store.reserveLiveAttempt(store.saveFrame(capture()).id,1000),/budget/);
    assert.equal(store.liveAttempts().length,3);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
test('measured pipeline logs actual usage and retains incomplete charge reservation without partial memory', async()=>withTestConfig(async()=>{
  const directory=temp(),store=new Store(directory);let generates=0;
  const transport:MetaTransport={count:async()=>1200,generate:async()=>{
    generates++;return {id:'stub-response',model:ECONOMY.model,status:'incomplete',output_text:'{"truncated":',
      usage:{input_tokens:800,output_tokens:1600,total_tokens:2400,input_tokens_details:{cached_tokens:100},output_tokens_details:{reasoning_tokens:1200}}};
  }};
  try{
    const frame=store.saveFrame(capture());
    await assert.rejects(()=>observeLive(frame,image,store,transport),/partial/);
    await assert.rejects(()=>observeLive(frame,image,store,transport),/already ran/);
    assert.equal(generates,1);assert.equal(store.findRun(frame.id,'live'),null);
    const attempt=store.liveAttempts()[0];assert.equal(attempt.status,'incomplete');assert.equal(attempt.usage.reasoningTokens,1200);
    assert.equal(attempt.usage.visibleOutputTokens,400);assert.equal(attempt.usage.estimatedCostUsd,estimatedCost(800,1600,100));
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
}));
test('complete validated output carries usage into live memory; oversize and high-token tests never generate',async()=>withTestConfig(async()=>{
  const directory=temp(),store=new Store(directory);let generates=0;
  const transport:MetaTransport={count:async()=>1000,generate:async()=>{generates++;return{id:'stub-complete',model:ECONOMY.model,status:'completed',
    output_text:JSON.stringify({summary:'Transport stub, not visual inference',objects:[]}),usage:{input_tokens:700,output_tokens:200,total_tokens:900,output_tokens_details:{reasoning_tokens:80}}};}};
  try{
    const frame=store.saveFrame(capture());
    await assert.rejects(()=>observeLive({...frame,width:641},image,store,transport),/capture size/);
    await assert.rejects(()=>observeLive(frame,image,store,{...transport,count:async()=>5000}),/limit/);
    assert.equal(generates,0);assert.equal(store.liveAttempts().length,0);
    const run=await observeLive(frame,image,store,transport);store.saveRun(run);
    assert.equal(run.mode,'live');assert.equal(run.usage.inputTokens,700);assert.equal(run.usage.reasoningTokens,80);
    assert.equal(store.liveAttempts()[0].status,'completed');assert.equal(store.findRun(frame.id,'live')?.id,run.id);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
}));
