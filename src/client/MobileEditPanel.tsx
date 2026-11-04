import {useEffect,useId,useRef,useState} from 'react';
import type {ScanCommand} from '../domain/scan-contracts.ts';
import type {ScanReviewView} from '../domain/scan-review-contracts.ts';
import './mobile-edit-panel.css';

export interface MobileEditPanelProps {
 placeId:string;view:ScanReviewView;selected:string[];groupId:string;locked:boolean;
 onGroupChange:(id:string)=>void;onBusy:(busy:boolean)=>void;
 onApplied:(view:ScanReviewView,notice:string)=>void;onConflict:()=>Promise<void>;
}
interface PendingEdit {body:string;placeId:string;targets:string[];groupName:string;description:string}
const editTitles:Record<ScanCommand['action']['type'],string>={'set-label':'Name saved','add-tag':'Tag added','remove-tag':'Tag removed','create-group':'Group created','rename-group':'Group renamed','add-to-group':'Added to group','remove-from-group':'Removed from group',undo:'Edit undone'};
const editDate=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'Saved edit':date.toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'});};

export function MobileEditPanel({placeId,view,selected,groupId,locked,onGroupChange,onBusy,onApplied,onConflict}:MobileEditPanelProps){
 const uid=useId(),[name,setName]=useState(''),[tag,setTag]=useState(''),[groupName,setGroupName]=useState(''),[rename,setRename]=useState('');
 const [pending,setPending]=useState<PendingEdit|null>(null),[sending,setSending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [historyLimit,setHistoryLimit]=useState(10);
 const inFlight=useRef(false),busyCallback=useRef(onBusy),currentPlace=useRef(placeId),mounted=useRef(true);
 busyCallback.current=onBusy;currentPlace.current=placeId;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;busyCallback.current(false);};},[]);
 const group=view.claims.groups.find(item=>item.id===groupId),historical=view.revision!==view.latestRevision;
 const disabled=locked||!!pending||sending||historical;
 // Change the rename draft only when the user chooses a different group.
 useEffect(()=>{setRename(view.claims.groups.find(item=>item.id===groupId)?.name??'');},[placeId,groupId]);
 useEffect(()=>{setHistoryLimit(10);},[placeId]);
 const history=[...view.claims.commands].reverse().filter(item=>item.command.action.type!=='undo');
 const ids=[...new Set(selected)].filter(id=>view.cards.some(card=>card.candidateId===id));
 const names=new Map(view.claims.objects.map(item=>[item.candidateId,item.userLabel]));
 const targetNames=ids.map(id=>names.get(id)??view.cards.find(card=>card.candidateId===id)?.modelLabel??'Unnamed candidate');

 async function send(request:PendingEdit){
  if(inFlight.current||request.placeId!==currentPlace.current)return;
  inFlight.current=true;setSending(true);setError('');setNotice('');setPending(request);busyCallback.current(true);
  let release=false;
  try{
   const res=await fetch('/api/scan/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:request.body});
   if(res.status===409){
    release=true;setPending(null);
    await onConflict();
    if(mounted.current)setNotice('The latest memory is loaded. Select your targets again; this edit was not retried.');
    return;
   }
   if(!res.ok){
    // A server error may follow a successful write. Keep its immutable ID for retry.
    if(res.status>=400&&res.status<500){release=true;setPending(null);}
    const result=await res.json().catch(()=>null);
    throw new Error(result?.error??`Could not save (${res.status}).`);
   }
   const next=await res.json() as ScanReviewView;
   if(!next||!Array.isArray(next.cards)||!next.claims||!Number.isInteger(next.revision))throw new Error('The save response was incomplete.');
   release=true;setPending(null);
   if(mounted.current&&currentPlace.current===request.placeId){
    onApplied(next,'Changes saved. Individual edits can be undone in Edit history.');
    setNotice('Changes saved.');
   }
  }catch(e){
   if(mounted.current)setError(release?`${e instanceof Error?e.message:'Could not refresh memory.'} Your draft is kept.`:'The save result is not confirmed. Check the same request to retrieve its result safely.');
  }finally{
   inFlight.current=false;
   if(mounted.current)setSending(false);
   if(release)busyCallback.current(false);
  }
 }
 function apply(action:ScanCommand['action'],description:string){
  if(disabled||inFlight.current)return;
  const command:ScanCommand={id:crypto.randomUUID(),placeId,createdAt:new Date().toISOString(),actor:{id:'local-review-user',kind:'user'},action};
  const targetGroup=action.type==='create-group'?action.name:'groupId' in action?group?.name??'':'';
  void send({body:JSON.stringify({expectedRevision:view.revision,command}),placeId,targets:'candidateIds' in action?[...targetNames]:[],groupName:targetGroup,description});
 }
 const selectionDisabled=disabled||!ids.length;
 return <section className="me-panel" aria-label="Personal edits" aria-busy={sending}>
  <div className="me-heading"><h2>Personal edits</h2><p>{ids.length} {ids.length===1?'candidate':'candidates'} selected</p></div>
  <p className="me-help">Your names, groups and tags stay separate from model suggestions.</p>
  {!ids.length&&<p className="me-hint">Select candidates to name, tag or group them.</p>}
  {!!ids.length&&!pending&&<ul className="me-targets" aria-label="Selected candidates">{targetNames.map((value,index)=><li key={ids[index]}>{value}</li>)}</ul>}
  {historical&&<p className="me-hint">Return to the latest version to edit.</p>}
  <fieldset disabled={selectionDisabled}>
   <form onSubmit={event=>{event.preventDefault();if(name.trim())apply({type:'set-label',candidateIds:ids,label:name.trim()},'Save name');}}>
    <label htmlFor={`${uid}-name`}>Your name for {ids.length===1?'this candidate':'these candidates'}</label>
    <input id={`${uid}-name`} maxLength={200} value={name} onChange={event=>setName(event.target.value)} placeholder="e.g. Small repair kit"/>
    <button className="me-primary" disabled={!name.trim()}>Save name</button>
   </form>
   <form onSubmit={event=>{event.preventDefault();if(tag.trim())apply({type:'add-tag',candidateIds:ids,tag:tag.trim()},'Add tag');}}>
    <label htmlFor={`${uid}-tag`}>Usage tag</label>
    <input id={`${uid}-tag`} maxLength={200} value={tag} onChange={event=>setTag(event.target.value)} placeholder="e.g. Model making"/>
    <div className="me-actions"><button disabled={!tag.trim()}>Add tag</button><button type="button" disabled={!tag.trim()} onClick={()=>apply({type:'remove-tag',candidateIds:ids,tag:tag.trim()},'Remove tag')}>Remove tag</button></div>
   </form>
   <form onSubmit={event=>{event.preventDefault();if(groupName.trim())apply({type:'create-group',groupId:crypto.randomUUID(),name:groupName.trim(),candidateIds:ids},'Create group');}}>
    <label htmlFor={`${uid}-new-group`}>New group from selection</label>
    <input id={`${uid}-new-group`} maxLength={200} value={groupName} onChange={event=>setGroupName(event.target.value)} placeholder="e.g. Workbench tools"/>
    <button disabled={!groupName.trim()}>Create group</button>
   </form>
  </fieldset>
  <fieldset className="me-existing" disabled={disabled}>
   <label htmlFor={`${uid}-group`}>Existing group</label>
   <select id={`${uid}-group`} value={groupId} onChange={event=>onGroupChange(event.target.value)}><option value="">Choose a group</option>{view.claims.groups.map(item=><option key={item.id} value={item.id}>{item.name} · {item.memberIds.length}</option>)}</select>
   {group&&<><p className="me-help">{group.memberIds.length} {group.memberIds.length===1?'candidate':'candidates'} in this group. Grouping does not merge identities.</p>
    <div className="me-actions"><button type="button" disabled={!ids.length||ids.every(id=>group.memberIds.includes(id))} onClick={()=>apply({type:'add-to-group',groupId:group.id,candidateIds:ids},'Add to group')}>Add selection</button><button type="button" disabled={!ids.some(id=>group.memberIds.includes(id))} onClick={()=>apply({type:'remove-from-group',groupId:group.id,candidateIds:ids},'Remove from group')}>Remove selection</button></div>
    <form onSubmit={event=>{event.preventDefault();if(rename.trim())apply({type:'rename-group',groupId:group.id,name:rename.trim()},'Rename group');}}>
     <label htmlFor={`${uid}-rename`}>Group name</label><input id={`${uid}-rename`} maxLength={200} value={rename} onChange={event=>setRename(event.target.value)}/><button disabled={!rename.trim()||rename.trim()===group.name}>Rename group</button>
    </form>
   </>}
  </fieldset>
  {error&&<p className="me-error" role="alert">{error}</p>}
  {notice&&<p className="me-notice" role="status">{notice}</p>}
  {pending&&<div className="me-pending" role="status"><strong>{sending?'Saving…':'Save awaiting confirmation'}</strong><p>{pending.description}{pending.groupName?` · ${pending.groupName}`:''}</p>{!!pending.targets.length&&<p>{pending.targets.join(' · ')}</p>}{!sending&&<button type="button" disabled={pending.placeId!==placeId||historical} onClick={()=>void send(pending)}>Check the same request</button>}<p className="me-help">Keep this panel open until the result is confirmed.</p></div>}
  <details className="me-history"><summary>Edit history <span>· {history.length}</span></summary>
   <p className="me-help">Undo withdraws one edit. Later independent edits stay; edits that depend on a removed group may become inactive.</p>
   {!history.length?<p className="me-help">No personal edits yet.</p>:<ol>{history.slice(0,historyLimit).map(item=>{const action=item.command.action;
    const value='label' in action?action.label:'tag' in action?action.tag:'name' in action?action.name:'groupId' in action?(view.claims.groups.find(group=>group.id===action.groupId)?.name??view.claims.commands.find(prior=>prior.command.action.type==='create-group'&&prior.command.action.groupId===action.groupId)?.command.action):null;
    const detail=typeof value==='string'?value:value&&typeof value==='object'&&'name' in value?value.name:null;
    const count='candidateIds' in action?action.candidateIds.length:null;
    return <li key={item.commandId}><div><strong>{editTitles[action.type]}</strong>{detail&&<p>{detail}</p>}<small><time dateTime={item.command.createdAt}>{editDate(item.command.createdAt)}</time>{count!==null?` · ${count} ${count===1?'candidate':'candidates'}`:''}</small><span className="me-history-state">{item.status==='undone'?'Undone':item.status==='stale'?'Inactive — target or dependency unavailable':'Applied'}</span></div>{item.status!=='undone'&&<button type="button" disabled={disabled} onClick={()=>apply({type:'undo',targetCommandId:item.commandId},`Undo: ${editTitles[action.type]}`)} aria-label={`Undo edit: ${editTitles[action.type]}${detail?` — ${detail}`:''}`}>Undo edit</button>}</li>;
   })}</ol>}
   {history.length>historyLimit&&<button type="button" onClick={()=>setHistoryLimit(limit=>limit+10)}>Show older edits</button>}
  </details>
 </section>;
}
