import {createPortal} from 'react-dom';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Workshop } from './scene.ts';
import { applyMovedCaseScene } from './evaluation/moved-case-scene.ts';
import { applyMovedDrillScene, createDemoSceneControls } from './evaluation/moved-drill-scene.ts';
import type {CapturePixels,NormalizedCaptureBox} from './guided-capture-tracker.ts';
import './virtual-camera.css';

export type VirtualCameraHandle = {
  capture: () => { imageDataUrl: string; capturedAt: string } | null;
  reset: () => void;
  samplePixels: () => CapturePixels | null;
};
export type VirtualCameraProps = { active: boolean; onReady?: (ready: boolean) => void; selecting?:boolean; onSelect?:(box:NormalizedCaptureBox)=>void; trackingBox?:NormalizedCaptureBox|null; trackingLabel?:string; sceneLocked?:boolean;toolsHost?:HTMLElement|null };
type Motion = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'turnLeft' | 'turnRight';
const studio = import.meta.env.VITE_VIRTUAL_ENVIRONMENT === 'model-maker-studio';
const storage = import.meta.env.VITE_VIRTUAL_ENVIRONMENT === 'storage-room';
const weekend = studio && import.meta.env.VITE_STUDIO_LAYOUT === 'weekend';
const keys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight']);

