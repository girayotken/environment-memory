import {useId,useState,type ReactNode} from 'react';
import {MapPin,ChevronDown} from 'lucide-react';
import type {RoomAutomationController} from './RoomAutomationPanel.tsx';

export function CaptureRoomChoice({automation,locked,children}:{automation:RoomAutomationController;locked:boolean;children?:ReactNode}){
 const id=useId(),{state,rooms,loading,busy}=automation;
 const [name,setName]=useState(import.meta.env.VITE_VIRTUAL_ENVIRONMENT === 'model-maker-studio' ? 'Model maker studio' : 'Workshop');
 const room=rooms.find(item=>item.roomId===state?.declaration.roomId);
 return <details className="journey-room" open={!loading&&!rooms.length?true:undefined}>
  <summary aria-label={`Room and settings: ${room?.label??'Choose your room'}`}><MapPin size={20} aria-hidden="true"/><span>{room?.label??'Choose your room'}</span><ChevronDown size={18} aria-hidden="true"/></summary>
  <div className="journey-room-content"><p>{loading?'Loading saved rooms…':!state?.provider.enabled?'Views save automatically. Memory checks unavailable.':state.declaration.enabled?'Scan saves views and updates memory.':'Views save automatically. Memory updates paused.'}</p>
  <label htmlFor={id}>Where are you scanning?</label>
  <select id={id} value={room?.roomId??''} disabled={locked||busy||loading} onChange={event=>void automation.declare(event.target.value||null,!!state?.declaration.enabled&&!!state?.provider.enabled)}><option value="">Choose a remembered room</option>{rooms.map(item=><option key={item.roomId} value={item.roomId}>{item.label}</option>)}</select>
  <label className="journey-auto"><input type="checkbox" checked={state?.declaration.enabled??false} disabled={locked||busy||!room||(!state?.provider.enabled&&!state?.declaration.enabled)} onChange={event=>void automation.declare(room?.roomId??null,event.target.checked)}/>Update memory from automatically saved views</label>
  {!rooms.length&&!loading&&<form onSubmit={event=>{event.preventDefault();if(name.trim())void automation.createRoom(name.trim());}}><label htmlFor={`${id}-new`}>Name your room</label><input id={`${id}-new`} value={name} maxLength={200} onChange={event=>setName(event.target.value)} disabled={locked||busy}/><button type="submit" disabled={locked||busy||!name.trim()}>Create room</button><p>Start with an empty room. Saved views can add observations to its memory.</p></form>}
  {!state?.provider.enabled&&<p>Views will be saved. New memory checks are unavailable without a connected observer.</p>}
  {automation.error&&<p role="alert">{automation.error}</p>}
  {children}</div>
 </details>;
}

export function DemoWalkthrough({onCamera,onMemory,onClose}:{onCamera:()=>void;onMemory:()=>void;onClose:()=>void}){
 return <aside className="journey-demo" aria-label="Demo walkthrough"><div><strong>A room that remembers</strong><button onClick={onClose} aria-label="Close demo walkthrough">Close</button></div>
  <p>Three-minute rehearsal · virtual {import.meta.env.VITE_VIRTUAL_ENVIRONMENT === 'model-maker-studio' ? 'studio' : 'workshop'}</p>
  <ol><li><strong>Show the room.</strong> Choose your room, start a scan and look around slowly.</li><li><strong>Finish the scan.</strong> Clear, steady new views save automatically. Tap Done, then open memory. Saved views and checked memory are separate states.</li><li><strong>Find the drill.</strong> Search My memory, open a result and its last-seen image.</li><li><strong>Stay in control.</strong> Try “Not the same object”, then Undo correction.</li></ol>
  <p className="journey-evidence">{import.meta.env.VITE_VIRTUAL_ENVIRONMENT === 'model-maker-studio' ? 'This studio starts with an empty memory. Saved views and memory checks are separate; an observer is needed to add new observations.' : 'Existing memory uses recorded model results. This guide does not start inference or simulate a new result. If the observer is unavailable, demonstrate capture and saved memory as separate chapters.'}</p>
  <div className="journey-demo-actions"><button onClick={onCamera}>Go to camera</button><button onClick={onMemory}>Find in memory</button></div>
 </aside>;
}
