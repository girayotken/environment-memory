import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { VirtualCameraHandle, VirtualCameraProps } from './VirtualCamera.tsx';
import { cameraFrameSize, createCameraLease } from './real-phone-camera.ts';
import './phone-camera.css';

/** Real device camera. Permission is requested only after the user opens it. */
export const PhoneCamera = forwardRef<VirtualCameraHandle, VirtualCameraProps>(function PhoneCamera({active, onReady}, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const lease = useRef(createCameraLease());
  const liveStream = useRef<MediaStream | null>(null);
  const activeRef = useRef(active), readyRef = useRef(false), callback = useRef(onReady), requestId = useRef(0);
  const [ready, setReady] = useState(false), [opening, setOpening] = useState(false), [error, setError] = useState('');
  const [dimensions, setDimensions] = useState(''), [facing, setFacing] = useState('');
  activeRef.current = active; callback.current = onReady;
  const markReady = (value: boolean) => { readyRef.current = value; setReady(value); callback.current?.(value); };
  const close = () => { requestId.current++; liveStream.current = null; lease.current.close(); setDimensions(''); if (video.current) video.current.srcObject = null; markReady(false); setOpening(false); };
  useEffect(() => { if (!active) close(); }, [active]);
  useEffect(() => {
    const visibility = () => { if (document.hidden) close(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); requestId.current++; liveStream.current = null; lease.current.close(); if (video.current) video.current.srcObject = null; callback.current?.(false); };
  }, []);
  const frame = () => {
    const source = video.current;
    return activeRef.current && !document.hidden && readyRef.current && source && source.srcObject === liveStream.current && liveStream.current && source.videoWidth && source.videoHeight && source.readyState >= 2 ? source : null;
  };
  useImperativeHandle(ref, () => ({
    capture() {
      const source = frame(); if (!source) return null;
      let {width, height} = cameraFrameSize(source.videoWidth, source.videoHeight);
      const canvas = document.createElement('canvas');
      for (let i = 0; i < 8; i++) {
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d'); if (!context) return null;
        context.drawImage(source, 0, 0, width, height);
        const imageDataUrl = canvas.toDataURL('image/png');
        // Base64 represents at most three bytes per four characters.
        if ((imageDataUrl.length - imageDataUrl.indexOf(',') - 1) * 3 / 4 <= 8 * 1024 * 1024) return {imageDataUrl, capturedAt: new Date().toISOString()};
        width = Math.max(1, Math.round(width * .8)); height = Math.max(1, Math.round(height * .8));
      }
      return null;
    },
    reset() {},
    samplePixels() {
      const source = frame(); if (!source) return null;
      const {width, height} = cameraFrameSize(source.videoWidth, source.videoHeight, 320);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', {willReadFrequently:true}); if (!context) return null;
      context.drawImage(source, 0, 0, width, height);
      return {width, height, data:context.getImageData(0, 0, width, height).data};
    },
  }), []);
  const open = async () => {
    if (!active || document.hidden || opening) return;
    const ticket = ++requestId.current;
    setError(''); setOpening(true); markReady(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const stream = await lease.current.open(() => navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{exact:'environment'}, width:{ideal:1920}, height:{ideal:1080}}}));
      if (!stream || !video.current || ticket !== requestId.current) return;
      const track = stream.getVideoTracks()[0];
      if (!track || track.getSettings().facingMode === 'user') { lease.current.close(); throw new Error('rear-unavailable'); }
      setFacing(track.getSettings().facingMode === 'environment' ? 'Rear camera' : 'Camera direction unreported');
      liveStream.current = stream;
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (ticket === requestId.current) close(); }, {once:true}));
      video.current.srcObject = stream;
      await video.current.play();
    } catch (cause) {
      if (ticket === requestId.current) { liveStream.current = null; lease.current.close(); if (video.current) video.current.srcObject = null;
        setError(cause instanceof Error && (cause.name === 'OverconstrainedError' || cause.message === 'rear-unavailable') ? 'A rear camera is not available on this device.' : 'Could not open the camera. Check camera permission and try again.'); }
    } finally { if (ticket === requestId.current) setOpening(false); }
  };
  const updateFrame = (source: HTMLVideoElement) => {
    if (!activeRef.current || document.hidden || !liveStream.current || source.srcObject !== liveStream.current || !source.videoWidth || !source.videoHeight || source.readyState < 2) return;
    setDimensions(`${source.videoWidth} × ${source.videoHeight}`);
    if (!readyRef.current) markReady(true);
  };
  return <section className="phone-camera" aria-label="Phone camera">
    <div className="phone-camera-frame">
      <video ref={video} autoPlay playsInline muted onLoadedData={event => updateFrame(event.currentTarget)} onResize={event => updateFrame(event.currentTarget)} />
    </div>
    {ready && dimensions && <small className="phone-camera-info">{facing} · {dimensions}</small>}
    {!ready && <div className="phone-camera-controls">
      <p role="status">{opening ? 'Opening camera…' : 'Camera is closed'}</p>
      <button type="button" disabled={!active || opening} onClick={open}>Open camera</button>
      {error && <p role="alert">{error}</p>}
    </div>}
  </section>;
});
