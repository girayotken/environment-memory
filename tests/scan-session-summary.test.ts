import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scanSessionSummary} from '../src/client/scan-session-summary.ts';
import type {RoomAutomationJob} from '../src/domain/room-observer-contracts.ts';

const job=(frameId:string,sourceHash:string,status:RoomAutomationJob['status']):RoomAutomationJob=>({jobId:frameId,roomId:'room',frameId,sourceHash,status,trigger:'capture',provenance:'agent-derived',provider:'test',createdAt:'2026-10-30T00:00:00Z',updatedAt:'2026-10-30T00:00:00Z',error:null,visitId:null});
test('a prior published job cannot claim a new scan updated memory',()=>{
 assert.deepEqual(scanSessionSummary(['new'],[{id:'new',sourceHash:'new-hash'}],[job('old','old-hash','published')],'room'),{saved:1,updated:0,checking:0,failed:0,unchecked:1,reused:0});
 assert.equal(scanSessionSummary(['new'],[{id:'new',sourceHash:'new-hash'}],[job('new','wrong-hash','published')],'room').updated,0);
});
test('mixed saved-view outcomes remain separate from unsaved buffers',()=>{
 const saved=['a','b','c','d'].map(id=>({id,sourceHash:id}));
 assert.deepEqual(scanSessionSummary(['a','b','c','d','unsaved'],saved,[job('a','a','published'),job('b','b','running'),job('c','c','failed')],'room'),{saved:4,updated:1,checking:1,failed:1,unchecked:1,reused:0});
 assert.deepEqual(scanSessionSummary([],saved,[job('a','a','published')],'room'),{saved:0,updated:0,checking:0,failed:0,unchecked:0,reused:0});
});

test('identical previously published source is reused only for selected room',()=>{const previous={...job('old','same','published'),visitId:'visit'};const saved=[{id:'new',sourceHash:'same'}];assert.equal(scanSessionSummary(['new'],saved,[previous],'room').reused,1);assert.equal(scanSessionSummary(['new'],saved,[previous],'other').unchecked,1);assert.equal(scanSessionSummary(['new'],saved,[previous],null).unchecked,1);});
