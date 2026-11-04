import test from 'node:test';
import assert from 'node:assert/strict';
import {compactRoomPacketViewIds,expandRoomPacketViewIds} from '../src/server/room-packet-view-aliases.ts';

test('ordinary packets remain exactly untouched',()=>{
 const packet={nodes:[{id:'n1',viewId:'auto-view-long-existing-id'}]};
 assert.equal(compactRoomPacketViewIds(packet),packet);
});
test('overflow view-ID aliases roundtrip losslessly without changing evidence or other IDs',()=>{
 const long='auto-view-01234567-89ab-cdef-0123-456789abcdef';
 const packet={nodes:Array.from({length:150},(_,i)=>({id:`node-${i}`,actionId:`action-${i}`,sourceHash:'f'.repeat(64),original:{viewId:long,basis:`Exact source evidence ${i}`},latest:{viewId:long}})),references:[{viewId:'@v0'},{viewId:long},{viewId:'toString'},{viewId:'constructor'}],text:long};
 const before=JSON.stringify(packet),encoded=compactRoomPacketViewIds(packet);
 assert.ok(encoded.viewIdAliases);assert.equal(encoded.viewIdAliases['@v0'],undefined);
 assert.ok(JSON.stringify(encoded).length<before.length);
 assert.equal(JSON.stringify(expandRoomPacketViewIds(encoded)),before);
 assert.equal(JSON.stringify(packet),before);
 assert.deepEqual(encoded.nodes.map(n=>[n.id,n.actionId,n.sourceHash]),packet.nodes.map(n=>[n.id,n.actionId,n.sourceHash]));
 assert.equal(encoded.text,long);
 assert.deepEqual(compactRoomPacketViewIds(packet),encoded);
});
test('uncompressible oversized packets remain oversized rather than losing fields',()=>{
 const packet={nodeId:'exact',description:'x'.repeat(18001),viewId:'once'};
 assert.equal(compactRoomPacketViewIds(packet),packet);
 assert.ok(JSON.stringify(compactRoomPacketViewIds(packet)).length>18000);
});
