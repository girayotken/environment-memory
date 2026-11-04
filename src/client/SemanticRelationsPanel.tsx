import {useEffect,useRef,useState} from 'react';
import type {PlaceMatcherRevision} from '../domain/place-memory.ts';
import type {RelationAnswerView,LastSeenAnswer} from '../domain/relation-graph.ts';
import type {AutomaticAnswerView} from '../domain/automatic-relations.ts';
import type {MaskNamingResult} from '../domain/mask-naming.ts';
import './semantic-relations.css';
type AutomaticNamingView=AutomaticAnswerView&{maskNaming:MaskNamingResult};
const initialQuestion='Where was the drill last seen, and what was nearby?';
export function SemanticRelationsPanel({placeId,through,matching}:{placeId:string;through:string;matching:PlaceMatcherRevision}){
  const [question,setQuestion]=useState(initialQuestion),[asked,setAsked]=useState(initialQuestion),[reload,setReload]=useState(0),[mode,setMode]=useState('reviewed');
  const [selected,setSelected]=useState({context:'',id:''}),[loaded,setLoaded]=useState<{key:string;data:RelationAnswerView|AutomaticAnswerView|AutomaticNamingView}|null>(null),[error,setError]=useState<{key:string;text:string}|null>(null);
  const [source,setSource]=useState({key:'',candidateId:''});const sourceFigure=useRef<HTMLElement>(null);
  const context=`${placeId}:${through}:${matching}:${asked}:${mode}`,candidate=selected.context===context?selected.id:'';
  const key=`${context}:${candidate}:${reload}`,view=loaded?.key===key?loaded.data:null;
  useEffect(()=>{
    let cancelled=false;const params=new URLSearchParams({q:asked,matching});if(through)params.set('through',through);if(candidate)params.set('candidate',candidate);if(mode==='automatic-names')params.set('naming','automatic-v1');
    fetch(`/api/places/${placeId}/${mode!=='reviewed'?'automatic-relations':'relations'}?${params}`).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error??'Saved relations unavailable');return data as RelationAnswerView|AutomaticAnswerView|AutomaticNamingView;})
      .then(data=>{if(!cancelled){setLoaded({key,data});setError(null);}}).catch(e=>{if(!cancelled)setError({key,text:(e as Error).message});});
    return()=>{cancelled=true;};
  },[placeId,through,matching,asked,candidate,key,mode]);
  useEffect(()=>{if(source.key===key){sourceFigure.current?.focus({preventScroll:true});sourceFigure.current?.scrollIntoView({block:'nearest'});}},[source,key]);
  const submit=(text=question)=>{setQuestion(text);setAsked(text);setSelected({context:'',id:''});setSource({key:'',candidateId:''});setReload(n=>n+1);};
  const openSource=(answer:LastSeenAnswer)=>setSource({key,candidateId:answer.candidateId});
  return <section className="semantic-relations" aria-label="Saved semantic relation answers"><div className="section-heading"><h3>Where was it, and what was nearby?</h3><span>Saved evidence</span></div>
    <p>Answers use saved records, preserving the selected evidence source and uncertainty. No new model calls are made.</p>
    <label>Relation source<select aria-label="Relation evidence method" value={mode} onChange={event=>setMode(event.target.value)}><option value="reviewed">Agent review · saved records</option><option value="automatic">Automatic trial · saved model + SAM</option><option value="automatic-names">Automatic names + relations · experimental</option></select></label>
    {mode!=='reviewed'&&<p className="relation-caution">Surfaces are candidates derived from saved model location descriptions. Named neighbors use SAM masks from the same frame; {mode==='automatic-names'?'names are linked only when color and coarse tool class are unique in that image. Similar yellow tools are left unresolved.':'mask names rely on earlier agent-reviewed relations.'} Image proximity is not physical distance.</p>}
    <form className="relation-question" onSubmit={event=>{event.preventDefault();submit();}}><label>Ask about this saved place<input aria-label="Ask saved relations" value={question} maxLength={200} onChange={event=>setQuestion(event.target.value)}/></label><button type="submit" disabled={!question.trim()}>Answer from records</button></form>
    <div className="relation-examples"><button onClick={()=>submit(initialQuestion)}>Drill candidates</button><button onClick={()=>submit('Where was the blue drill last seen, and what was nearby?')}>Blue drill</button></div>
    {error?.key===key?<p className="error" role="alert">{error.text}</p>:!view?<p role="status">Loading saved relations…</p>:<>
      <p className="relation-message" role="status">{view.message}</p>
      {hasMaskNaming(view)&&<section className="mask-naming" aria-label="Automatic mask names"><h4>Automatic mask naming</h4><p>{view.maskNaming.counts.accepted} name candidates · {view.maskNaming.counts.ambiguous} ambiguous masks. Agent names were excluded from this calculation. {view.maskNaming.counts.unsupportedSource} masks have no model output tied to the same source image.</p><div className="mask-name-cards">{view.maskNaming.decisions.filter(d=>d.media==='image').map((d,i)=><article key={d.segmentId}><img src={d.cutoutUrl} alt={`Automatic naming trial, mask ${i+1}`}/><h5>{d.status==='accepted'?d.candidates.find(c=>c.observationId===d.acceptedObservationId)?.label:'No name linked'}</h5><p>{namingExplanation(d.status)}</p><p>Appearance description candidates: {d.candidates.map(c=>`${c.label} · ${c.location}`).join(' / ')||'no suitable source'}</p></article>)}</div></section>}

      {view.ambiguity?<div className="relation-choices">{view.answers.map(answer=><article key={answer.candidateId}><h4>{answer.label}</h4><p>{answer.appearance}</p><p>Latest linked record: visit {answer.last.visit}{answer.possibleLater.length?' · later appearances remain uncertain':''}</p><button onClick={()=>setSelected({context,id:answer.candidateId})}>Open this candidate: {answer.label}</button></article>)}</div>:
        view.answers.map(answer=><article className="relation-answer" key={answer.candidateId}>
          <div className="section-heading"><h4>{answer.label}</h4><span>Linked evidence from visit {answer.last.visit}</span></div>
          <p className="relation-answer-text">{answer.text}</p>
          <p className="relation-caution">{answer.warning}</p>
          {answer.possibleLater.length>0&&<p>Later uncertain records: {[...new Set(answer.possibleLater.map(e=>e.visit))].join(', ')}. These were not added to the latest linked observation.</p>}
          <div className="relation-answer-actions"><button className="primary" onClick={()=>openSource(answer)}>Open the answer source frame</button>{candidate&&<button onClick={()=>setSelected({context,id:''})}>Back to other candidates</button>}</div>
          <details><summary>Relations supporting this answer</summary><ul>
            {answer.surface?<li>{answer.label} → {mode!=='reviewed'?'may be on':'observed on'} → {answer.surface.label}. Source: {mode!=='reviewed'?'saved model location; automatic candidate':'agent image review'}.</li>:<li>No surface link was derived; location is quoted from the original model description.</li>}
            {answer.neighbors.map(n=><li key={n.observationId}>{answer.label} → near in the image → {n.label}. Source: {mode!=='reviewed'?(mode==='automatic-names'?'same-frame SAM mask and automatic name candidate':'same-frame SAM bounds; earlier name links were used'):'reviewed object regions in the same frame'}. Original uncertainty: {n.uncertainty}.</li>)}
          </ul><p>Also described in the same frame: {answer.coVisible.join(', ')||'no other individual record'}. These records are not independent confirmations.</p><p>Original location description: “{answer.last.location}”. Object uncertainty: {answer.last.uncertainty}.</p></details>
          {source.key===key&&source.candidateId===answer.candidateId&&<figure ref={sourceFigure} tabIndex={-1} className="relation-source" aria-label="Answer source evidence"><div className="relation-source-image"><img src={answer.last.imageUrl} alt={`Answer source frame, visit ${answer.last.visit}`}/>
            <svg viewBox={`0 0 ${sourceDimensions(view,answer).width} ${sourceDimensions(view,answer).height}`} aria-label={mode!=='reviewed'?'SAM mask bounds':'Reviewed object regions'}>
              {[...(answer.region?[{bounds:answer.region,label:answer.label,target:true}]:[]),...answer.neighbors.map(n=>({bounds:n.bounds,label:n.label,target:false}))].map((region,i)=><g key={i}><rect x={region.bounds.left} y={region.bounds.top} width={region.bounds.right-region.bounds.left} height={region.bounds.bottom-region.bounds.top} fill="none" stroke={region.target?'#e6a02b':'#35b9c5'} strokeWidth="2"/><text x={region.bounds.left} y={Math.max(10,region.bounds.top-4)} fill={region.target?'#9b5200':'#00545b'} fontSize="9" stroke="white" strokeWidth=".3">{region.label}</text></g>)}
            </svg></div><figcaption>Visit {answer.last.visit} · {new Date(answer.last.capturedAt).toLocaleString('en-GB')}. {mode==='automatic-names'&&!answer.region?'No SAM region is linked to this candidate; ambiguous masks are not outlined in this frame.':'Orange: selected appearance. Blue: nearby regions in the same frame.'} {mode!=='reviewed'?'Boxes show existing SAM mask bounds only; a missing box means no mask is linked to that observation.':'Boxes are a review overlay; the original frame is unchanged.'} Proximity is not physical distance.</figcaption></figure>}
        </article>)}
      <details className="relation-graph-meta"><summary>Source-backed relation graph</summary><p>{view.graph.nodes.length} nodes, {view.graph.edges.length} relations. Object candidates, dated observations, {mode!=='reviewed'?'model surface candidates':'reviewed surfaces'} and source frames stay separate. This graph does not change identity matching decisions.</p></details>
      {isAutomatic(view)&&<p>{view.automatic.counts.surfaceCandidates} model surface candidates · {view.automatic.counts.namedMasks} named SAM regions · {view.automatic.counts.namedPairs} named neighbor pairs. The mask ledger contains {view.automatic.counts.maskPairs} same-frame pairs; video pairs were not linked to visit objects.</p>}
    </>}
  </section>;
}
function sourceDimensions(view:RelationAnswerView,answer:LastSeenAnswer){
  return view.frameDimensions[answer.last.frameId];
}

function isAutomatic(view:RelationAnswerView):view is AutomaticAnswerView{return view.method==='cached-auto-relations-v1'&&'automatic' in view;}

function hasMaskNaming(view:RelationAnswerView):view is AutomaticNamingView{return 'maskNaming' in view;}
function namingExplanation(status:string){return status==='accepted'?'There is one color and coarse-tool-class candidate in this frame. This is not physical identity evidence.':status==='ambiguous'?'Similar-colored tools or masks remain ambiguous; no name was forced.':status==='conflict'?'The model location description conflicts with the mask position.':'Insufficient source or color evidence to link a name.';}