/** A local pixel source. Camera pose and simulator object IDs never leave this component. */
export const VirtualCamera = forwardRef<VirtualCameraHandle, VirtualCameraProps>(function VirtualCamera({ active, onReady, selecting=false,onSelect,trackingBox,trackingLabel,sceneLocked=false,toolsHost }, ref) {
  const host = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const workshop = useRef<Workshop | null>(null), activeRef = useRef(active), readyCallback = useRef(onReady);
  const held = useRef(new Set<string>()), touch = useRef(new Map<number, Motion>());
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const demoScene=useRef<ReturnType<typeof createDemoSceneControls>|null>(null);
  const [sceneState,setSceneState]=useState<'original'|'moved'|'scenario'|'scenario-moved'|'replaced'>('original');
  const [weekendRevision, setWeekendRevision] = useState(0);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [locked, setLocked] = useState(false);
  const instructions = useId();
  const sampleCanvas=useRef<HTMLCanvasElement|null>(null),selectionStart=useRef<{id:number;x:number;y:number}|null>(null);
  const [selection,setSelection]=useState<NormalizedCaptureBox|null>(null);
  activeRef.current = active; readyCallback.current = onReady;
  const clear = () => { held.current.clear(); touch.current.clear(); drag.current = null; };

  useImperativeHandle(ref, () => ({
    capture() {
      if (!activeRef.current || document.hidden || !workshop.current || !host.current?.clientWidth) return null;
      const { imageDataUrl } = workshop.current.captureFreeCamera();
      return { imageDataUrl, capturedAt: new Date().toISOString() };
    },
    reset() { clear(); workshop.current?.resetFreeCamera(); },
    samplePixels() {
      if(!activeRef.current||document.hidden||!host.current?.clientWidth)return null;
      const source=host.current.querySelector('canvas');if(!source||!source.width||!source.height)return null;
      const canvas=sampleCanvas.current??=document.createElement('canvas');
      canvas.width=320;canvas.height=Math.max(1,Math.round(320*source.height/source.width));
      const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return null;
      context.drawImage(source,0,0,canvas.width,canvas.height);
      return {width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data};
    },
  }), []);

  useEffect(() => {
    clear();selectionStart.current=null;setSelection(null);
    if(selecting&&document.pointerLockElement===viewport.current)document.exitPointerLock();
  },[selecting]);

  useEffect(() => {
    try {
      const scene = new Workshop(host.current!, storage ? 'storage-room' : studio ? 'model-maker-studio' : 'workshop'); workshop.current = scene;
      const movedCase=!studio && !storage && import.meta.env.VITE_LOCAL_CAMERA_SCENARIO === 'moved-case-20261029';
      const movedDrill=!studio && !storage && import.meta.env.VITE_LOCAL_CAMERA_SCENARIO === 'moved-drill-demo-20261031';
      let restoreScenario: (()=>void)|undefined;
      if(!storage) demoScene.current=createDemoSceneControls(scene,()=>restoreScenario?.());
      if(movedCase){restoreScenario=applyMovedCaseScene(scene);setSceneState('scenario');}
      if(movedDrill){applyMovedDrillScene(scene);setSceneState('moved');}
      scene.resetFreeCamera(); setReady(true); readyCallback.current?.(true);
    } catch {
      setError(`The virtual ${storage ? 'storage room' : studio ? 'studio' : 'workshop'} needs WebGL. Try a browser with hardware acceleration enabled.`);
      readyCallback.current?.(false);
    }
    return () => { clear(); demoScene.current?.resetScene(); workshop.current?.dispose(); workshop.current = null; demoScene.current=null; readyCallback.current?.(false); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let animation = 0, previous = 0;
    const engaged = () => activeRef.current && !document.hidden;
    const frame = (time: number) => {
      if (!engaged()) { animation = 0; return; }
      const delta = previous ? Math.min(.05, (time - previous) / 1000) : 0; previous = time;
      const k = held.current, motions = new Set(touch.current.values());
      const down = (motion: Motion, ...codes: string[]) => motions.has(motion) || codes.some(code => k.has(code));
      const x = Number(down('right', 'KeyD')) - Number(down('left', 'KeyA'));
      const y = Number(down('up', 'Space')) - Number(down('down', 'KeyQ', 'ControlLeft', 'ControlRight'));
      const z = Number(down('forward', 'KeyW')) - Number(down('back', 'KeyS'));
      workshop.current?.moveFreeCamera(x, y, z, delta, k.has('ShiftLeft') || k.has('ShiftRight'));
      const turn = Number(motions.has('turnLeft')) - Number(motions.has('turnRight'));
      if (turn) workshop.current?.lookFreeCamera(turn * delta, 0);
      workshop.current?.renderFreeCamera();
      animation = requestAnimationFrame(frame);
    };
    const stop = () => {
      clear(); previous = 0; cancelAnimationFrame(animation); animation = 0;
      if (document.pointerLockElement === viewport.current) document.exitPointerLock();
    };
    const visibility = () => { stop(); if (engaged()) animation = requestAnimationFrame(frame); };
    const blur = () => { clear(); if (document.pointerLockElement === viewport.current) document.exitPointerLock(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && document.pointerLockElement === viewport.current) {
        clear(); document.exitPointerLock(); return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
      if (!engaged() || event.isComposing || !(document.activeElement === viewport.current || document.pointerLockElement === viewport.current)) return;
      if (keys.has(event.code)) { event.preventDefault(); held.current.add(event.code); }
    };
    const keyup = (event: KeyboardEvent) => { held.current.delete(event.code); };
    const lockchange = () => { setLocked(document.pointerLockElement === viewport.current); clear(); };
    const mousemove = (event: MouseEvent) => {
      if (engaged() && document.pointerLockElement === viewport.current) workshop.current?.lookFreeCamera(-event.movementX * .003, -event.movementY * .003);
    };
    document.addEventListener('keydown', keydown); document.addEventListener('keyup', keyup);
    document.addEventListener('visibilitychange', visibility); document.addEventListener('pointerlockchange', lockchange);
    document.addEventListener('mousemove', mousemove); window.addEventListener('blur', blur);
    if (engaged()) animation = requestAnimationFrame(frame); else stop();
    return () => {
      stop(); document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('pointerlockchange', lockchange);
      document.removeEventListener('mousemove', mousemove); window.removeEventListener('blur', blur);
    };
  }, [active, ready]);

  const dragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || !ready || event.button !== 0) return;
    event.currentTarget.focus();
    if (document.pointerLockElement === viewport.current) return;
    event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const dragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!active || !start || start.id !== event.pointerId) return;
    workshop.current?.lookFreeCamera(-(event.clientX - start.x) * .005, -(event.clientY - start.y) * .005);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const control = (motion: Motion, label: string, glyph: string) => <button type="button" disabled={!active || !ready} aria-label={label} title={label}
    onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); touch.current.set(event.pointerId, motion); }}
    onPointerUp={event => touch.current.delete(event.pointerId)} onPointerCancel={clear}
    onLostPointerCapture={event => touch.current.delete(event.pointerId)} onBlur={clear}
    onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); touch.current.set(-1, motion); } }}
    onKeyUp={() => touch.current.delete(-1)}>{glyph}</button>;
  const point=(event:ReactPointerEvent<HTMLDivElement>)=>{const rect=event.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};};
  const selectionBox=(start:{x:number;y:number},end:{x:number;y:number}):NormalizedCaptureBox=>({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)});
  const box=selecting?selection:trackingBox;

  const scenario = workshop.current?.weekendScenario;
  const sceneDisabled = !active || !ready || sceneLocked || selecting;
  const changeScenario = (action: () => void) => { action(); setWeekendRevision(value => value + 1); };
  void weekendRevision;
  const controls=<>    <details className="virtual-camera-navigation"><summary>Move around the {storage ? 'storage room' : studio ? 'studio' : 'workshop'}</summary><div className="virtual-camera-tools">
      <div className="virtual-camera-move" role="group" aria-label="Hold to move">
        {control('left', 'Move left', '←')}{control('forward', 'Move forward', '↑')}{control('back', 'Move backward', '↓')}{control('right', 'Move right', '→')}
      </div>
      <div className="virtual-camera-move" role="group" aria-label="Hold to turn or change height">
        {control('turnLeft', 'Turn left', '↶')}{control('turnRight', 'Turn right', '↷')}{control('up', 'Fly up', 'Up')}{control('down', 'Fly down', 'Down')}
      </div>
      <button type="button" disabled={!active || !ready} onClick={() => { clear(); workshop.current?.resetFreeCamera(); }}>Reset view</button>
      <button type="button" disabled={!active || !ready||selecting} onClick={async () => {
        if (locked) { document.exitPointerLock(); return; }
        viewport.current?.focus();
        try { await viewport.current?.requestPointerLock(); } catch { setError('Mouse lock is unavailable. Drag the camera view to look around.'); }
      }}>{locked ? 'Release mouse (Esc)' : 'Lock mouse'}</button>
    </div>
    <p id={instructions} className="virtual-camera-help">Drag to look. Focus the view, then use W A S D to fly, Space to rise, Q or Ctrl to descend, and Shift to move faster. Esc releases mouse lock. On touch, hold the buttons to move or turn.</p></details>
    {weekend ? <details className="virtual-camera-demo"><summary>Box scenario</summary>
      <p>Change the scene, then scan to update memory. Resetting the scene does not reset memory.</p>
      <div className="virtual-camera-tools weekend-scenario-tools">
        <button type="button" disabled={sceneDisabled} onClick={()=>workshop.current?.setWeekendView('packing')}>Packing view</button>
        <button type="button" disabled={sceneDisabled} onClick={()=>workshop.current?.setWeekendView('shelf')}>Shelf view</button>
        <button type="button" disabled={sceneDisabled || !scenario || scenario.boxReplaced} onClick={()=>changeScenario(()=>scenario?.toggleOpen())}>{scenario?.open ? 'Close box' : 'Open box'}</button>
        <button type="button" disabled={sceneDisabled || !scenario || !scenario.open || scenario.chargerOut || scenario.boxReplaced} onClick={()=>changeScenario(()=>scenario?.takeCharger())}>Take charger out</button>
        <button type="button" disabled={sceneDisabled || !scenario || scenario.boxOnShelf || scenario.boxReplaced} onClick={()=>changeScenario(()=>scenario?.moveBox())}>Move box to shelf</button>
        <button type="button" disabled={sceneDisabled || !scenario || scenario.open || scenario.boxReplaced} onClick={()=>changeScenario(()=>scenario?.replaceBox())}>Replace box</button>
        <button type="button" disabled={sceneDisabled || !scenario} onClick={()=>changeScenario(()=>scenario?.reset())}>Reset scene</button>
      </div>
      {scenario && <p role="status">Simulated scene: Box {scenario.open ? 'open' : 'closed'} · Charger {scenario.chargerOut ? 'out' : 'inside'} · Box {scenario.boxOnShelf ? 'on shelf' : 'at packing area'}{scenario.boxReplaced ? ' · Replacement' : ''}</p>}
      {sceneLocked && <p>Finish the scan or guided capture before changing the scene.</p>}
    </details> : storage ? <details className="virtual-camera-demo"><summary>Demo controls</summary><p>Change the virtual scene. Saved views and memory stay unchanged.</p><div className="virtual-camera-tools"><button type="button" disabled={!active||!ready||sceneLocked||selecting} onClick={()=>workshop.current?.setStorageView('packing')}>Packing view</button><button type="button" disabled={!active||!ready||sceneLocked||selecting} onClick={()=>workshop.current?.setStorageView('shelf')}>Shelf view</button><button type="button" disabled={!active||!ready||sceneLocked||selecting} onClick={()=>{workshop.current?.storageRoom?.toggleOpen();setSceneState(s=>s==='original'?'scenario':'original');}}>Open / Close boxes</button><button type="button" disabled={!active||!ready||sceneLocked||selecting} onClick={()=>{workshop.current?.storageRoom?.moveBox();setSceneState('moved');}}>Move box</button><button type="button" disabled={!active||!ready||sceneLocked||selecting} onClick={()=>{workshop.current?.storageRoom?.takeCharger();setSceneState('replaced');}}>Take charger out</button><button type="button" disabled={!active||!ready||sceneLocked||selecting} onClick={()=>{workshop.current?.storageRoom?.reset();setSceneState('original');}}>Reset scene</button></div>{sceneLocked&&<p>Finish the scan or guided capture before changing the scene.</p>}</details> : <details className="virtual-camera-demo"><summary>Demo controls</summary><p>Change the virtual scene for a demonstration. Saved views and memory stay unchanged.</p><div className="virtual-camera-tools"><button type="button" disabled={!active||!ready||sceneLocked||selecting} onClick={()=>{demoScene.current?.moveDrill();setSceneState(state=>state==='replaced'?'replaced':state==='scenario'||state==='scenario-moved'?'scenario-moved':'moved');}}>Move drill</button><button type="button" disabled={!active||!ready||sceneLocked||selecting} onClick={()=>{demoScene.current?.replaceDrill();setSceneState('replaced');}}>Replace drill</button><button type="button" disabled={!active||!ready||sceneLocked||selecting} onClick={()=>{demoScene.current?.resetScene();setSceneState('original');}}>Reset scene</button></div><p role="status">{sceneState==='original'?'Original scene':sceneState==='replaced'?'Drill replaced':sceneState==='moved'?'Drill moved':sceneState==='scenario-moved'?'Alternative scene · drill moved':'Alternative scene'}</p>{sceneLocked&&<p>Finish the scan or guided capture before changing the scene.</p>}</details>}</>;
  return <section className="virtual-camera" aria-label={storage ? 'Live virtual storage room' : studio ? 'Live virtual model maker studio' : 'Live virtual workshop'}>
    <div className="virtual-camera-viewport" ref={viewport} tabIndex={active && ready ? 0 : -1} aria-label={`${studio ? 'Studio' : 'Workshop'} camera. Focus to move and drag to look.`} aria-describedby={instructions}
      onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={clear} onLostPointerCapture={() => { drag.current = null; }} onBlur={clear}>
      <div className="virtual-camera-frame"><div className="virtual-camera-render" ref={host} />
      <span className="virtual-camera-live">{active ? 'Virtual camera' : 'Camera paused'}</span>
      {selecting&&<div className="virtual-camera-select" role="group" aria-label="Select the requested target: drag a rectangle around it" onPointerDown={event=>{if(!active||!ready||event.button!==0)return;event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);selectionStart.current={id:event.pointerId,...point(event)};setSelection(null);}}
        onPointerMove={event=>{event.stopPropagation();const start=selectionStart.current;if(start?.id===event.pointerId)setSelection(selectionBox(start,point(event)));}}
        onPointerUp={event=>{event.stopPropagation();const start=selectionStart.current;selectionStart.current=null;if(start?.id===event.pointerId){const next=selectionBox(start,point(event));setSelection(null);onSelect?.(next);}}}
        onPointerCancel={event=>{event.stopPropagation();selectionStart.current=null;setSelection(null);}} onLostPointerCapture={()=>{selectionStart.current=null;}}><span>Drag a box around the requested target</span></div>}
      {box&&<div className={`virtual-camera-track ${selecting?'is-selecting':''}`} style={{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.width*100}%`,height:`${box.height*100}%`}}>{!selecting&&trackingLabel&&<span>{trackingLabel}</span>}</div>}
      </div>
      {error && <p role="alert" className="virtual-camera-error">{error}</p>}
    </div>
    {toolsHost?createPortal(controls,toolsHost):controls}
  </section>;
});
