import { useEffect, useState } from 'react';
import type { Place, PlaceMemory, ItemEvidence,PlaceMatcherRevision } from '../domain/place-memory.ts';
import type { SavedFrame } from '../domain/contracts.ts';
import type { TrialUsage } from '../server/economy.ts';
import './place-memory.css';
import type {VisualEvidenceView} from '../domain/visual-evidence.ts';
import {LinkedObjectCrop,ClipVisualEvidence,VisualEvidenceViewer,type VisualSelection} from './VisualEvidence.tsx';
import {SemanticRelationsPanel} from './SemanticRelationsPanel.tsx';

type View=PlaceMemory & {results:{items:PlaceMemory['items'];unresolved:PlaceMemory['unresolved']}};
const pointer='environment-memory:place:v1';
async function request<T>(url:string,body?:unknown):Promise<T>{const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw new Error(value.error??'Request failed');return value;}
export function PlaceMemoryPanel({ready,liveReady,readOnly=false,captureVisit,onAnalysisBusy,onObserved}:{ready:boolean;liveReady:boolean;readOnly?:boolean;captureVisit:(visit:1|2|3)=>Promise<SavedFrame>;onAnalysisBusy:(busy:boolean)=>void;onObserved:()=>Promise<void>}){
  const [places,setPlaces]=useState<Place[]>([]),[id,setId]=useState(''),[view,setView]=useState<View|null>(null);
  const [name,setName]=useState('Shared workshop'),[query,setQuery]=useState('drill'),[submitted,setSubmitted]=useState('drill'),[through,setThrough]=useState('');
  const [matching,setMatching]=useState<PlaceMatcherRevision>('natural-v3');
  const [trial,setTrial]=useState<TrialUsage|null>(null),[working,setWorking]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [evidence,setEvidence]=useState<{url:string;caption:string}|null>(null);
  const [visual,setVisual]=useState<VisualEvidenceView>({bundles:[],links:[]}),[visualSelection,setVisualSelection]=useState<VisualSelection|null>(null);
  useEffect(()=>{let cancelled=false;(async()=>{const values=await request<Place[]>('/api/places');if(cancelled)return;setPlaces(values);let saved='';try{saved=localStorage.getItem(pointer)??'';}catch{}
    setId(values.some(p=>p.id===saved)?saved:values[0]?.id??'');})().catch(e=>setError(e.message));return()=>{cancelled=true;};},[]);
  useEffect(()=>{let cancelled=false;const params=new URLSearchParams({q:submitted,matching});if(through)params.set('through',through);
    const visualParams=through?`?through=${encodeURIComponent(through)}`:'';
    Promise.all([id?request<View>(`/api/places/${id}/memory?${params}`):Promise.resolve(null),request<TrialUsage>('/api/live-usage'),id?request<VisualEvidenceView>(`/api/places/${id}/visual-evidence${visualParams}`):Promise.resolve({bundles:[],links:[]})]).then(([v,t,images])=>{if(!cancelled){setView(v);setTrial(t);setVisual(images);}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[id,through,submitted,matching,revision]);
  const select=(value:string)=>{setId(value);setThrough('');setView(null);setEvidence(null);setVisualSelection(null);setVisual({bundles:[],links:[]});try{localStorage.setItem(pointer,value);}catch{}};
  const create=async()=>{setWorking(true);setError('');try{const place=await request<Place>('/api/places',{name,source:'live'});setPlaces(p=>[place,...p]);select(place.id);}catch(e){setError((e as Error).message);}finally{setWorking(false);}};
  const save=async()=>{if(!view||view.visits.length>=3)return;setWorking(true);setError('');try{const next=(view.visits.length+1) as 1|2|3,frame=await captureVisit(next);await request(`/api/places/${id}/visits`,{frameId:frame.id});setThrough('');setRevision(v=>v+1);setEvidence({url:frame.imageUrl,caption:`Visit ${next} saved; not analyzed.`});}catch(e){setError((e as Error).message);}finally{setWorking(false);}};
  const check=async(frameId:string)=>{setWorking(true);setError('');setEvidence(null);onAnalysisBusy(true);try{await request(`/api/frames/${frameId}/observe`,{mode:'live'});await onObserved();}catch(e){setError((e as Error).message);}finally{setRevision(v=>v+1);setWorking(false);onAnalysisBusy(false);}};
  const show=(e:ItemEvidence)=>setEvidence({url:e.imageUrl,caption:`Visit ${e.visit} · ${e.label} · ${e.location} · ${new Date(e.capturedAt).toLocaleTimeString()}`});
  const allChecked=view&&view.checkedPrefix===view.visits.length;
  return <section className="place-memory" aria-label="Three-visit place memory">
    <div className="section-heading"><h2>Remember this workshop</h2><span>Three visits · natural objects</span></div>
    <p>Save a view, check it, and ask where an item was last observed. No added markers.</p>
    {readOnly?<p className="place-provenance">Saved evidence review · read-only · no new API calls or uploads</p>:<div className="place-controls"><label>Place name<input aria-label="Place name" value={name} onChange={e=>setName(e.target.value)} maxLength={80}/></label><button disabled={working||!name.trim()} onClick={()=>void create()}>Start a place memory</button></div>}
    {places.length>0&&<label className="place-picker">Saved place<select aria-label="Saved place memory" disabled={working} value={id} onChange={e=>select(e.target.value)}>{places.map(p=><option key={p.id} value={p.id}>{p.name}{p.source==='authored_fixture'?' · AUTHORED EXAMPLE':''}</option>)}</select></label>}
    {error&&<p className="error" role="alert">{error}</p>}
    {view&&<><p className="place-provenance">{view.place.source==='authored_fixture'?'AUTHORED EXAMPLE · not visual inference':view.checkedPrefix?'Actual saved Meta observations · appearance identities remain tentative':'Live Meta source · saving alone does not recognize objects'}</p>
      <label className="place-picker">Matching method<select aria-label="Place matching method" value={matching} disabled={working} onChange={e=>{setMatching(e.target.value as PlaceMatcherRevision);setEvidence(null);}}><option value="natural-v3">Natural v3 · qualified tool terminology</option><option value="natural-v2">Natural v2 · frozen previous result</option></select></label>
      {view.place.source==='live'&&trial&&<p>Model checks: {trial.attempts.length}/{trial.limits.maxCalls} · estimated ${trial.estimatedUsd.toFixed(6)} · cap ${trial.limits.budgetUsd.toFixed(2)}. {trial.attempts.length>=trial.limits.maxCalls?'This trial is closed; saved evidence remains searchable.':'Only explicit checks call Meta.'}</p>}
      <div className="place-steps">{view.visits.map(({frame,checked,projected},index)=>{const attempted=trial?.attempts.find(a=>a.frameId===frame.id);return <article key={frame.id}>
        <button className="visit-picture" onClick={()=>setEvidence({url:frame.imageUrl,caption:`Exact saved view · visit ${index+1}`})}><img src={frame.imageUrl} alt={`Place visit ${index+1} saved evidence`}/></button>
        <b>Visit {index+1}</b><p>{projected?'Checked and remembered':checked?'Waiting for earlier visit':'Saved · not checked'}</p>
        {!checked&&<button disabled={working||view.place.source!=='live'||!liveReady||index!==view.checkedPrefix||Boolean(attempted)||!trial||trial.attempts.length>=trial.limits.maxCalls} onClick={()=>void check(frame.id)}>{working?'Checking…':`Check visit ${index+1} with Meta`}</button>}
        {attempted&&attempted.status!=='completed'&&<p>Attempt: {attempted.status}. Evidence retained; no automatic retry.</p>}
      </article>;})}</div>
      {!readOnly&&!through&&view.visits.length<3&&<button className="primary" disabled={!ready||working||!allChecked} onClick={()=>void save()}>{working?'Working…':`Prepare & save visit ${view.visits.length+1}`}</button>}
      <p className="place-operator">Preparation changes the virtual scene as an operator action. Only its saved pixels reach the observer.</p>
      {view.visits.length>0&&<><label className="place-picker">Memory as of<select aria-label="Memory as of visit" value={through} disabled={working} onChange={e=>{setThrough(e.target.value);setEvidence(null);setVisualSelection(null);}}><option value="">Latest saved visit</option>{view.visits.map((_,i)=><option key={i} value={i+1}>After visit {i+1}</option>)}</select></label>
      <SemanticRelationsPanel key={id} placeId={id} through={through} matching={matching}/>
      <form className="place-search" onSubmit={e=>{e.preventDefault();setEvidence(null);setSubmitted(query);setRevision(v=>v+1);}}><label>Find an item<input aria-label="Find in place memory" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Where is my drill?" maxLength={160}/></label><button type="submit" disabled={working}>Find last seen</button></form>
      {!view.checkedPrefix&&<p>Check the first saved view to start the evidence history.</p>}
      {view.results.items.map(item=>{const last=item.history.at(-1)!;return <article className="place-item" data-entity-id={item.id} key={item.id}>
        <div className="section-heading"><h3>{item.label}</h3><span>{item.status==='observed'?'Observed in this checked visit':item.status==='not_observed'?'Not observed in this visit':item.status==='unchecked'?'Latest view is not checked':'Identity unresolved in this visit'}</span></div>
        <p><b>Last observed: visit {last.visit}</b> · {last.location}</p><p>{item.status==='not_observed'?'The item may be hidden, outside the view or overlooked. This does not mean missing.':item.status==='unchecked'?'A saved, unchecked view establishes no absence.':'Appearance candidate, not proof of unique physical identity.'}</p>
        <LinkedObjectCrop data={visual} history={item.history} onOpen={setVisualSelection}/>
        <button onClick={()=>show(last)}>Show last seen evidence for {item.label}</button>
        <details><summary>{item.history.length} observations · item history</summary>{item.history.map(h=><button key={`${h.runId}:${h.index}`} onClick={()=>show(h)}>Visit {h.visit}: {h.location}</button>)}{item.events.map(e=><p key={e.visit}>Visit {e.visit}: {e.status} · {e.reason}</p>)}</details>
      </article>;})}
      {view.results.unresolved.map(e=><article className="place-item ambiguous" key={`${e.runId}:${e.index}`}><h3>{e.label} · unresolved observation</h3><p>{e.reason} No identity was forced.</p><button onClick={()=>show(e)}>Inspect visit {e.visit} evidence</button><p>{e.candidateIds.length} possible earlier candidates. Compare natural casing, handle or fastener details.</p></article>)}
      {view.checkedPrefix>0&&!view.results.items.length&&!view.results.unresolved.length&&<p>No individually described item matches this query. This is not evidence that it is missing.</p>}
      </>}
      <ClipVisualEvidence data={visual} onOpen={setVisualSelection} historical={Boolean(through)}/>
      {visualSelection&&<VisualEvidenceViewer key={visualSelection.segment.id} selection={visualSelection} onClose={()=>setVisualSelection(null)}/>}
      {evidence&&<figure className="place-evidence"><img src={evidence.url} alt="Exact selected place-memory evidence"/><figcaption>{evidence.caption}</figcaption></figure>}
      <p className="place-operator">Keyword/description search over saved evidence · {view.matcherRevision}. Group records stay separate. {view.groups.length} aggregate observations retained. No inferred hidden contents.</p>
    </>}
  </section>;
}
