import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import type {CapturedFrame} from '../domain/capture-contracts.ts';
import type {RoomActionNeeded} from '../domain/room-observer-contracts.ts';
import type {VirtualCameraHandle} from './VirtualCamera.tsx';
import type {RoomAutomationController} from './RoomAutomationPanel.tsx';
import {GuidedCaptureTracker,type GuidedCaptureTracking,type NormalizedCaptureBox} from './guided-capture-tracker.ts';
import {activeRoomFollowup} from './room-memory-index.ts';
import {canStartGuidedCapture,guidedCheckState,guidedFrameJob} from './guided-capture-state.ts';
import './guided-capture.css';

type Phase='idle'|'selecting'|'tracking'|'saving'|'save-unconfirmed'|'checking'|'addressed'|'not-addressed'|'cancelled';
export type GuidedSaveResult={kind:'saved';frame:CapturedFrame}|{kind:'uncertain'|'rejected'};
type Options={camera:RefObject<VirtualCameraHandle|null>;automation:RoomAutomationController;active:boolean;ready:boolean;locked:boolean;saved:CapturedFrame[];onPrepare:()=>void;onCapture:(action:RoomActionNeeded)=>Promise<{frameId:string;result:GuidedSaveResult}|null>};
const trackingLabel=(tracking:GuidedCaptureTracking|null)=>{
 if(!tracking)return 'Select target';
 if(tracking.status==='approach'||tracking.status==='tiny')return 'Move closer';
 if(tracking.status==='hold'||tracking.status==='ready')return 'Hold steady';
 if(tracking.status==='recovering')return 'Reacquiring target';
 if(tracking.status==='lost'||tracking.status==='ambiguous')return 'Lost — select target again';
 if(tracking.status==='clipped')return 'Keep target inside the view';
 if(tracking.status==='low-detail')return 'Choose a clearer target';
 return 'Tracking target';
};
/** Only the explicit Start action arms automatic capture/save/check. No request auto-loops. */
export function useGuidedCapture(options:Options){
 const latest=useRef(options);latest.current=options;
 const [phase,setPhase]=useState<Phase>('idle'),[tracking,setTracking]=useState<GuidedCaptureTracking|null>(null),[message,setMessage]=useState('');
 const phaseRef=useRef<Phase>('idle'),tracker=useRef(new GuidedCaptureTracker()),generation=useRef(0),mounted=useRef(true);
 const action=useRef<RoomActionNeeded|null>(null),frameId=useRef(''),checkStarted=useRef(false),[checkUnconfirmed,setCheckUnconfirmed]=useState(false);
 const transition=(next:Phase)=>{phaseRef.current=next;setPhase(next);};
 const cancel=(reason='Guided capture cancelled. Start again when ready.')=>{generation.current++;tracker.current.reset();setTracking(null);setMessage(reason);transition('cancelled');};
 const start=()=>{
  const current=latest.current;
  if(!canStartGuidedCapture(current.automation.state,current.automation.followup,current.ready,current.active,current.locked)||document.hidden)return;
  generation.current++;tracker.current.reset();action.current=current.automation.followup;frameId.current='';checkStarted.current=false;setCheckUnconfirmed(false);setTracking(null);setMessage('Draw a rectangle around the requested target. Then move closer and hold steady.');current.onPrepare();transition('selecting');
 };
 const select=(box:NormalizedCaptureBox)=>{
  if(phaseRef.current!=='selecting'||!latest.current.active||document.hidden)return;
  const pixels=latest.current.camera.current?.samplePixels();
  if(!pixels){setMessage('The live pixels are unavailable. Wait for the camera and select again.');return;}
  try{const next=tracker.current.initialize(pixels,box,performance.now());setTracking(next);setMessage('');transition('tracking');}
  catch{setMessage('This target could not be selected. Draw another rectangle.');}
 };
 const reselect=()=>{if(!['tracking','selecting'].includes(phaseRef.current))return;tracker.current.reset();setTracking(null);setMessage('Draw a fresh rectangle around the same requested target.');transition('selecting');};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;tracker.current.reset();};},[]);
 useEffect(()=>{
  const stop=()=>{if(document.hidden&&['selecting','tracking','saving','save-unconfirmed','checking'].includes(phaseRef.current))cancel('Guided capture stopped while the app was hidden. Any submitted save or check may finish; read saved status before starting again.');};
  document.addEventListener('visibilitychange',stop);return()=>document.removeEventListener('visibilitychange',stop);
 },[]);
 useEffect(()=>{if(!options.active&&['selecting','tracking','saving','save-unconfirmed','checking'].includes(phaseRef.current))cancel('Guided capture stopped when you left the live view. Any submitted save or check stays in saved captures.');},[options.active]);
 useEffect(()=>{
  if(!['selecting','tracking'].includes(phaseRef.current))return;
  if(!activeRoomFollowup(options.automation.state,action.current)||!options.automation.state?.provider.enabled)cancel('The room, request or model availability changed. Choose an open request and start again.');
 },[options.automation.state]);
 useEffect(()=>{
  const focus=options.automation.followup;
  if(focus&&action.current&&focus.actionId!==action.current.actionId&&!['selecting','tracking','saving','save-unconfirmed','checking'].includes(phaseRef.current)){
   action.current=null;frameId.current='';setMessage('');setTracking(null);transition('idle');
  }
 },[options.automation.followup?.actionId]);
 useEffect(()=>{
  if(phase!=='tracking')return;
  const token=generation.current;
  const timer=setInterval(()=>{
   const current=latest.current;
   if(!mounted.current||token!==generation.current||phaseRef.current!=='tracking'||!current.active||document.hidden)return;
   if(!activeRoomFollowup(current.automation.state,action.current)||!current.automation.state?.provider.enabled){cancel('The current request is no longer available.');return;}
   try{
    const pixels=current.camera.current?.samplePixels();if(!pixels){cancel('Live pixels are unavailable. Start again after the camera loads.');return;}
    const next=tracker.current.update(pixels,performance.now());setTracking(next);
    if(next.ready&&tracker.current.consumeCapture()){
     transition('saving');setTracking(null);setMessage('Saving one suitable view…');
     void current.onCapture(action.current!).then(saved=>{
      if(!mounted.current||token!==generation.current)return;
      if(!saved){transition('not-addressed');setMessage('The view was not saved. Choose the request and try again.');return;}
      frameId.current=saved.frameId;
      if(saved.result.kind==='saved'){setMessage('Checking the saved view against this request…');transition('checking');}
      else if(saved.result.kind==='uncertain'){setMessage('Save unconfirmed. Use Retry same save below; no new capture or automatic retry will run.');transition('save-unconfirmed');}
      else {setMessage('The save was rejected. Your captured view remains in this scan.');transition('not-addressed');}
     }).catch(()=>{if(mounted.current&&token===generation.current){setMessage('Capture could not finish. No automatic retry was made.');transition('not-addressed');}});
    }
   }catch{cancel('Tracking could not continue. Start again and select the target.');}
  },150);
  return()=>clearInterval(timer);
 },[phase]);
 useEffect(()=>{
  if(!['checking','save-unconfirmed'].includes(phase)||!frameId.current||!action.current)return;
  const current=latest.current,saved=current.saved.find(item=>item.id===frameId.current);if(!saved)return;
  if(phase==='save-unconfirmed')transition('checking');
  if(current.automation.state?.declaration.roomId!==action.current.roomId){cancel('The current room changed. The saved view remains available; no further automatic check will start.');return;}
  const outcome=guidedCheckState(current.automation.state,action.current,saved);
  const savedJob=guidedFrameJob(current.automation.state,action.current,saved);
  if(savedJob&&savedJob.frameId!==saved.id){transition('not-addressed');setMessage('These pixels already belong to an earlier saved-frame check. Move to a fresh view and deliberately try another guided capture. No new check was started.');return;}
  if(outcome!=='checking'){
   transition(outcome);
   setMessage(outcome==='addressed'?'Request addressed by the saved model assessment. Object identity remains provisional.':savedJob&&['failed','interrupted','disabled'].includes(savedJob.status)?'The assessment could not be accepted. The request remains open. Review saved status before trying again.':'This view did not address the request. Review saved status, then deliberately try another view.');return;
  }
  if(savedJob){
   // A durable pending check remains valid after its model allowance is consumed.
   checkStarted.current=true;return;
  }
  if(!checkStarted.current){
   // A save can already have queued the same job. checkFrame reuses that durable result.
   if(!activeRoomFollowup(current.automation.state,action.current)||!current.automation.state?.provider.enabled){transition('not-addressed');setMessage('The request or checking model is no longer available. The view is saved.');return;}
   checkStarted.current=true;const token=generation.current;
   void current.automation.checkFrame(saved.id).then(()=>{if(mounted.current&&token===generation.current){setCheckUnconfirmed(true);void latest.current.automation.refresh();}});
  }
 },[phase,options.saved,options.automation.state]);
 const busy=['selecting','tracking','saving','save-unconfirmed','checking'].includes(phase);
 const existingJob=options.automation.state?.jobs.some(job=>job.frameId===frameId.current&&job.roomId===action.current?.roomId);
 return {phase,busy,selecting:phase==='selecting',box:phase==='tracking'&&tracking&&!['lost','ambiguous','low-detail','tiny','recovering'].includes(tracking.status)?tracking.box:null,label:trackingLabel(tracking),tracking,message,start,cancel,reselect,select,
  available:canStartGuidedCapture(options.automation.state,options.automation.followup,options.ready,options.active,options.locked),
  checkUnconfirmed:phase==='checking'&&checkUnconfirmed&&!existingJob,request:action.current?.request??options.automation.followup?.request};
}
export type GuidedCaptureController=ReturnType<typeof useGuidedCapture>;
export function GuidedCapturePanel({guide,automation}:{guide:GuidedCaptureController;automation:RoomAutomationController}){
 if(!automation.followup&&guide.phase==='idle')return null;
 return <section className="guided-capture" aria-label="Guided follow-up capture">
  <div><strong>Guided follow-up</strong><span className={`gc-phase gc-${guide.phase}`}>{guide.phase==='addressed'?'Request addressed':guide.phase==='not-addressed'?'Request still open':guide.phase==='tracking'?guide.label:guide.phase==='checking'?'Checking':guide.phase==='saving'?'Saving':guide.phase==='selecting'?'Select target':guide.phase==='save-unconfirmed'?'Save unconfirmed':guide.phase==='cancelled'?'Stopped':'Ready to guide'}</span></div>
  <p>{guide.request??automation.followup?.request}</p>
  <p role="status">{guide.message||'Select the requested target. A suitable steady view will be saved automatically and checked against this request.'}</p>
  {guide.phase==='tracking'&&guide.tracking&&<p>{guide.tracking.reason}</p>}
  {guide.checkUnconfirmed&&<p>Check not confirmed. Read the saved status before deciding what to do next.</p>}
  <div className="gc-actions">{!guide.busy&&guide.phase!=='addressed'&&<button className="ls-primary" disabled={!guide.available} onClick={guide.start}>{guide.phase==='not-addressed'?'Try another guided view':'Start guided capture'}</button>}
   {guide.phase==='tracking'&&<button onClick={guide.reselect}>Select target again</button>}
   {guide.busy&&<button onClick={()=>guide.cancel()}>Cancel guided capture</button>}
   {guide.phase==='checking'&&<button disabled={automation.loading} onClick={()=>void automation.refresh()}>Check status</button>}
  </div>
  {!guide.busy&&guide.phase!=='addressed'&&!automation.state?.provider.enabled&&<p>{automation.state?.provider.reason??'A checking model must be available before starting.'}</p>}
  <small>Starting allows one automatic save and one room-memory check with the available model. Tracking is based on pixels; the box is not an identity claim.</small>
 </section>;
}
