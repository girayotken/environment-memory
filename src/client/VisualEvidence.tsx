import {useEffect,useRef,useState} from 'react';
import {visualAssetUrl,type VisualBundle,type VisualSegment,type VisualEvidenceView} from '../domain/visual-evidence.ts';
import type {ItemEvidence} from '../domain/place-memory.ts';
export interface VisualSelection{bundle:VisualBundle;segment:VisualSegment;caption:string}
export function LinkedObjectCrop({data,history,onOpen}:{data:VisualEvidenceView;history:ItemEvidence[];onOpen:(selection:VisualSelection)=>void}){
  for(const evidence of [...history].reverse()){
    const link=data.links.find(l=>l.frameId===evidence.frameId&&l.runId===evidence.runId&&l.index===evidence.index);
    const bundle=link&&data.bundles.find(b=>b.id===link.bundleId),segment=bundle&&bundle.segments.find(s=>s.id===link.segmentId);
    if(bundle&&segment)return <button className="object-crop" onClick={()=>onOpen({bundle,segment,caption:`${evidence.label} · visit ${evidence.visit} · ${link.note}`})}>
      <img loading="lazy" src={visualAssetUrl(segment.cutoutAsset)} alt={`SAM object crop of ${evidence.label} from visit ${evidence.visit}`}/>
      <span><b>Object image · visit {evidence.visit}</b><small>Saved SAM mask · reviewed association</small></span>
    </button>;
  }
  return null;
}
export function ClipVisualEvidence({data,onOpen,historical}:{data:VisualEvidenceView;onOpen:(selection:VisualSelection)=>void;historical:boolean}){
  const clips=data.bundles.filter(b=>b.media==='video');
  if(historical)return <p className="place-operator">Independent clip evidence is hidden in historical visit views.</p>;
  if(!clips.length)return null;
  return <section className="clip-evidence" aria-label="Saved clip visual memory"><h3>Visual memory from a saved clip</h3>
    <p>Actual saved SAM results. Each track belongs to this clip; its identity across visits remains unresolved. The workshop association was declared by the operator.</p>
    {clips.map(bundle=><div key={bundle.id}><p>{bundle.concept} · {new Date(bundle.recordedAt).toLocaleString()} · no new API calls</p>
      <div className="clip-track-grid">{[...new Set(bundle.segments.map(s=>s.trackId))].map(trackId=>{
        const segments=bundle.segments.filter(s=>s.trackId===trackId).sort((a,b)=>a.frameIndex-b.frameIndex),first=segments[0];
        return <article key={trackId}><img loading="lazy" src={visualAssetUrl(first.cutoutAsset)} alt={`Saved clip track ${trackId} object cutout`}/><h4>{bundle.concept} · track {trackId}</h4><p>{segments.length} saved views · clip-local identity</p>
          <button onClick={()=>onOpen({bundle,segment:first,caption:`${bundle.concept} · clip-local track ${trackId} · not linked to a visit item`})}>Inspect track {trackId} images</button></article>;
      })}</div></div>)}
  </section>;
}
export function VisualEvidenceViewer({selection,onClose}:{selection:VisualSelection;onClose:()=>void}){
  const host=useRef<HTMLElement>(null);
  useEffect(()=>{host.current?.focus({preventScroll:true});host.current?.scrollIntoView({block:'start'});},[selection]);
  const views=selection.bundle.segments.filter(s=>s.trackId===selection.segment.trackId).sort((a,b)=>a.frameIndex-b.frameIndex);
  const [position,setPosition]=useState(0);
  const segment=views[position]??selection.segment;
  return <section ref={host} tabIndex={-1} className="visual-viewer" aria-label="Selected object visual evidence"><div className="section-heading"><h3>Object image evidence</h3><button onClick={onClose}>Close object images</button></div><p>{selection.caption}</p>
    <div className="object-detail"><figure><img src={visualAssetUrl(segment.cutoutAsset)} alt="Selected object with SAM background removed"/><figcaption>Masked object · native {segment.width} × {segment.height} pixels</figcaption></figure>
    <figure><img src={visualAssetUrl(segment.contextAsset)} alt="Unmasked object crop with surrounding pixels"/><figcaption>Original pixels with nearby context</figcaption></figure></div>
    {views.length>1&&<><label>Clip frame {segment.frameIndex} · {position+1} of {views.length}<input aria-label="Object evidence frame" type="range" min={0} max={views.length-1} value={position} onChange={e=>setPosition(Number(e.target.value))}/></label>
      <div className="object-filmstrip">{views.map((view,index)=><button key={view.id} aria-label={`Show object frame ${view.frameIndex}`} aria-pressed={index===position} onClick={()=>setPosition(index)}><img loading="lazy" src={visualAssetUrl(view.cutoutAsset)} alt={`Object at frame ${view.frameIndex}`}/><span>{view.frameIndex}</span></button>)}</div></>}
    <figure className="visual-source"><img src={visualAssetUrl(segment.sourceAsset)} alt="Exact source pixels used for this SAM object crop"/><figcaption>Exact {selection.bundle.pixelSource==='decoded-uploaded-video'?'decoded uploaded-video frame':'saved image'} · frame {segment.frameIndex}. Mask boundaries can omit object parts. This image adds visual evidence, not a new identity decision.</figcaption></figure>
  </section>;
}
