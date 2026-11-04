import {useEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronRight,Check} from 'lucide-react';
import type {RoomMemory,RoomMemoryResponse} from '../domain/room-memory-contracts.ts';
import type {RoomAutomationController} from './RoomAutomationPanel.tsx';
import {liveScanObjects} from './live-scan-objects.ts';
import {ObjectConversation} from './ObjectConversation.tsx';
import {RoomContainment,LiveContainerSuggestion} from './RoomContainment.tsx';
import {scanSessionSummary} from './scan-session-summary.ts';

type Target={roomId:string;nodeId:string};
export function LiveScanObjects({frameIds,saved,automation,refreshKey,locked,onOpen,onChanged}:{frameIds:string[];saved:Array<{id:string;sourceHash:string}>;automation:RoomAutomationController;refreshKey:number;locked:boolean;onOpen:(roomId:string,nodeId:string)=>void;onChanged:()=>void}){
 const editor=useRef<HTMLDivElement>(null);
 const [rooms,setRooms]=useState<RoomMemory[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0),[target,setTarget]=useState<Target|null>(null),[editBusy,setEditBusy]=useState(false);
 useEffect(()=>{editor.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[target]);
 useEffect(()=>{if(!frameIds.length)return;let current=true;setLoading(true);void fetch('/api/scan/room-memory').then(async response=>{if(!response.ok)throw new Error('Could not load scan objects.');return await response.json() as RoomMemoryResponse;}).then(data=>{if(current){setRooms(data.rooms);setError('');}}).catch(()=>{if(current){setRooms([]);setError('Could not load scan objects.');}}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[refreshKey,frameIds.length,retry]);
 const kindRank=(roomId:string,nodeId:string)=>({portable:0,contents_group:1,container:2,fixture:3,support:4,place:5}[rooms.find(room=>room.roomId===roomId)?.graph.nodes.find(node=>node.id===nodeId)?.kind??'place']);
 const objects=liveScanObjects(frameIds,saved,automation.state?.jobs??[],rooms,automation.state?.declaration.roomId??null).sort((a,b)=>kindRank(a.roomId,a.nodeId)-kindRank(b.roomId,b.nodeId)),summary=scanSessionSummary(frameIds,saved,automation.state?.jobs??[],automation.state?.declaration.roomId??null),selected=target&&objects.some(item=>item.roomId===target.roomId&&item.nodeId===target.nodeId)?rooms.find(room=>room.roomId===target.roomId):null;
 return <details className="ls-live-objects" open>
  <summary><span>{objects.length?`${objects.length} item${objects.length===1?'':'s'} remembered`:'This scan'}<span className="ls-sr-only"> · Live objects</span></span><ChevronDown size={18} aria-hidden="true"/></summary>
  <div className="ls-live-content">
   {summary.checking>0&&<p role="status">Checking {summary.checking} saved view{summary.checking===1?'':'s'}…</p>}
   {summary.failed>0&&<p role="status">Some views could not be checked. Open room settings to retry.</p>}
   {summary.reused>0&&<p>Already remembered from an earlier identical image.</p>}
   {summary.unchecked>0&&<p>{summary.unchecked} view{summary.unchecked===1?'':'s'} saved · not checked yet</p>}
   {automation.error&&<p role="alert">{automation.error}</p>}
   {error&&<p role="alert">{error} <button onClick={()=>setRetry(value=>value+1)}>Retry list</button></p>}
   {loading&&<p role="status">Loading memory updates…</p>}
   {!objects.length&&!loading&&!error&&<p>{frameIds.length?'Remembered objects will appear here.':'Objects appear here as memory updates.'}</p>}
   <ul aria-label="Objects remembered in this scan">{objects.map(item=><li key={`${item.roomId}:${item.nodeId}`}><button className="ls-object-row" disabled={locked||loading||editBusy} aria-label={`Edit ${item.label}`} aria-pressed={target?.roomId===item.roomId&&target.nodeId===item.nodeId} onClick={()=>setTarget({roomId:item.roomId,nodeId:item.nodeId})}><span><strong>{item.label}</strong><small><span className="ls-object-location">{item.location??rooms.find(room=>room.roomId===item.roomId)?.label??'This room'}</span><span className="ls-object-status"> · {item.status==='Added'?'saved':item.status==='Updated'?'updated':'probably the same'}</span><LiveContainerSuggestion room={rooms.find(room=>room.roomId===item.roomId)!} nodeId={item.nodeId}/></small></span>{item.status==='Added'?<Check className="ls-saved-check" size={23} aria-hidden="true"/>:<ChevronRight size={22} aria-hidden="true"/>}</button></li>)}</ul>
   {target&&selected?<div ref={editor} className="ls-inline-editor"><button className="ls-close-editor" disabled={editBusy} onClick={()=>setTarget(null)}>Close edit</button><ObjectConversation key={`${target.roomId}:${target.nodeId}`} room={selected} nodeId={target.nodeId} locked={locked||loading} onOpen={()=>onOpen(target.roomId,target.nodeId)} onUpdate={view=>{setRooms(view.rooms);onChanged();}} onBusy={setEditBusy}/>{['portable','container','contents_group'].includes(selected.graph.nodes.find(node=>node.id===target.nodeId)?.kind??'')&&<RoomContainment key={`${target.roomId}:${target.nodeId}`} room={selected} itemId={target.nodeId} locked={locked||loading||editBusy} onUpdate={view=>{setRooms(view.rooms);onChanged();}} onBusy={setEditBusy}/>}</div>:target&&!loading&&<p role="status">The selected object is no longer in this scan. Select another object.</p>}
  </div>
 </details>;
}
