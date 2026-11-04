import {useState} from 'react';
import type {RoomMemory,RoomObservationGraphHypothesis,RoomObservationView,RoomSourceView} from '../domain/room-memory-contracts.ts';
import type {RoomObservationAlternative,RoomObservationGraphEvidence,RoomObservationHypothesis} from '../domain/room-observation-graph.ts';

const hypothesisLabels:Record<RoomObservationHypothesis,string>={'same-object':'Same object','similar-other':'Similar other object',uncertain:'Uncertain'};
const date=(value:string)=>{const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Capture time unavailable':parsed.toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'});};

function EvidenceList({label,items}:{label:string;items:RoomObservationGraphEvidence[]}){
 return <div className="rm-graph-evidence"><h6>{label}</h6>{items.length?<ul>{items.map((item,index)=><li key={index}><p>{item.basis}</p>{item.sources.length>0&&<div className="rm-graph-source-links">{item.sources.map(source=><a key={source.viewId} href={source.imageUrl} target="_blank" rel="noreferrer" title={source.sourceHash}>Source · {date(source.capturedAt)} ↗</a>)}</div>}</li>)}</ul>:<p className="rm-muted">None recorded.</p>}</div>;
}
function Alternative({alternative,favored}:{alternative:RoomObservationAlternative;favored:boolean}){
 return <details className={`rm-graph-alternative${favored?' rm-graph-favored':''}`} aria-label={`${hypothesisLabels[alternative.hypothesis]} hypothesis`}>
  <summary><strong>{hypothesisLabels[alternative.hypothesis]}</strong><span className="rm-status">{favored?'Favored · provisional':alternative.assessment==='supported'?'Evidence supported · provisional':alternative.assessment==='unresolved'?'Unresolved':'Possible'}</span></summary>
  <EvidenceList label="Supporting evidence" items={alternative.support}/>
  <EvidenceList label="Evidence against" items={alternative.counterEvidence}/>
  <EvidenceList label="Missing evidence" items={alternative.missingEvidence}/>
 </details>;
}
function HypothesisComparison({hypothesis,room}:{hypothesis:RoomObservationGraphHypothesis;room:RoomMemory}){
 const evaluation=hypothesis.evaluation,node=room.graph.nodes.find(item=>item.id===evaluation.candidateNodeId);
 const relationLabel=(id:string)=>room.graph.nodes.find(item=>item.id===id)?.label??'Related entry';
 return <details className="rm-graph-comparison">
  <summary>{node?`Compare with remembered ${node.label}`:'No remembered candidate assigned'} · {hypothesisLabels[evaluation.favoredHypothesis]} favored</summary>
  <p className="rm-muted">Physical identity remains provisional. {evaluation.evidenceConditioning==='independent'?'Current appearance was recorded separately before comparison.':'This report was produced with memory context. Separating its saved fields does not make perception independent.'}</p>
  <div className="rm-graph-alternatives">{evaluation.alternatives.map(alternative=><Alternative key={alternative.hypothesis} alternative={alternative} favored={alternative.hypothesis===evaluation.favoredHypothesis}/>)}</div>
  {evaluation.contextRelations.length>0&&<details className="rm-graph-context"><summary>Historical relation context</summary><p className="rm-muted">These earlier relationships do not establish current placement or identity.</p>{evaluation.contextRelations.map((relation,index)=><div key={index}><p>{relationLabel(relation.from)} · {relation.relation.replaceAll('_',' ')} · {relationLabel(relation.to)} · {relation.status}</p><EvidenceList label="Relation sources" items={relation.evidence}/></div>)}</details>}
 </details>;
}
function ObservationSource({source,label}:{source:RoomSourceView;label:string}){
 const [failed,setFailed]=useState(false);
 return <figure className="rm-source">{failed?<p className="rm-source-missing" role="status">This saved source is unavailable. Its observation remains in memory.</p>:<a href={source.imageUrl} target="_blank" rel="noreferrer" aria-label={`Open current source for ${label}`}><img src={source.imageUrl} alt={`Saved source for ${label}`} loading="lazy" onError={()=>setFailed(true)}/></a>}<figcaption><time dateTime={source.capturedAt}>Captured {date(source.capturedAt)}</time><a href={source.imageUrl} target="_blank" rel="noreferrer" title={source.sourceHash}>Open current source ↗</a></figcaption></figure>;
}
function Observation({observation,room}:{observation:RoomObservationView;room:RoomMemory}){
 const hypotheses=(room.graphHypotheses??[]).filter(item=>item.observationId===observation.observationId);
 return <details className="rm-graph-observation">
  <summary><strong>{observation.label}</strong><span>{date(observation.capturedAt)}{observation.location?` · ${observation.location}`:''}</span></summary>
  <div className="rm-graph-observation-body">
   {observation.provenance==='authored-test'&&<p className="rm-muted">Authored test · no model observation</p>}
   <h4>Current saved observation</h4><p>{observation.currentAppearance?.description??observation.basis}</p>
   {observation.location&&<p><strong>Observed location:</strong> {observation.location}</p>}
   {observation.currentAppearance&&<dl className="rm-current-features">{observation.currentAppearance.features.map((feature,index)=><div key={index}><dt>{feature.feature} · {feature.visible?'Visible':'Not visible'}</dt><dd>{feature.description}</dd></div>)}</dl>}
   <ObservationSource source={observation.source} label={observation.label}/>
   <h4>Identity alternatives</h4>{hypotheses.length?hypotheses.map(hypothesis=><HypothesisComparison key={hypothesis.hypothesisId} hypothesis={hypothesis} room={room}/>):<p className="rm-muted">No association evaluation is saved. This observation remains available without assigning a remembered identity.</p>}
  </div>
 </details>;
}
/** Current observations remain browsable even when comparison fails or identity stays unresolved. */
export function RoomObservationGraph({room}:{room:RoomMemory}){
 const observations=room.observations??[];
 if(!observations.length)return null;
 return <section className="rm-observation-graph" aria-label="Saved observations and identity alternatives"><h3>Saved observations</h3><p className="rm-muted">Each saved appearance keeps its own source and location. Compare the identity alternatives without merging remembered entries.</p><p className="rm-result-count">{observations.length} saved {observations.length===1?'observation':'observations'}</p>{[...observations].sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt)).map(observation=><Observation key={observation.observationId} observation={observation} room={room}/>)}</section>;
}
