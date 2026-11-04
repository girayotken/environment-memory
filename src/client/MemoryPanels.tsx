import { useState } from 'react';
import { zoneLabels, type ReplayInput } from '../domain/contracts.ts';
import { examples } from '../domain/examples.ts';
import { searchItems, type ChangeKind, type MemoryStream, type MemoryView } from '../domain/memory.ts';

const stamp = (value: string) => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const sourceNames: Record<MemoryStream, string> = { live: 'Live Meta', authored: 'Authored examples', imported: 'Imported model output' };
const changeNames: Record<ChangeKind, string> = { newly_observed: 'Newly observed', possibly_moved: 'Possible location change', not_observed: 'Not observed', unchanged: 'Description agrees', unresolved: 'Unresolved' };
type OpenEvidence = (id: string) => void;

export function MemoryInspector({ view, stream, setStream, openEvidence, loading }: { view: MemoryView | null; stream: MemoryStream; setStream: (value: MemoryStream) => void; openEvidence: OpenEvidence; loading: boolean }) {
  const [query, setQuery] = useState('');
  const visible = searchItems(view?.items ?? [], query);
  return <section className="memory"><div className="section-heading"><h2>Room memory</h2><span>{view?.analyzedFrames ?? 0} analyzed</span></div>
    <label className="field-label" htmlFor="memory-source">Evidence source</label><select id="memory-source" value={stream} onChange={e => setStream(e.target.value as MemoryStream)}>{Object.entries(sourceNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    <p className={`source-notice ${stream === 'authored' ? 'example-notice' : ''}`}>{stream === 'authored' ? 'Authored examples. Memory mechanics only; no visual inference.' : stream === 'imported' ? 'User-supplied model output. Provenance is declared, not independently verified.' : 'Actual Meta observations only. Mock and replay data stay separate.'}</p>
    <label className="field-label" htmlFor="object-search">Find an object</label><input id="object-search" type="search" placeholder="e.g. blue case" value={query} onChange={e => setQuery(e.target.value)} maxLength={160} />
    <p className="group-count">{loading ? 'Updating evidence…' : `${visible.length} observation group${visible.length === 1 ? '' : 's'} · identities are tentative`}</p>
    <div className="object-list">{visible.slice(0, 40).map(item => <article className="memory-object" key={item.id}>
      <button className="object-main" onClick={() => openEvidence(item.lastSeen.frameId)}><span><b>{item.label}</b><small>Last described: {item.lastSeen.locationDescription || zoneLabels[item.lastSeen.zone]}</small><time dateTime={item.lastSeen.capturedAt}>{stamp(item.lastSeen.capturedAt)} · {zoneLabels[item.lastSeen.zone]}</time></span><span aria-hidden="true">↗</span></button>
      <span className={`identity-state ${item.identity}`}>{item.identity === 'unresolved' ? 'Unresolved identity' : 'Tentative identity'}</span>
      <details><summary>{item.history.length} observation{item.history.length === 1 ? '' : 's'} · evidence history</summary><p>{item.appearance}</p><p>{item.lastSeen.uncertainty}</p>{item.candidateItemIds.length > 0 && <p>Similar earlier groups: {item.candidateItemIds.length}. No forced merge.</p>}<ol>{item.history.map(h => <li key={h.observationId}><button onClick={() => openEvidence(h.frameId)}>{stamp(h.capturedAt)} · {zoneLabels[h.zone]}<span>{h.locationDescription}</span></button></li>)}</ol></details>
    </article>)}</div>
    {!visible.length && !loading && <p className="muted">{query ? 'No matching description. Try a label or appearance keyword.' : 'No object observations in this source yet. Capture alone does not create an inventory.'}</p>}
    {visible.length > 40 && <p className="muted">Showing 40 groups. Narrow the search.</p>}
  </section>;
}

export function ChangePanel({ view, stream, openEvidence }: { view: MemoryView | null; stream: MemoryStream; openEvidence: OpenEvidence }) {
  const comparison = view?.comparison;
  return <section className="changes-panel"><div className="section-heading"><h2>What changed?</h2><span>{sourceNames[stream]}</span></div>
    <p className={`comparison-note ${stream === 'authored' ? 'example-notice' : ''}`}>{stream === 'authored' ? 'Authored observations, not model perception. ' : ''}{view?.comparisonNote ?? 'Choose an evidence source and analyze or import observations.'}</p>
    {comparison ? <><div className="comparison-images">{([['Before', comparison.beforeFrame], ['After', comparison.afterFrame]] as const).map(([label, frame]) => <button key={label} onClick={() => openEvidence(frame.id)}><img src={frame.imageUrl} alt={`${label} evidence for ${zoneLabels[frame.zone]}`} /><span><b>{label} · {zoneLabels[frame.zone]}</b><time dateTime={frame.capturedAt}>{stamp(frame.capturedAt)}</time></span></button>)}</div>
      {comparison.samePixels && <p className="same-pixels">Identical image bytes. Description differences cannot establish a room change.</p>}
      <div className="change-list">{comparison.changes.map((change, index) => <article key={`${change.label}:${index}`}><span className={`change-kind ${change.kind}`}>{changeNames[change.kind]}</span><div><h3>{change.label}</h3><p>{change.explanation}</p><div className="evidence-links">{change.before && <button onClick={() => openEvidence(change.before!.frameId)}>Earlier evidence ↗</button>}{change.after && <button onClick={() => openEvidence(change.after!.frameId)}>Later evidence ↗</button>}</div></div></article>)}</div>
      {!comparison.changes.length && <p className="muted">Neither observation describes any objects. This does not establish an empty room.</p>}
    </> : <div className="comparison-empty">Two analyzed views of the same zone reveal the first comparison. Unanalyzed or other-zone frames do not imply missing objects.</div>}
  </section>;
}

export function ReplayTools({ disabled, onImport }: { disabled: boolean; onImport: (value: ReplayInput) => Promise<void> }) {
  const [text, setText] = useState(JSON.stringify(examples.baseline.data, null, 2)), [error, setError] = useState('');
  return <details className="replay-tools"><summary>Import observations / test examples</summary><p>Attach observations to the selected evidence image. Examples are authored; they do not analyze or automatically follow the virtual scene.</p>
    <label className="field-label" htmlFor="replay-example">Fill an authored example</label><select id="replay-example" defaultValue="baseline" onChange={e => { setText(JSON.stringify(examples[e.target.value].data, null, 2)); setError(''); }}>{Object.entries(examples).map(([id, example]) => <option key={id} value={id}>{example.title}</option>)}</select>
    <label className="field-label" htmlFor="replay-json">Observation JSON</label><textarea id="replay-json" value={text} onChange={e => setText(e.target.value)} spellCheck={false} maxLength={100_000} rows={10} />
    <p>Use provenance “imported_model_output” only for an output you actually obtained. One immutable replay per image; take another capture for a different example.</p>
    <button disabled={disabled} onClick={() => { setError(''); let parsed: ReplayInput; try { parsed = JSON.parse(text); } catch { setError('Invalid JSON. Correct it before importing.'); return; } void onImport(parsed).catch(e => setError(e instanceof Error ? e.message : 'Import failed')); }}>Import for selected image</button>
    {error && <p role="alert" className="import-error">{error}</p>}
  </details>;
}
