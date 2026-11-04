import type {RoomMemory,RoomMemoryVisit} from '../domain/room-memory-contracts.ts';

type Proposal=RoomMemoryVisit['proposals'][number];
const resultLabels={same:'Same appearance',different:'Different appearance','not-visible':'Not visible'};
const limitations={none:'No detail limitation reported.', 'current-detail':'Current detail is insufficient. A targeted view may help.', 'historical-detail':'Historical detail is insufficient. Another current view cannot restore that missing history.',both:'Current and historical detail are insufficient.', 'history-conflict':'Current appearance agrees with the original but contradicts a later saved appearance. The conflicting history remains unresolved.'};
const date=(value:string)=>{const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Capture time unavailable':parsed.toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'});};

/** Legacy visits have no structured comparison and retain their existing display. */
export function RoomAppearanceComparison({proposal,room}:{proposal:Proposal;room:RoomMemory}){
 const appearance=proposal.currentAppearance,comparison=proposal.comparison;
 if(!appearance||!comparison)return null;
 const sources=new Map([...room.graph.sourceViews,...room.visits.flatMap(visit=>visit.sourceViews)].map(source=>[source.sourceHash,source]));
 return <details className="rm-comparison">
  <summary>Appearance comparison · provisional</summary>
  <p className="rm-muted">Model comparison. Physical identity remains provisional.</p>
  <h5>Current appearance</h5><p>{appearance.description}</p>
  <dl className="rm-current-features">{appearance.features.map(feature=><div key={feature.feature}><dt>{feature.feature} · {feature.visible?'Visible':'Not visible'}</dt><dd>{feature.description}</dd></div>)}</dl>
  <h5>Compared with memory</h5>
  <p className="rm-comparison-limitation">{limitations[comparison.limitation]}</p>
  {comparison.features.length>0?<ul className="rm-comparison-features">{comparison.features.map(feature=>{
   const source=sources.get(feature.priorSourceHash);
   return <li key={`${feature.feature}:${feature.priorSourceHash}`}>
    <strong>{feature.feature}</strong><span className={`rm-comparison-result rm-comparison-${feature.result}`}>{resultLabels[feature.result]}</span>
    <dl><div><dt>Current basis</dt><dd>{feature.currentBasis}</dd></div><div><dt>Historical basis</dt><dd>{feature.historicalBasis}</dd></div></dl>
    {source?<a href={source.imageUrl} target="_blank" rel="noreferrer" title={feature.priorSourceHash}>Open historical source · {date(source.capturedAt)} ↗</a>:<p className="rm-muted">The referenced historical source is unavailable.</p>}
   </li>;
  })}</ul>:<p className="rm-muted">No historical feature correspondence was established.</p>}
 </details>;
}
