import { useEffect, useState } from 'react';
import type { SavedFrame, Observations } from '../domain/contracts.ts';
import type { VisitPair, PairItem, PairFrame, PairKind } from '../domain/visit-pair.ts';
import './two-visits.css';
import { visitScenarios, type VisitScenario } from './visit-scenarios.ts';

type Presentation = VisitPair & { items: PairItem[]; matchingVersion: string; previousItems: PairItem[]; appearanceV2Items: PairItem[] };
type Trial = { liveEnabled: boolean; limits: { maxCalls: number; budgetUsd: number }; attempts: { pairId: string; status: string }[]; estimatedUsd: number };
const key = 'environment-memory:two-visit-draft:v1';
const names: Record<PairKind, string> = { same_candidate: 'Same object candidate', newly_observed: 'First seen in visit 2', not_observed: 'Not observed in visit 2', unresolved: 'Identity unresolved' };
const stamp = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed'); return result;
}
function Region({ frame, object, visit, open }: { frame: PairFrame; object: Observations['objects'][number]; visit: string; open: (id: string) => void }) {
  const box = object.bbox;
  return <button className="pair-region" onClick={() => open(frame.id)} title="Open exact saved frame">
    {box ? <svg viewBox={`${box[0] * frame.width} ${box[1] * frame.height} ${(box[2] - box[0]) * frame.width} ${(box[3] - box[1]) * frame.height}`} role="img" aria-label={`${visit} estimated region: ${object.label}`}><image href={frame.imageUrl} width={frame.width} height={frame.height} /></svg>
      : <img src={frame.imageUrl} alt={`${visit} evidence: ${object.label}`} />}
    <span>{visit} · {stamp(frame.capturedAt)}{box ? ' · estimated crop' : ''}</span>
  </button>;
}
export function TwoVisitsPanel({ ready, captureVisit, openEvidence }: { ready: boolean; captureVisit: (which: 'first' | 'return', scenario: VisitScenario) => Promise<SavedFrame>; openEvidence: (id: string) => void }) {
  const [before, setBefore] = useState<PairFrame | null>(null), [after, setAfter] = useState<PairFrame | null>(null);
  const [pair, setPair] = useState<Presentation | null>(null), [trial, setTrial] = useState<Trial | null>(null);
  const [matchingMethod, setMatchingMethod] = useState<'current' | 'appearance-v2' | 'previous'>('current');
  const [scenario, setScenario] = useState<VisitScenario>('basic');
  const [savedPairs, setSavedPairs] = useState<Presentation[]>([]);
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const listing = await request<{ pairs: Presentation[]; trial: Trial }>('/api/visit-pairs');
      let draft: { beforeId?: string; afterId?: string; scenario?: VisitScenario } = {};
      try { draft = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* No saved draft. */ }
      const recent = listing.pairs.find(p => p.before.id === draft.beforeId && p.after.id === draft.afterId) ?? (!draft.beforeId && !draft.scenario ? listing.pairs[0] : null);
      const first = recent?.before ?? (draft.beforeId ? await request<SavedFrame>(`/api/frames/${encodeURIComponent(draft.beforeId)}`) : null);
      const second = recent?.after ?? (draft.afterId ? await request<SavedFrame>(`/api/frames/${encodeURIComponent(draft.afterId)}`) : null);
      if (!cancelled) { setSavedPairs(listing.pairs); if (draft.scenario && Object.hasOwn(visitScenarios, draft.scenario)) setScenario(draft.scenario); setTrial(listing.trial); setPair(recent ?? null); setBefore(first); setAfter(second); }
    })().catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);
  const persist = (first: PairFrame, second: PairFrame | null) => {
    try { localStorage.setItem(key, JSON.stringify({ beforeId: first.id, afterId: second?.id, scenario })); } catch { /* Server frames still persist. */ }
  };
  const save = async (which: 'first' | 'return') => {
    if (working) return; setWorking(true); setError('');
    try {
      const frame = await captureVisit(which, scenario);
      if (which === 'first') { setBefore(frame); setAfter(null); setPair(null); persist(frame, null); }
      else if (before) {
        setAfter(frame); persist(before, frame);
        const created = await request<Presentation>('/api/visit-pairs', { beforeFrameId: before.id, afterFrameId: frame.id });
        setPair(created); setSavedPairs(previous => [created, ...previous.filter(p => p.id !== created.id)]);
      }
    } catch(e) { setError(e instanceof Error ? e.message : 'Visit could not be saved'); }
    finally { setWorking(false); }
  };
  const analyze = async () => {
    if (!pair || working) return; setWorking(true); setError('');
    try { setPair(await request<Presentation>(`/api/visit-pairs/${pair.id}/analyze`, { mode: 'live' })); }
    catch(e) { setError(e instanceof Error ? e.message : 'Comparison did not complete'); }
    finally {
      await request<{ trial: Trial; pairs: Presentation[] }>('/api/visit-pairs').then(value => { setTrial(value.trial); setSavedPairs(value.pairs); }).catch(() => {});
      setWorking(false);
    }
  };
  const shownItems = matchingMethod === 'previous' ? pair?.previousItems ?? [] : matchingMethod === 'appearance-v2' ? pair?.appearanceV2Items ?? [] : pair?.items ?? [];
  const individualItems = shownItems.filter(item => item.scope !== 'group');
  const groupCount = shownItems.length - individualItems.length;
  const attempted = trial?.attempts.some(a => a.pairId === pair?.id);
  const canAnalyze = Boolean(pair && !pair.analysis && trial?.liveEnabled && !attempted && trial.attempts.length < trial.limits.maxCalls);
  return <section className="two-visits" aria-label="Two-visit comparison">
    <div className="section-heading"><h2>Two visits, one workshop</h2><span>Fixed bench reference</span></div>
    <p>Save two visits, then compare their pixels. Setup controls are operator actions; the model receives no scenario answers.</p>
    <div className="pair-selectors"><label>Operator scenario<select aria-label="Operator scenario" value={scenario} disabled={working} onChange={e => {
      const next = e.target.value as VisitScenario; setScenario(next); setBefore(null); setAfter(null); setPair(null); setError('');
      try { localStorage.setItem(key, JSON.stringify({ scenario: next })); } catch { /* Existing server evidence is untouched. */ }
    }}>{Object.entries(visitScenarios).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {savedPairs.length > 0 && <label>Saved comparisons<select aria-label="Saved comparisons" value={pair?.id ?? ''} disabled={working} onChange={e => {
        const saved = savedPairs.find(p => p.id === e.target.value); if (!saved) return;
        setPair(saved); setBefore(saved.before); setAfter(saved.after); persist(saved.before, saved.after); setError('');
      }}><option value="" disabled>Choose saved evidence</option>{savedPairs.map(p => <option key={p.id} value={p.id}>{stamp(p.createdAt)} · {p.analysis ? 'compared' : 'saved, not compared'}</option>)}</select></label>}
    </div>
    <p>Scenario choice applies to new captures only. Saved comparisons preserve their original pixels.</p>
    <div className="pair-actions"><button disabled={!ready || working} onClick={() => void save('first')}>1. Set up & save visit 1</button><button disabled={!ready || working || !before} onClick={() => void save('return')}>2. Arrange & save visit 2</button><button className="primary" disabled={working || !canAnalyze} onClick={() => void analyze()}>{working ? 'Working…' : '3. Compare saved visits'}</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="pair-views">{([['Visit 1', before], ['Visit 2', after]] as const).map(([label, frame]) => frame ? <button key={label} onClick={() => openEvidence(frame.id)}><img src={frame.imageUrl} alt={`${label} fixed bench evidence`} /><span><b>{label}</b> · {stamp(frame.capturedAt)} · saved{pair?.analysis ? '' : ', not compared'}</span></button> : <div className="pair-empty" key={label}>{label} not saved yet</div>)}</div>
    <p className="pair-trial">Separate two-visit trial: {trial ? `${trial.attempts.length}/${trial.limits.maxCalls} attempts · $${trial.estimatedUsd.toFixed(6)} estimate` : 'loading…'}{trial && !trial.liveEnabled ? ' · live comparison disabled' : ''}. Saving and reopening use no model calls.</p>
    {pair?.analysis && <><p className={`pair-source ${pair.source === 'authored_fixture' ? 'example-notice' : ''}`}>{pair.source === 'live_model' ? `Actual Meta comparison · ${pair.model}` : 'AUTHORED FIXTURE · not visual inference'}. Saved observations feed the selected matching method; candidate links are not independent identity proof.</p><p><b>Original model summary:</b> {pair.analysis.summary}</p>
      <label className="pair-method">Matching method<select aria-label="Matching method" value={matchingMethod} onChange={e => setMatchingMethod(e.target.value as 'current' | 'appearance-v2' | 'previous')}><option value="current">Group-aware matching (v3)</option><option value="appearance-v2">Appearance features (v2)</option><option value="previous">Original guard (v1)</option></select></label>
      <p>{matchingMethod === 'current' ? `Derived matching: ${pair.matchingVersion}. Individual identity and group coverage are separate. First seen means a first individually described appearance.` : matchingMethod === 'appearance-v2' ? 'Appearance features v2, before group scope was separated.' : 'Original conservative matching, retained for comparison.'} Both methods reuse the same saved Meta observations; changing methods makes no model call.</p>
      <p>These counts describe evidence entries, not physical inventory quantities.</p><div className="pair-counts">{(['same_candidate', 'newly_observed', 'not_observed', 'unresolved'] as const).map(kind => <span key={kind}><b>{individualItems.filter(item => item.kind === kind).length}</b> {names[kind]}</span>)}</div>
      {groupCount > 0 && <p className="pair-group-count">{groupCount} group observations kept separately; they are not individual identity candidates.</p>}
      <div className="pair-items">{shownItems.map(item => <article key={item.id} className={`pair-item ${item.kind}`} data-item-id={item.id} data-scope={item.scope ?? 'individual'}>
        <div className="pair-item-heading"><h3>{item.label}</h3><span>{item.scope === 'group' ? 'Group observation · members unresolved' : names[item.kind]}</span></div><p>{item.reason}</p>
        <p className="pair-appearance">Visible description: {item.afterIndex !== null ? pair.analysis!.after.objects[item.afterIndex].appearance : pair.analysis!.before.objects[item.beforeIndex!].appearance}</p>
        <div className="pair-regions">{item.beforeIndex !== null && <Region frame={pair.before} object={pair.analysis!.before.objects[item.beforeIndex]} visit="Visit 1" open={openEvidence} />}{item.afterIndex !== null && <Region frame={pair.after} object={pair.analysis!.after.objects[item.afterIndex]} visit="Visit 2" open={openEvidence} />}</div>
        {Boolean(item.groupCoverage?.length) && <details className="pair-group-evidence"><summary>Related group evidence · {item.groupCoverage!.some(g => g.supportsCoverage) ? 'may include this appearance' : 'kept as context'}</summary>{item.groupCoverage!.map(group => <button key={`${group.side}:${group.index}`} onClick={() => openEvidence(group.side === 'before' ? pair.before.id : pair.after.id)}>Open {group.side === 'before' ? 'visit 1' : 'visit 2'} group: {pair.analysis![group.side].objects[group.index].label}{group.supportsCoverage ? ' · possible coverage, not identity' : ' · separate context'}</button>)}</details>}
        <p className="pair-last">Last observed {stamp(item.lastSeen.capturedAt)} · {item.lastSeen.location}. {item.kind === 'not_observed' ? 'Earlier evidence retained.' : item.kind === 'same_candidate' ? 'Linked to visit 1 candidate history.' : ''}</p>
      </article>)}</div></>}
  </section>;
}
