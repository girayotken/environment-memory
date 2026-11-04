import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonRequest,encodeWithComparison,validateComparisonOutcomes} from '../src/server/room-observer-compare.ts';
const request=()=>({input:[{content:'old'},{content:[{type:'input_text',text:JSON.stringify({memory:{nodes:[{id:'box',allowedComparisonSourceHashes:['old']},{id:'hidden',allowedComparisonSourceHashes:['other']}]}})},{type:'input_text',text:'CURRENT'},{type:'input_image',image_url:'now'},{type:'input_text',text:'HISTORICAL'},{type:'input_image',image_url:'past'}]}],text:{format:{schema:{required:[],properties:{}}}}}) as any;
const prior=JSON.stringify({summary:'A plausible box; hidden item not visible.',comparisons:[{memory_id:'box',current_location:'shelf',relationship:'likely_same',matching_visible_features:'front clasp',contradictions_or_limits:'lid closed',needs_more_view:false},{memory_id:'hidden',current_location:'',relationship:'uncertain',matching_visible_features:'',contradictions_or_limits:'not visible',needs_more_view:false}]});
function result(){return {observations:[{nodeId:'box',status:'likely-same',location:'shelf',features:[{visible:true}],comparison:{priorSourceHashes:['old']}}],comparisonOutcomes:[{memory_id:'box',outcome:'retain',observationIndex:0,reason:'CURRENT clasp agrees with HISTORICAL old; lid now closed.',priorSourceHashes:['old']},{memory_id:'hidden',outcome:'not-visible',observationIndex:null,reason:'Not visible in CURRENT.',priorSourceHashes:[]}]};}
const validate=(raw:any)=>validateComparisonOutcomes(JSON.stringify(raw),comparisonRequest(request(),5)!,prior);
test('retained probable identity uses linked visible evidence and omits historical-only observations',()=>{
 const raw=result(),decoded=JSON.parse(validate(raw));assert.equal(decoded.observations.length,1);assert.equal(decoded.observations[0].nodeId,'box');assert.equal(decoded.comparisonOutcomes,undefined);assert.equal(raw.comparisonOutcomes.length,2);
});
test('wrong stage-one match may be revised to unmatched uncertain without forced merge',()=>{
 const raw=result();raw.observations[0].nodeId=null as any;raw.observations[0].status='uncertain';raw.observations[0].comparison.priorSourceHashes=[];raw.comparisonOutcomes[0].outcome='revise';raw.comparisonOutcomes[0].reason='CURRENT hardware differs from visible front hardware in HISTORICAL old.';
 assert.equal(JSON.parse(validate(raw)).observations[0].nodeId,null);
});
test('silent drop, invalid index, duplicate outcome and unrelated historical citations fail',()=>{
 const drop=result();drop.observations[0].nodeId=null as any;drop.observations[0].status='uncertain';assert.throws(()=>validate(drop),/retained decision changed/);
 const missing=result();missing.comparisonOutcomes.pop();assert.throws(()=>validate(missing),/every candidate/);
 const duplicate=result();duplicate.comparisonOutcomes[1]=duplicate.comparisonOutcomes[0];assert.throws(()=>validate(duplicate),/repeated candidate/);
 const index=result();index.comparisonOutcomes[0].observationIndex=2;assert.throws(()=>validate(index),/observation index/);
 const source=result();source.comparisonOutcomes[0].priorSourceHashes=['other'];assert.throws(()=>validate(source),/belong to candidate/);
 const now=result();now.comparisonOutcomes[0].priorSourceHashes=['now'];assert.throws(()=>validate(now),/belong to candidate/);
 const noReason=result();noReason.comparisonOutcomes[0].reason=' ';assert.throws(()=>validate(noReason),/evidence reason/);
});
test('revision requires actual change and sources agree with assigned observation',()=>{
 const raw=result();raw.comparisonOutcomes[0].outcome='revise';assert.throws(()=>validate(raw),/must change/);
 const sources=result();sources.observations[0].comparison.priorSourceHashes=[];assert.throws(()=>validate(sources),/linked observation comparison/);
 const unseen=result();unseen.comparisonOutcomes[0].outcome='not-visible';assert.throws(()=>validate(unseen),/unseen candidate/);
 const reassigned=result();reassigned.observations[0].nodeId='hidden';assert.throws(()=>validate(reassigned),/different assigned candidate/);
});
test('stage-one uncertainty cannot silently promote; explicit evidence-backed revision may',()=>{
 const uncertain=JSON.parse(prior);uncertain.comparisons[0].relationship='uncertain';const raw=result(),compare=comparisonRequest(request(),5)!;
 assert.throws(()=>validateComparisonOutcomes(JSON.stringify(raw),compare,JSON.stringify(uncertain)),/retained decision changed/);
 raw.comparisonOutcomes[0].outcome='revise';assert.doesNotThrow(()=>validateComparisonOutcomes(JSON.stringify(raw),compare,JSON.stringify(uncertain)));
});
test('explicit unseen candidate can link a nonvisible scoped observation without refreshing visible history',()=>{
 const raw=result();raw.observations.push({nodeId:'hidden',status:'uncertain',location:null as any,features:[{visible:false}],comparison:{priorSourceHashes:[]}});raw.comparisonOutcomes[1].observationIndex=1;assert.doesNotThrow(()=>validate(raw));
});
test('v5 adds bounded audit and separate hardware inspection while v4 request bytes stay reconstructible',()=>{
 const base=request(),legacy=comparisonRequest(base)!,modern=comparisonRequest(base,5)!;
 assert.deepEqual(legacy,comparisonRequest(base,4));assert.doesNotMatch(legacy.input[0].content as string,/front fasteners/);assert.match(modern.input[0].content as string,/CURRENT and each HISTORICAL/);
 const v4=encodeWithComparison(base,prior,legacy,4),v5=encodeWithComparison(base,prior,modern,5);assert.deepEqual(encodeWithComparison(base,prior,legacy),v4);assert.doesNotMatch(v4.input[0].content as string,/comparisonOutcomes/);assert.match(v5.input[0].content as string,/never retain it merely because stage one said so/);assert.match(v5.input[0].content as string,/On-shelf is support, not containment/);assert.equal((v5.text.format.schema as any).properties.comparisonOutcomes.maxItems,16);assert.equal((v5.text.format.schema as any).properties.comparisonOutcomes.items.properties.reason.maxLength,240);
});
test('a revised unmatched index cannot conceal an extra assignment to the rejected candidate',()=>{
 const raw=result();raw.observations.push(structuredClone(raw.observations[0]));raw.observations[0].nodeId=null as any;raw.observations[0].status='uncertain';raw.comparisonOutcomes[0].outcome='revise';assert.throws(()=>validate(raw),/must match its audit index/);
});
test('rejecting likely-same as not-visible needs historical evidence without forcing a merge',()=>{
 const raw=result();raw.observations=[];raw.comparisonOutcomes[0].outcome='not-visible';raw.comparisonOutcomes[0].observationIndex=null as any;raw.comparisonOutcomes[0].reason='Historical box appears only in old; CURRENT contains no visible corresponding object.';raw.comparisonOutcomes[0].priorSourceHashes=[];assert.throws(()=>validate(raw),/requires historical evidence/);
 raw.comparisonOutcomes[0].priorSourceHashes=['old'];assert.equal(JSON.parse(validate(raw)).observations.length,0);
});
test('v6 confines rejected history to audit for unmatched observations, preserving exact v5 prefix and schema',()=>{
 const base=request(),compare=comparisonRequest(base,5)!;
 const v5=encodeWithComparison(base,prior,compare,5),v6=encodeWithComparison(base,prior,compare,6);
 assert.ok((v6.input[0].content as string).startsWith(v5.input[0].content as string));
 assert.doesNotMatch(v5.input[0].content as string,/When nodeId is null/);
 assert.match(v6.input[0].content as string,/comparison\.priorSourceHashes=\[\], comparison\.adequateDiscriminatingEvidence=false/);
 assert.match(v6.input[0].content as string,/every features\[\]\.comparisons=\[\]/);
 assert.match(v6.input[0].content as string,/only in comparisonOutcomes/);
 assert.deepEqual(v6.text,v5.text);assert.deepEqual(v6.input[1],v5.input[1]);
});
