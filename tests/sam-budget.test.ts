import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reserveSamCost, samUsageCost, type SamAttempt } from '../src/server/sam-budget.ts';
test('SAM uses media units and retains failed/uncertain reservations', () => {
  assert.equal(reserveSamCost([],'image',1),.0025);
  assert.equal(reserveSamCost([],'video',16),.01);
  const previous: SamAttempt[] = Array.from({length:3},()=>({media:'image',frames:1,reservedUsd:.0025,status:'failed'}));
  assert.throws(()=>reserveSamCost(previous,'image',1),/exhausted/);
  assert.throws(()=>reserveSamCost([{media:'video',frames:16,reservedUsd:.008,status:'reserved'}],'image',1),/exhausted/);
  for (const n of [0,17,1.5,NaN]) assert.throws(()=>reserveSamCost([],'video',n),/Invalid/);
  assert.throws(()=>reserveSamCost([],'image',2),/Invalid/);
});
test('SAM video reserves its 50-frame minimum, then reconciles provider usage', () => {
  assert.equal(samUsageCost('video',{video_frames_processed:50}),.01);
  assert.equal(samUsageCost('image',{images_processed:1,total_tokens:0}),.0025);
  const image: SamAttempt = {media:'image',frames:1,reservedUsd:.0025,status:'completed'};
  assert.throws(()=>reserveSamCost([image],'video',16),/exhausted/);
  const underReserved: SamAttempt = {media:'video',frames:16,reservedUsd:.0032,usageEstimatedCostUsd:.01,status:'completed'};
  assert.throws(()=>reserveSamCost([underReserved],'image',1),/exhausted/);
  assert.throws(()=>samUsageCost('video',{total_tokens:0}),/missing/);
});
