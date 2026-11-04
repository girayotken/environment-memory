import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeEmptyScanWorkspace} from '../src/server/empty-scan-workspace.ts';
import {createScanReviewApp} from '../src/server/scan-review.ts';

test('empty workspace opens without evidence and cannot overwrite an existing workspace',async()=>{
 const parent=mkdtempSync(join(tmpdir(),'empty-scan-')),root=join(parent,'workspace');
 try{initializeEmptyScanWorkspace(root);const manifest=readFileSync(join(root,'scan-review-manifest.json'),'utf8');assert.deepEqual(JSON.parse(manifest).cards,[]);assert.throws(()=>initializeEmptyScanWorkspace(root),/exist/i);assert.equal(readFileSync(join(root,'scan-review-manifest.json'),'utf8'),manifest);const app=createScanReviewApp(root);try{await app.ready();const response=await app.inject('/api/scan/room-memory');assert.deepEqual(response.json(),{rooms:[]});}finally{await app.close();}}finally{rmSync(parent,{recursive:true,force:true});}
});
