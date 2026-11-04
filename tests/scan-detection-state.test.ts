import test from 'node:test';
import assert from 'node:assert/strict';
import {canCheckSameDetection,DetectionHttpError,definiteDetectionRejection,detectionResponse,parseDetectionState,parseAnalysisResponse,canStartDetection,detectionLabel,type FrameAnalysis} from '../src/client/scan-detection-state.ts';
const record=(status:FrameAnalysis['status'],candidateCount=0):FrameAnalysis=>({frameId:'saved-one',status,candidateCount,placeId:status==='completed'?'one-frame-place':null,error:status==='error'?'Rejected mask':null});
test('saved-frame detection status replaces static capture status for every durable outcome',()=>{
 assert.equal(detectionLabel(),'Not analyzed');
 assert.equal(detectionLabel(record('processing')),'Detecting objects…');
 assert.equal(detectionLabel(record('completed',1)),'1 provisional candidate');
 assert.equal(detectionLabel(record('completed',3)),'3 provisional candidates');
 assert.equal(detectionLabel(record('empty')),'No objects detected');
 assert.equal(detectionLabel(record('error')),'Detection failed');
});
test('explicit detection requires a saved paused source and never repeats a known or uncertain job',()=>{
 const eligible={saved:true,enabled:true,recording:false,locked:false,uncertain:false};
 assert.equal(canStartDetection(eligible),true);
 for(const blocked of [{saved:false},{enabled:false},{recording:true},{locked:true},{uncertain:true}])assert.equal(canStartDetection({...eligible,...blocked}),false);
 for(const status of ['processing','completed','empty','error'] as const)assert.equal(canStartDetection({...eligible,existing:record(status)}),false);
 // Exhausting the provider cannot erase existing result presentation.
 assert.equal(canStartDetection({...eligible,enabled:false,existing:record('completed',3)}),false);
 assert.equal(detectionLabel(record('completed',3)),'3 provisional candidates');
});

test('definite HTTP rejection stays recoverable while network and server failures remain uncertain',async()=>{
 for(const status of [403,404,422]){
  await assert.rejects(detectionResponse(new Response('{"error":"Rejected"}',{status}),parseDetectionState),error=>definiteDetectionRejection(error));
 }
 await assert.rejects(detectionResponse(new Response('not json',{status:403}),parseDetectionState),error=>error instanceof DetectionHttpError&&definiteDetectionRejection(error));
 assert.equal(definiteDetectionRejection(new DetectionHttpError('Server failed',500)),false);
 assert.equal(definiteDetectionRejection(new TypeError('Connection lost')),false);
 assert.equal(definiteDetectionRejection(new SyntaxError('Bad JSON')),false);
});
test('detection payloads reject malformed arrays, budgets and another frame result before UI state changes',()=>{
 const state={enabled:false,reason:'Exhausted',budget:{requests:10,requestLimit:10,capUsd:0.1,reservedUsd:0.08,estimatedUsd:0.02},analyses:[record('completed',2)]};
 assert.deepEqual(parseDetectionState(state),state);
 for(const bad of [{...state,analyses:{}},{...state,analyses:[{frameId:'saved-one'}]},{...state,budget:{...state.budget,estimatedUsd:'zero'}},{...state,analyses:[{...record('completed',2),placeId:null}]}])assert.throws(()=>parseDetectionState(bad));
 assert.deepEqual(parseAnalysisResponse({analysis:record('empty')},'saved-one'),{analysis:record('empty')});
 assert.throws(()=>parseAnalysisResponse({analysis:record('empty')},'another-frame'));
 assert.throws(()=>parseAnalysisResponse({analysis:{...record('completed',2),candidateCount:-1}},'saved-one'));
});
test('uncertain requests offer an explicit same-frame check without reopening ordinary detection',()=>{
 const uncertain={saved:true,recording:false,locked:false,uncertain:true};
 assert.equal(canCheckSameDetection(uncertain),true);
 assert.equal(canCheckSameDetection({...uncertain,enabled:false} as typeof uncertain),true);
 for(const blocked of [{saved:false},{recording:true},{locked:true},{uncertain:false},{existing:record('completed',2)}])assert.equal(canCheckSameDetection({...uncertain,...blocked}),false);
 assert.equal(canStartDetection({...uncertain,enabled:true}),false);
});
