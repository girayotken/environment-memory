import {useEffect,useRef,useState} from 'react';
import type {AgentStatus,AgentTurn,ScanAgentRequest} from '../domain/scan-agent-contracts.ts';
import type {ScanReviewView} from '../domain/scan-review-contracts.ts';
import './scan-agent.css';

interface Props {placeId:string;view:ScanReviewView|null;selected:string[];groupId:string;locked:boolean;historical:boolean;onBusy:(busy:boolean)=>void;onGroupChange:(id:string)=>void;onApplied:(view:ScanReviewView,notice:string)=>void;onConflict:()=>Promise<void>}
const labels:Record<AgentTurn['status'],string>={processing:'Waiting for response',applied:'Saved',clarify:'Clarification needed',error:'Not applied',stale:'Record changed · not applied'};
interface UndoRequest {turnId:string;placeId:string;expectedRevision:number}
const signature=(ids:string[],groupId:string)=>JSON.stringify([ids,groupId]);

export function ScanAgentPanel({placeId,view,selected,groupId,locked,historical,onBusy,onGroupChange,onApplied,onConflict}:Props){
 const [status,setStatus]=useState<AgentStatus|null>(null),[turns,setTurns]=useState<AgentTurn[]>([]),[message,setMessage]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false),[fetching,setFetching]=useState(false),[retry,setRetry]=useState<ScanAgentRequest|null>(null),[undoing,setUndoing]=useState<string|null>(null),[undoRetry,setUndoRetry]=useState<UndoRequest|null>(null);
 const undoInFlight=useRef(false);
 const current=useRef({placeId,view,selected,groupId});current.current={placeId,view,selected,groupId};
 const sequence=useRef(0),replyContext=useRef<{id:string;scope:string;placeId:string}|null>(null),previousScope=useRef('');
 const scope=signature(selected,groupId);
 if(previousScope.current!==`${placeId}:${scope}`){previousScope.current=`${placeId}:${scope}`;replyContext.current=null;}
 async function refresh(){if(!placeId)return;const token=++sequence.current;setFetching(true);try{const res=await fetch(`/api/scan/agent?placeId=${encodeURIComponent(placeId)}`);if(!res.ok)throw new Error('Could not load assistant history.');const next=await res.json() as AgentStatus;if(token!==sequence.current||current.current.placeId!==placeId)return;setStatus(next);setTurns(next.turns);setError('');}catch(e){if(token===sequence.current)setError(e instanceof Error?e.message:'Could not load the assistant.');}finally{if(token===sequence.current)setFetching(false);}}
 useEffect(()=>{setStatus(null);setTurns([]);setError('');void refresh();return()=>{sequence.current++;};},[placeId,view?.revision]);
 const targetIds=retry?.placeId===placeId?retry.selectedCandidateIds:selected;
 const targets=targetIds.map(id=>view?.cards.find(card=>card.candidateId===id)).filter(card=>!!card);
 const groups=view?.claims.groups??[],group=groups.find(g=>g.id===groupId);
 const names=new Map(view?.claims.objects.map(claim=>[claim.candidateId,claim.userLabel])??[]);
 const processing=turns.some(turn=>turn.status==='processing');
 useEffect(()=>{onBusy(sending||processing||!!undoing);},[sending,processing,undoing,onBusy]);
 const retryHere=!!retry&&retry.placeId===placeId;
 const remainingTurns=status?Math.max(0,Math.floor((status.budget.requestLimit-status.budget.requests)/2)):null;
 const disabled=locked||sending||fetching||historical||!status?.enabled||processing||!!undoing||!!undoRetry;
 const undoDisabled=locked||sending||fetching||historical||processing||!!undoing||!!retry||!view;
 const commandStatuses=new Map(view?.claims.commands.map(item=>[item.commandId,item.status])??[]);
 const remainingCommands=(turn:AgentTurn)=>turn.commandIds.filter(id=>commandStatuses.get(id)!=='undone').length;
 async function undoTurn(payload:UndoRequest){
  if(undoInFlight.current||sending||processing||locked||historical)return;
  undoInFlight.current=true;sequence.current++;setFetching(false);setUndoing(payload.turnId);setError('');setUndoRetry(payload);
  try{
   const res=await fetch(`/api/scan/agent/turn/${encodeURIComponent(payload.turnId)}/undo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placeId:payload.placeId,expectedRevision:payload.expectedRevision})});
   if(res.status===409){setUndoRetry(null);replyContext.current=null;if(current.current.placeId===payload.placeId)await onConflict();await refresh();return;}
   const result=await res.json().catch(()=>null);
   if(!res.ok){if(res.status>=400&&res.status<500)setUndoRetry(null);throw new Error(result?.error??`Undo failed (${res.status}).`);}
   const {turn,view:next}=result as {turn:AgentTurn;view:ScanReviewView};
   setUndoRetry(null);
   if(current.current.placeId!==payload.placeId)return;
   setTurns(old=>old.map(item=>item.id===turn.id?turn:item));
   replyContext.current=null;
   onApplied(next,'This message was undone. Later independent edits were kept.');
   await refresh();
  }catch(e){setError(`${e instanceof Error?e.message:'Could not retrieve the undo result.'} If the outcome is uncertain, check the same undo again.`);}
  finally{undoInFlight.current=false;setUndoing(null);}
 }
 async function send(payload:ScanAgentRequest){
  if(sending||undoInFlight.current||undoRetry)return;sequence.current++;setFetching(false);setSending(true);setError('');setRetry(payload);
  const optimistic:AgentTurn={id:payload.id,placeId:payload.placeId,selectedCandidateIds:payload.selectedCandidateIds,selectedGroupId:payload.selectedGroupId,message:payload.message,createdAt:new Date().toISOString(),status:'processing',reply:'',commandIds:[]};
  setTurns(old=>[...old.filter(turn=>turn.id!==payload.id),optimistic]);
  try{
   const res=await fetch('/api/scan/agent/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   if(res.status===409){setRetry(null);replyContext.current=null;if(current.current.placeId===payload.placeId)await onConflict();await refresh();return;}
   const result=await res.json().catch(()=>null);
   if(!res.ok){if(res.status>=400&&res.status<500)setRetry(null);throw new Error(result?.error??`Request failed (${res.status}).`);}
   const {turn,view:next}=result as {turn:AgentTurn;view:ScanReviewView};
   setRetry(null);
   if(current.current.placeId!==payload.placeId)return;
   sequence.current++;
   setTurns(old=>[...old.filter(item=>item.id!==turn.id),turn]);
   if(turn.status==='processing'){setRetry(payload);setError('The request is still processing. You can check the same request again.');return;}
   if(turn.status==='clarify'&&signature(current.current.selected,current.current.groupId)===signature(payload.selectedCandidateIds,payload.selectedGroupId??''))replyContext.current={id:turn.id,scope:signature(payload.selectedCandidateIds,payload.selectedGroupId??''),placeId:payload.placeId};
   else replyContext.current=null;
   if(turn.status==='applied')onApplied(next,turn.reply||'Changes saved. You can undo them in History.');
   if(turn.status==='applied'||turn.status==='clarify')setMessage('');
   await refresh();
  }catch(e){setTurns(old=>old.filter(turn=>turn.id!==payload.id||turn.status!=='processing'));setError(`${e instanceof Error?e.message:'No response received.'} If the outcome is uncertain, check the same request again; no new action is sent.`);}
  finally{setSending(false);}
 }
 function submit(){if(disabled||retry||!view||!selected.length||selected.length>20||!message.trim())return;const context=replyContext.current;void send({id:crypto.randomUUID(),placeId,expectedRevision:view.revision,selectedCandidateIds:[...selected],selectedGroupId:groupId||null,message:message.trim(),replyTo:context?.scope===scope&&context.placeId===placeId?context.id:null});}
 return <section id="sr-agent" className="sa-panel" aria-label="Describe selection" aria-busy={sending||!!undoing}>
  <div className="sa-heading"><div><p className="sr-eyebrow">SELECT · DESCRIBE · REMEMBER</p><h2>Describe your selection.</h2><p>Name your selection, group it, or explain what you use it for.</p></div><span className={`sa-availability ${status?.enabled?'sa-online':''}`}>{fetching?'Connecting…':status?.enabled?'Assistant ready':'Assistant off'}{status?.enabled&&<small>{status.model}</small>}</span></div>
  <div className="sa-targets"><strong>{targetIds.length} {targetIds.length===1?'candidate':'candidates'} {retry?.placeId===placeId?'in the pending request':'selected'}</strong>{!targetIds.length?<span>Select the cards you want to edit.</span>:<ul aria-label="Action targets">{targets.map((card,index)=><li key={card.candidateId}>{card.cropUrl&&<img src={card.cropUrl} alt="" onError={e=>{e.currentTarget.style.display='none';}}/>}<span>{names.get(card.candidateId)??card.modelLabel??`Unnamed candidate ${index+1}`}</span></li>)}</ul>}</div>
  <label className="sa-group" htmlFor="sa-group">Choose an existing group to edit
   <select id="sa-group" className="sa-group-select" value={groupId} disabled={locked||sending||historical||!!undoing||processing} onChange={e=>onGroupChange(e.target.value)} aria-describedby="sa-group-help"><option value="">No group selected</option>{groups.map(item=><option key={item.id} value={item.id}>{item.name} · {item.memberIds.length} candidates</option>)}</select>
  </label><p id="sa-group-help" className="sa-group-summary">{group?`Target group: ${group.name} · ${group.memberIds.length} candidates`:'No target group selected. You can create a new group.'}</p>
  {processing&&!sending&&<p className="sa-help" role="status">The previous request is still unresolved. Refresh the conversation to check its status.</p>}
  {historical&&<p className="sa-help">The conversation shows current records. Editing is disabled in this historical view; return to the latest version to edit.</p>}
  {status&&!status.enabled&&<p className="sa-help" role="status">{status.reason??'The assistant is not enabled for this session.'}</p>}
  {remainingTurns!==null&&<p className="sa-help">{remainingTurns===0?'No messages remain in this trial.':`${remainingTurns} messages remain in this trial.`}</p>}
  {!!turns.length&&<ol className="sa-conversation" aria-label="Assistant conversation">{turns.map(turn=>{const remaining=remainingCommands(turn),canUndo=turn.status==='applied'&&turn.commandIds.length>0;return <li key={turn.id}><div className="sa-user"><strong>You <span>· {turn.selectedCandidateIds.length} selected candidates</span></strong><p>{turn.message}</p></div><div className={`sa-assistant sa-${turn.status}`}><strong>Assistant <span>· {canUndo&&remaining===0?'Undone':labels[turn.status]}</span></strong><p>{turn.reply||(turn.status==='processing'?'Preparing a response for your selection…':'No response saved.')}</p>{canUndo&&<div className="sa-turn-undo">{remaining===0?<span>All actions from this message were undone.</span>:<><span>{remaining} {remaining===1?'action':'actions'}{remaining<turn.commandIds.length?` remaining · ${turn.commandIds.length-remaining} actions already undone`:''}</span><button disabled={undoDisabled||!!undoRetry} onClick={()=>view&&void undoTurn({turnId:turn.id,placeId,expectedRevision:view.revision})}>{undoing===turn.id?'Undoing…':'Undo this message'}</button></>}</div>}</div></li>;})}</ol>}
  {turns.some(turn=>turn.status==='applied'&&remainingCommands(turn)>0)&&<p className="sa-help">Undo withdraws only this message. Later independent edits stay; edits that depend on a removed group may become inactive.</p>}
  <form onSubmit={e=>{e.preventDefault();submit();}}><label htmlFor="sa-message">What would you like to do with this selection?</label><textarea id="sa-message" rows={3} maxLength={1000} value={message} disabled={disabled||!!retry} onChange={e=>setMessage(e.target.value)} placeholder='Create a group called “Model-making tools” and add the tag “model making”.'/><div className="sa-send-row"><span>{selected.length>20?'Select up to 20 candidates at a time.':'Applies only to the selection above.'}</span><button type="submit" disabled={disabled||!!retry||!selected.length||selected.length>20||!message.trim()}>{sending?'Waiting for response…':'Send'}</button></div></form>
  {error&&<p className="sa-error" role="alert">{error}</p>}
  {retry&&<div className="sa-retry"><p>Pending request: “{retry.message}” · {retry.selectedCandidateIds.length} candidates{retry.selectedGroupId?` · Target group: ${groups.find(item=>item.id===retry.selectedGroupId)?.name??'previous selection'}`:''}{!retryHere?' · Return to the other place to check.':''}</p><button disabled={sending||!!undoing||!!undoRetry||historical||!retryHere||fetching||!view||(locked&&!processing)} onClick={()=>void send(retry)}>Check the same request</button></div>}
  {undoRetry&&<div className="sa-retry" role="status"><p>Waiting to confirm a message undo.{undoRetry.placeId!==placeId?' Return to the previous place to check.':' You can check the same undo again.'}</p><button disabled={undoDisabled||undoRetry.placeId!==placeId} onClick={()=>void undoTurn(undoRetry)}>Check the same undo</button></div>}
  <button className="sa-refresh" disabled={sending||!!undoing||fetching||!placeId} onClick={()=>void refresh()}>Refresh conversation</button>
 </section>;
}
