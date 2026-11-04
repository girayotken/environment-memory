import {useId,useRef,useState} from 'react';
import type {RoomMemory,RoomMemoryResponse} from '../domain/room-memory-contracts.ts';
import {roomNodeLabel,roomUserEdit} from './room-memory-index.ts';
import './object-conversation.css';
import {ObjectVoiceInput} from './ObjectVoiceInput.tsx';

export function ObjectConversation({room,nodeId,locked,onUpdate,onOpen,onBusy}:{room:RoomMemory;nodeId:string;locked:boolean;onUpdate:(view:RoomMemoryResponse)=>void;onOpen?:()=>void;onBusy:(busy:boolean)=>void}){
 const inputId=useId();
 const node=room.graph.nodes.find(item=>item.id===nodeId),edit=roomUserEdit(room,nodeId);
 const [message,setMessage]=useState(''),[reply,setReply]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<{text:string;operationId:string;revision:number}|null>(null),undoPending=useRef<{operationId:string;revision:number;revisionId:string}|null>(null),inFlight=useRef(false);
 if(!node)return <p role="alert">This object is no longer available. Select another object.</p>;
 const revision=edit?.revision??0,undoId=edit?.lastRevisionId??null;
 async function conflict(){pending.current=null;undoPending.current=null;const response=await fetch('/api/scan/room-memory');if(!response.ok)throw new Error('Memory changed and could not be refreshed. Refresh memory before trying again.');onUpdate(await response.json() as RoomMemoryResponse);throw new Error('Memory changed. The latest details are shown; review them and try again.');}
 async function send(e:React.FormEvent){e.preventDefault();const text=message.trim();if(!text||inFlight.current)return;
  const request=pending.current?.text===text?pending.current:{text,operationId:crypto.randomUUID(),revision};pending.current=request;inFlight.current=true;setBusy(true);onBusy(true);setError('');
  try{const response=await fetch('/api/scan/room-memory/edit/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId:request.operationId,roomId:room.roomId,nodeId,expectedRevision:request.revision,text})});const result=await response.json();if(response.status===409)await conflict();if(!response.ok)throw new Error(result?.error??'Could not save this message.');onUpdate(result.view as RoomMemoryResponse);setReply(result.status==='applied'?'Saved your changes to this object.':result.reply);setMessage('');pending.current=null;}
  catch(e){setError(e instanceof Error?e.message:'Could not save this message.');}finally{inFlight.current=false;setBusy(false);onBusy(false);}
 }
 async function undo(){if(!undoId||inFlight.current)return;inFlight.current=true;setBusy(true);onBusy(true);setError('');const request=undoPending.current??{operationId:crypto.randomUUID(),revision,revisionId:undoId};undoPending.current=request;try{const response=await fetch('/api/scan/room-memory/edit/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId:request.operationId,roomId:room.roomId,nodeId,expectedRevision:request.revision,revisionId:request.revisionId})});const result=await response.json();if(response.status===409)await conflict();if(!response.ok)throw new Error(result?.error??'Could not undo this change.');onUpdate(result as RoomMemoryResponse);undoPending.current=null;setReply('Your last message was undone.');}catch(e){setError(e instanceof Error?e.message:'Could not undo this change.');}finally{inFlight.current=false;setBusy(false);onBusy(false);}}
 return <section className="ls-object-conversation" aria-label={`Edit ${roomNodeLabel(room,node)}`} aria-busy={busy}>
  <div className="ls-edit-heading"><div><strong>{roomNodeLabel(room,node)}</strong><small>Original observation: {node.label}</small></div>{onOpen&&<button type="button" disabled={locked||busy} onClick={onOpen}>View memory</button>}</div>
  <p>{edit?.groups.length?`Groups: ${edit.groups.join(', ')}`:'No groups yet'} · {edit?.tags.length?`Tags: ${edit.tags.join(', ')}`:'No tags yet'}</p>
  <form onSubmit={event=>void send(event)}><label htmlFor={inputId}>Tell me what to remember about this object</label><textarea id={inputId} value={message} onChange={e=>{setMessage(e.target.value);if(pending.current?.text!==e.target.value.trim())pending.current=null;}} maxLength={1000} disabled={locked||busy} placeholder="For example: Call this my drill and tag it for repairs"/>{message.length>1000&&<small role="alert">Please shorten your draft to 1,000 characters before sending.</small>}<button disabled={locked||busy||!message.trim()||message.length>1000}>Send</button></form>
  <ObjectVoiceInput key={`${room.roomId}:${nodeId}`} disabled={locked||busy} onTranscript={text=>{setMessage(previous=>previous?`${previous} ${text}`:text);pending.current=null;}}/>{busy&&<p role="status">Saving your message…</p>}{reply&&<p role="status">{reply}</p>}{error&&<p role="alert">{error}</p>}{undoId&&<button disabled={locked||busy} onClick={()=>void undo()}>Undo last message</button>}
 </section>;
}
