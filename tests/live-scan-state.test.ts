import test from 'node:test';
import assert from 'node:assert/strict';
import {CAPTURE_BODY_LIMIT} from '../src/domain/capture-contracts.ts';
import {CaptureHttpError,captureResponse,captureImportFits,definiteCaptureRejection} from '../src/client/live-scan-state.ts';
test('capture responses require durable source metadata, never candidate-like placeholders',()=>{
 assert.throws(()=>captureResponse({frames:[{id:'one'}]}));
 assert.throws(()=>captureResponse({}));
 const data={frames:[{id:'a',sessionId:'s',capturedAt:'2026-10-28T20:00:00Z',sourceHash:'hash',width:1280,height:720,imageUrl:'/api/scan/captures/assets/hash',analysisStatus:'not-analyzed'}]};
 assert.deepEqual(captureResponse(data),data);
});
test('only definite HTTP client rejection unlocks the import selection',()=>{
 for(const status of [400,409,413])assert.equal(definiteCaptureRejection(new CaptureHttpError('Rejected',status)),true);
 assert.equal(definiteCaptureRejection(new CaptureHttpError('Failure',500)),false);
 assert.equal(definiteCaptureRejection(new TypeError('Lost reply')),false);
 assert.equal(definiteCaptureRejection(new SyntaxError('Malformed reply')),false);
});
test('oversized selections are rejected before posting without dropping buffered sources',()=>{
 const body={importId:'i',frames:[{id:'a',sessionId:'s',capturedAt:'2026-10-28T20:00:00Z',imageDataUrl:'png'}]};
 assert.equal(captureImportFits(body),true);
 body.frames[0].imageDataUrl='x'.repeat(CAPTURE_BODY_LIMIT);
 assert.equal(captureImportFits(body),false);
 assert.equal(body.frames.length,1);
});

test('capture response preserves valid source provenance and rejects unknown values',()=>{
 const frame={id:'one',sessionId:'s',capturedAt:'now',sourceHash:'hash',imageUrl:'/image',width:1,height:1,analysisStatus:'not-analyzed',sourceKind:'device-camera'};
 assert.equal(captureResponse({frames:[frame]}).frames[0].sourceKind,'device-camera');
 assert.throws(()=>captureResponse({frames:[{...frame,sourceKind:'other'}]}));
});
