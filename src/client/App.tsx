import { useCallback, useEffect, useRef, useState } from 'react';
import { makeCapture, zoneLabels, type Health, type Mode, type SavedFrame, type Zone, type ReplayInput } from '../domain/contracts.ts';
import type { MemoryStream, MemoryView } from '../domain/memory.ts';
import { MemoryInspector, ChangePanel, ReplayTools } from './MemoryPanels.tsx';
import type { TrialUsage } from '../server/economy.ts';
import { Workshop } from './scene.ts';
import { TwoVisitsPanel } from './TwoVisitsPanel.tsx';
import { PlaceMemoryPanel } from './PlaceMemoryPanel.tsx';
import type { VisitScenario } from './visit-scenarios.ts';

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The request could not be completed'); return result;
}
function time(value: string) { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
function CameraIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 6l1.5-2h5L16 6h4v14H4V6h4Z" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.7" /></svg>; }

export function App() {
  const host = useRef<HTMLDivElement>(null), workshop = useRef<Workshop | null>(null), saving = useRef(false);
  const [frames, setFrames] = useState<SavedFrame[]>([]), [selectedId, setSelectedId] = useState<string | null>(null);
  const [extraFrame, setExtraFrame] = useState<SavedFrame | null>(null), [comparisonId, setComparisonId] = useState<string | null>(null);
  const [stream, setStream] = useState<MemoryStream>('live'), [memory, setMemory] = useState<MemoryView | null>(null);
  const [memoryRevision, setMemoryRevision] = useState(0), [memoryLoading, setMemoryLoading] = useState(false);
  const [health, setHealth] = useState<Health | null>(null), [zone, setZone] = useState<Zone>('bench');
  const [captureEdge, setCaptureEdge] = useState(640);
  const [trial, setTrial] = useState<TrialUsage | null>(null);
  const [auto, setAuto] = useState(false), [busy, setBusy] = useState(false), [analyzing, setAnalyzing] = useState(false);
  const [sceneReady, setSceneReady] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [engineering, setEngineering] = useState(false);
  const [naturalVisit,setNaturalVisit]=useState<1|2|3>(1);
  const [naturalKind,setNaturalKind]=useState<'cases'|'tools'>('cases');
  const currentZone = useRef<Zone>(zone); currentZone.current = zone;
  const selected = frames.find(f => f.id === selectedId) ?? (extraFrame?.id === selectedId ? extraFrame : null) ?? frames[0];
  const comparisonFrame = comparisonId ?? frames[0]?.id;
  const currentMemory = memory?.stream === stream ? memory : null;
  const liveReady = health?.liveConfigured && health.liveEnabled && health.creditConfirmed;
  const selectedAttempt = trial?.attempts.find(attempt => attempt.frameId === selected?.id);
  const trialAvailable = Boolean(trial && trial.attempts.length < trial.limits.maxCalls && !selectedAttempt && selected && Math.max(selected.width, selected.height) <= trial.limits.maxEdge);
  const refresh = useCallback(async () => {
    const [saved, status, usage] = await Promise.all([api<SavedFrame[]>('/api/frames'), api<Health>('/api/health'), api<TrialUsage>('/api/live-usage')]);
    setFrames(saved); setHealth(status); setTrial(usage); setMemoryRevision(value => value + 1);
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);
  useEffect(() => {
    const controller = new AbortController(); setMemoryLoading(true); setMemory(null);
    const params = new URLSearchParams({ stream }); if (comparisonFrame) params.set('after', comparisonFrame);
    fetch(`/api/memory?${params}`, { signal: controller.signal }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Memory could not be loaded');
      if (!controller.signal.aborted) setMemory(value);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setMemoryLoading(false); });
    return () => controller.abort();
  }, [stream, comparisonFrame, memoryRevision]);
  useEffect(() => {
    if (!host.current) return;
    try { workshop.current = new Workshop(host.current); workshop.current.setView(currentZone.current); setSceneReady(true); }
    catch { setError('The virtual scene requires WebGL. Evidence history remains available.'); }
    return () => { workshop.current?.dispose(); workshop.current = null; };
  }, []);
  const capture = useCallback(async () => {
    if (!workshop.current || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const frame = await api<SavedFrame>('/api/frames', makeCapture(workshop.current.capture(captureEdge), zone));
      setFrames(previous => [frame, ...previous.filter(f => f.id !== frame.id)].slice(0, 120)); setSelectedId(frame.id); setComparisonId(frame.id);
      setNotice(`Saved ${zoneLabels[zone].toLowerCase()} view at ${time(frame.capturedAt)}.`);
    } catch (e) { setAuto(false); setError(e instanceof Error ? e.message : 'Capture failed'); }
    finally { saving.current = false; setBusy(false); }
  }, [zone, captureEdge]);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => { if (!document.hidden) void capture(); }, 8000);
    return () => window.clearInterval(timer);
  }, [auto, capture]);
  const changeView = (value: Zone) => { workshop.current?.setView(value); setZone(value); };
  const captureVisit = async (which: 'first' | 'return', scenario: VisitScenario) => {
    if (!workshop.current || saving.current || busy || analyzing) throw new Error('Wait for the current operation to finish.');
    saving.current = true; setBusy(true); setAuto(false);
    try {
      workshop.current.prepareVisit(which, scenario); setZone('bench');
      const frame = await api<SavedFrame>('/api/frames', makeCapture(workshop.current.capture(640), 'bench'));
      setFrames(previous => [frame, ...previous.filter(old => old.id !== frame.id)].slice(0, 120)); setSelectedId(frame.id); setComparisonId(frame.id);
      setNotice(`Visit ${which === 'first' ? '1' : '2'} saved without model analysis.`); return frame;
    } finally { saving.current = false; setBusy(false); }
  };
  const captureMemoryVisit = async (visit: 1|2|3) => {
    if(!workshop.current || saving.current || busy || analyzing) throw new Error('Wait for the current operation to finish.');
    saving.current=true;setBusy(true);setAuto(false);
    try {
      workshop.current.prepareMemoryVisit(visit);setZone('bench');
      const frame=await api<SavedFrame>('/api/frames',makeCapture(workshop.current.capture(640),'bench'));
      setFrames(previous=>[frame,...previous.filter(f=>f.id!==frame.id)].slice(0,120));setSelectedId(frame.id);setComparisonId(frame.id);return frame;
    }finally{saving.current=false;setBusy(false);}
  };
  const openEvidence = async (id: string) => {
    try { if (!frames.some(frame => frame.id === id)) setExtraFrame(await api<SavedFrame>(`/api/frames/${id}`)); setSelectedId(id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Evidence unavailable'); }
  };
  const importReplay = async (data: ReplayInput) => {
    if (!selected || analyzing) return; setAnalyzing(true);
    try {
      await api(`/api/frames/${selected.id}/replay`, data);
      setExtraFrame(await api<SavedFrame>(`/api/frames/${selected.id}`)); setComparisonId(selected.id);
      setStream(data.provenance === 'authored_fixture' ? 'authored' : 'imported'); await refresh();
      setNotice('Replay evidence saved with declared provenance. No model call was made.');
    } finally { setAnalyzing(false); }
  };
  const observe = async (mode: Mode) => {
    if (!selected || analyzing) return; setAnalyzing(true); setError('');
    try { await api(`/api/frames/${selected.id}/observe`, { mode }); setExtraFrame(await api<SavedFrame>(`/api/frames/${selected.id}`)); await refresh(); setComparisonId(selected.id); if (mode === 'live') setStream('live'); setNotice(mode === 'mock' ? 'Loaded an authored wiring fixture. No visual inference was performed.' : 'Model observation saved with this image.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Observation failed'); await refresh().catch(() => {}); } finally { setAnalyzing(false); }
  };
  return <>
    <header className="topbar"><div className="identity"><strong>Environment Memory</strong><span className="context">Shared robotics workshop</span></div><div className="workspace"><i />Local workspace<span>{health?.readOnly?'Mode: saved evidence':stream === 'authored' ? 'Mode: authored examples' : stream === 'imported' ? 'Mode: imported output' : liveReady ? 'Mode: Meta configured' : 'Mode: capture only'}</span></div></header>
    <main>
      <section className="heading"><div><h1>Workshop memory</h1><p>See the room. Keep the evidence.</p></div>
        {!health?.readOnly&&<div className="capture-controls"><label className="capture-size">Test capture<select aria-label="Capture resolution" value={captureEdge} onChange={e => setCaptureEdge(Number(e.target.value))}><option value={640}>640 px</option><option value={320}>320 px</option></select></label><label className="switch-label"><input type="checkbox" checked={auto} disabled={!sceneReady} onChange={e => setAuto(e.target.checked)} /><span className="switch" />Auto capture</label><button className="primary" disabled={!sceneReady || busy} onClick={() => void capture()}><CameraIcon />{busy ? 'Saving…' : 'Capture view'}</button></div>}
      </section>
      {error && <div className="error" role="alert">{error}<button onClick={() => { setError(''); void refresh().catch(e => setError(e.message)); }}>Retry connection</button></div>}
      <button className="engineering-toggle" aria-expanded={engineering} onClick={() => setEngineering(value => !value)}>{engineering ? 'Hide engineering tools' : 'Show engineering tools'}</button>
      <div className={`workbench${engineering ? '' : ' place-focus'}`}>
        <div className="camera-column">
          <section className="scene-panel" aria-label="Virtual camera" style={health?.readOnly&&!engineering?{display:'none'}:undefined}>
            <div className="scene" ref={host} /><span className="testbed-label">VIRTUAL TESTBED · V2</span>
            <div className="scene-rail"><div className="view-buttons" aria-label="Camera views">{(['bench', 'storage', 'parts'] as const).map(value => <button key={value} disabled={!sceneReady} aria-pressed={value === zone} onClick={() => changeView(value)}>{zoneLabels[value]} view</button>)}</div>
              <div className="scenario"><span>Scenario controls</span><div><button disabled={!sceneReady} onClick={() => { workshop.current?.unpack(); setNotice('Scene changed. Capture a view to save new evidence.'); }}>Unpack tools</button><button disabled={!sceneReady} onClick={() => { workshop.current?.moveCase(); setNotice('Scene changed. Capture a view to save new evidence.'); }}>Move blue case</button><button disabled={!sceneReady} onClick={() => { workshop.current?.reset(); setNotice('Virtual scene reset. Saved evidence was preserved.'); }}>Reset</button></div></div>
            </div>
          </section>
          {engineering&&<section className="place-memory" aria-label="Natural-layout operator test"><h2>Unmarked lookalike test</h2><p>Operator preview only. Use Capture view to save pixels; no inference runs here.</p><div className="place-controls"><label>Scene condition<select aria-label="Natural challenge kind" value={naturalKind} onChange={e=>setNaturalKind(e.target.value as 'cases'|'tools')}><option value="cases">Cases and drills</option><option value="tools">Drills and drivers</option></select></label><label>Preview visit<select aria-label="Natural challenge visit" value={naturalVisit} onChange={e=>setNaturalVisit(Number(e.target.value) as 1|2|3)}><option value={1}>Visit 1</option><option value={2}>Visit 2</option><option value={3}>Visit 3</option></select></label><button disabled={!sceneReady||busy||analyzing} onClick={()=>{setAuto(false);workshop.current?.prepareNaturalVisit(naturalVisit,naturalKind);setZone('bench');}}>Prepare natural challenge</button></div></section>}
          <PlaceMemoryPanel ready={sceneReady && !busy && !analyzing} liveReady={Boolean(liveReady)} readOnly={health?.readOnly} captureVisit={captureMemoryVisit} onAnalysisBusy={setAnalyzing} onObserved={refresh} />
          {engineering && <><TwoVisitsPanel ready={sceneReady && !busy && !analyzing} captureVisit={captureVisit} openEvidence={id => void openEvidence(id)} />
          <section className="recent" aria-labelledby="recent-title"><div className="section-heading"><h2 id="recent-title">Recent frames</h2><span>{frames.length} saved{auto ? ' · every 8 seconds' : ''}</span></div>
            {frames.length ? <div className="filmstrip">{frames.map(frame => <button key={frame.id} className={`frame ${frame.id === selected?.id ? 'selected' : ''}`} onClick={() => { setSelectedId(frame.id); setComparisonId(frame.id); }} aria-pressed={frame.id === selected?.id}><img loading="lazy" src={frame.imageUrl} alt={`Saved ${zoneLabels[frame.zone].toLowerCase()} view at ${time(frame.capturedAt)}`} /><span><b>{zoneLabels[frame.zone]}</b><time dateTime={frame.capturedAt}>{time(frame.capturedAt)}</time></span></button>)}</div> : <div className="empty-history"><CameraIcon /><p>Your first frame starts the room’s history.</p><span>Choose a camera view, then capture it.</span></div>}
          </section>
          <ChangePanel view={currentMemory} stream={stream} openEvidence={id => void openEvidence(id)} /></>}
        </div>
        {engineering && <aside className="inspector">
          <MemoryInspector view={currentMemory} stream={stream} setStream={setStream} openEvidence={id => void openEvidence(id)} loading={memoryLoading || !currentMemory} />
          <section className="evidence"><h2>Selected evidence</h2>{selected ? <><img className="evidence-image" src={selected.imageUrl} alt={`Selected evidence: ${zoneLabels[selected.zone]} at ${time(selected.capturedAt)}`} /><div className="evidence-caption"><b>{zoneLabels[selected.zone]}</b><time dateTime={selected.capturedAt}>{time(selected.capturedAt)}</time></div><p>Saved camera image.</p><details><summary>Capture details</summary><dl><dt>Resolution</dt><dd>{selected.width} × {selected.height}</dd><dt>Source</dt><dd>Virtual camera</dd><dt>SHA-256</dt><dd className="hash">{selected.imageHash}</dd></dl></details></> : <div className="empty-evidence"><CameraIcon /><p>No frame selected</p><span>Capture a view to inspect its evidence.</span></div>}</section>
          <section className="provider"><h3>Observation provider</h3><p>{liveReady ? `${health.model} is configured. Analysis sends this saved image to Meta.` : 'Inference requires a configured provider and confirmed credits.'}</p><div className="provider-actions"><button disabled={!selected || analyzing} onClick={() => void observe('mock')}>{analyzing ? 'Working…' : 'Load wiring example'}</button><button disabled={!selected || analyzing || !liveReady || !trialAvailable} onClick={() => void observe('live')}>Analyze with Muse</button></div>{selected?.run && <div className={`observation ${selected.run.mode}`}><strong>{selected.run.mode === 'mock' ? 'OFFLINE FIXTURE' : selected.run.mode === 'replay' ? selected.run.provenance === 'authored_fixture' ? 'AUTHORED REPLAY · NOT INFERENCE' : 'IMPORTED MODEL OUTPUT' : selected.run.model}</strong><p>{selected.run.observations.summary}</p>{selected.run.observations.objects.map((object, i) => <p key={i}><b>{object.label}</b> — {object.locationDescription} {object.uncertainty}</p>)}</div>}<div className="trial-usage"><h3>Economic trial</h3><p>{trial ? `${trial.attempts.length} / ${trial.limits.maxCalls} calls · $${trial.limits.budgetUsd.toFixed(2)} test budget` : 'Loading usage…'}</p><p>640px maximum · minimal reasoning · 1,600 output tokens · no automatic retries.</p>{trial && <p>Reserved ceiling: ${trial.reservedUsd.toFixed(6)} · reported-token estimate: ${trial.estimatedUsd.toFixed(6)}</p>}{selectedAttempt && <><p className="attempt-status">This image: {selectedAttempt.status} · {(selectedAttempt.latencyMs / 1000).toFixed(2)} s (including preflight)</p>{selectedAttempt.usage.inputTokens !== undefined ? <dl><dt>Input</dt><dd>{selectedAttempt.usage.inputTokens}</dd><dt>Cached subset</dt><dd>{selectedAttempt.usage.cachedInputTokens}</dd><dt>Output</dt><dd>{selectedAttempt.usage.outputTokens}</dd><dt>Reasoning subset</dt><dd>{selectedAttempt.usage.reasoningTokens}</dd><dt>Visible output</dt><dd>{selectedAttempt.usage.visibleOutputTokens}</dd><dt>Estimate</dt><dd>${selectedAttempt.usage.estimatedCostUsd?.toFixed(6)}</dd><dt>Preflight context</dt><dd>{selectedAttempt.contextTokens} (not billing)</dd></dl> : <p>Usage not reported; reservation remains counted.</p>}</>}<p>Estimates use standard published model rates, not an invoice. Failed attempts keep their budget reservation.</p></div><ReplayTools disabled={!selected || analyzing} onImport={importReplay} /></section>
        </aside>}
      </div>
      <footer><span>Frames stay on this device.</span><span>Local auto capture saves images only.</span></footer>
      <div className="sr-only" role="status" aria-live="polite">{notice}</div>
    </main>
  </>;
}
