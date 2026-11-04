import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonRequest,encodeWithComparison} from '../src/server/room-observer-compare.ts';
import type {roomObserverRequest} from '../src/server/room-observer-provider.ts';
function request(nodes:any[],scope?:string[]){return {model:'muse-spark-1.3',input:[{role:'developer',content:'existing instructions'},{role:'user',content:[{type:'input_text',text:JSON.stringify({memory:{nodes,...(scope?{comparisonNodeIds:scope}:{})}})},{type:'input_text',text:'CURRENT'},{type:'input_image',image_url:'current',detail:'auto'},{type:'input_text',text:'HISTORY'},{type:'input_image',image_url:'history',detail:'auto'}]}],text:{format:{name:'original',schema:{}}}} as unknown as ReturnType<typeof roomObserverRequest>;}
const nodes=[{id:'n1',label:'Box',kind:'container',allowedComparisonSourceHashes:['s1']},{id:'n2',label:'Tool',kind:'portable',allowedComparisonSourceHashes:['s1']},{id:'n3',label:'Unbound',kind:'portable',allowedComparisonSourceHashes:[]}];
const result=(ids:string[])=>JSON.stringify({summary:'uncertain',comparisons:ids.map(memory_id=>({memory_id,current_location:'',relationship:'uncertain',matching_visible_features:'',contradictions_or_limits:'not visible',needs_more_view:false}))});
test('comparison uses bound candidates, original pixels, and respects requested scope',()=>{
 const original=request(nodes,['n2','n3']),comparison=comparisonRequest(original)!;
 const content=comparison.input[1].content as any[];assert.equal(content[1].image_url,'history');assert.equal(content.at(-1).image_url,'current');
 assert.deepEqual(JSON.parse(content[2].text).candidates.map((x:any)=>x.id),['n2']);
 const encoded=encodeWithComparison(original,result(['n2']),comparison),parts=encoded.input[1].content as any[];
 assert.equal(JSON.parse(parts.at(-1).text).type,'untrusted_prior_model_comparison');assert.equal((original.input[1].content as any[]).length,5);
});
test('no bound history skips comparison; malformed or foreign decisions fail closed',()=>{
 assert.equal(comparisonRequest(request([nodes[2]])),null);
 const original=request(nodes),comparison=comparisonRequest(original)!;
 assert.throws(()=>encodeWithComparison(original,result(['n1','n1']),comparison),/Invalid prior comparison/);
 assert.throws(()=>encodeWithComparison(original,result(['n1','other']),comparison),/Invalid prior comparison/);
 assert.throws(()=>encodeWithComparison(original,'not json',comparison));
});
test('candidate limit is explicit and correction, continuity and view aliases survive',()=>{
 const many=Array.from({length:20},(_,i)=>({id:`n${i}`,label:`item ${i}`,kind:'container',allowedComparisonSourceHashes:['s1'],latest:{viewId:'@v0'},continuity:{links:[{state:'withdrawn'}]}}));
 const original=request(many),content=original.input[1].content as any[],packet=JSON.parse(content[0].text);packet.memory.viewIdAliases={'@v0':'actual-view'};packet.memory.viewIdAliasEncoding='Map aliases';packet.memory.continuityCorrections=[{nodeId:'n19',separatedNodeId:'n18',blockedSourceHashes:['s1']}];packet.memory.followup={focalNodeIds:['n17']};content[0].text=JSON.stringify(packet);
 const comparison=comparisonRequest(original)!,part=(comparison.input[1].content as any[]).find(x=>x.type==='input_text'&&x.text.startsWith('{"type":"untrusted_candidates"')),context=JSON.parse(part.text);
 assert.equal(context.candidates.length,16);assert.deepEqual(context.candidates.slice(0,3).map((n:any)=>n.id),['n17','n18','n19']);assert.equal(context.selection.eligibleCount,20);assert.equal(context.selection.omittedCandidateIds.length,4);assert.equal(context.viewIdAliases['@v0'],'actual-view');assert.equal(context.continuityCorrections[0].nodeId,'n19');assert.equal(context.candidates[0].continuity.links[0].state,'withdrawn');assert.match(comparison.input[0].content as string,/allowedComparisonSourceHashes/);
});

test('v3 general output omits historical-only candidates while explicit scope remains exact',()=>{
 const original=request(nodes),comparison=comparisonRequest(original)!,output=result(['n1','n2']);
 const current=encodeWithComparison(original,output,comparison),v2=encodeWithComparison(original,output,comparison,2),v1=encodeWithComparison(original,output,comparison,1);
 assert.match(current.input[0].content as string,/Omit historical candidates that are not currently visible/);assert.match(current.input[0].content as string,/exactly one observation per requested node/);assert.match(current.input[0].content as string,/few salient features/);assert.doesNotMatch(v2.input[0].content as string,/Omit historical candidates/);assert.doesNotMatch(v1.input[0].content as string,/needs is view or explanation/);
});
test('v4 historical allowlist never requires the current source; v3 remains reconstructible',()=>{
 const original=request(nodes),comparison=comparisonRequest(original)!,output=result(['n1','n2']);
 const v4=encodeWithComparison(original,output,comparison),v3=encodeWithComparison(original,output,comparison,3);
 assert.match(v4.input[0].content as string,/restricts historical comparison citations/);assert.match(v4.input[0].content as string,/CURRENT source is a new observation/);assert.match(v4.input[0].content as string,/absence from that list is normal/);assert.doesNotMatch(v3.input[0].content as string,/absence from that list is normal/);
});
