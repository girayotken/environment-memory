import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePhoneFrame, applyPhoneProjection, PHONE_CAPTURE_ASPECT, PHONE_CAPTURE_VERTICAL_FOV } from '../src/client/phone-capture.ts';

test('phone capture renders at portrait sensor resolution and restores preview pixel ratio and size', () => {
  let ratio = 1.5, size = [120, 213];
  const frames: Array<{ratio:number;size:number[]}> = [];
  const renderer = { getPixelRatio: () => ratio, setPixelRatio: (v:number) => { ratio = v; }, setSize: (w:number,h:number) => { size = [w,h]; }, domElement: { toDataURL: (type:string) => { assert.equal(type,'image/png'); return 'image'; } } };
  const result = capturePhoneFrame(renderer,120,213,() => frames.push({ratio,size:[...size]}));
  assert.deepEqual(result,{imageDataUrl:'image',width:1080,height:1920});
  assert.equal(PHONE_CAPTURE_ASPECT,9/16); assert.equal(PHONE_CAPTURE_VERTICAL_FOV,70);
  assert.deepEqual(frames,[{ratio:1,size:[1080,1920]},{ratio:1.5,size:[120,213]}]);
});

test('phone capture restores preview after encoding fails', () => {
  let ratio = 2, size = [90,160], renders = 0;
  const renderer = { getPixelRatio: () => ratio, setPixelRatio: (v:number) => { ratio = v; }, setSize: (w:number,h:number) => { size = [w,h]; }, domElement: { toDataURL: () => { throw new Error('encoding failed'); } } };
  assert.throws(() => capturePhoneFrame(renderer,90,160,() => { renders++; }), /encoding failed/);
  assert.equal(ratio,2); assert.deepEqual(size,[90,160]); assert.equal(renders,2);
});

test('capture store accepts portrait sensor dimensions and rejects larger images', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { PNG } = await import('pngjs');
  const { CaptureStore } = await import('../src/server/capture-store.ts');
  const dir = mkdtempSync(join(tmpdir(),'phone-capture-'));
  const store = new CaptureStore(dir);
  const frame = (id:string, width:number, height:number) => ({ id, sessionId:'session', capturedAt:'2026-11-01T00:00:00.000Z', imageDataUrl:`data:image/png;base64,${PNG.sync.write(new PNG({width,height})).toString('base64')}` });
  try {
    const saved = store.import({importId:'phone',frames:[frame('portrait',1080,1920)]});
    assert.equal(saved[0].width,1080); assert.equal(saved[0].height,1920);
    const { validateRoomObserverInput } = await import('../src/server/room-observer-provider.ts');
    const bytes = store.asset(saved[0].sourceHash)!;
    validateRoomObserverInput({frame:saved[0],frameBytes:bytes,references:[],room:{graph:{sourceViews:[]},visits:[]}} as unknown as Parameters<typeof validateRoomObserverInput>[0]);
    assert.throws(() => store.import({importId:'too-large',frames:[frame('large',1,1921)]}), /dimensions exceed/);
  } finally { store.close(); rmSync(dir,{recursive:true,force:true}); }
});


test('phone projection remains stable across preview fits and full-resolution capture', async () => {
  const { PerspectiveCamera } = await import('three');
  const camera = new PerspectiveCamera(40, 2, .05, 35);
  applyPhoneProjection(camera);
  const projection = camera.projectionMatrix.toArray();
  const renderer = { getPixelRatio: () => 1, setPixelRatio: (_v:number) => {}, setSize: (_w:number,_h:number) => {}, domElement: { toDataURL: () => 'image' } };
  capturePhoneFrame(renderer,120,213,() => assert.deepEqual(camera.projectionMatrix.toArray(),projection));
  applyPhoneProjection(camera);
  assert.deepEqual(camera.projectionMatrix.toArray(),projection);
  assert.equal(camera.fov,70); assert.equal(camera.aspect,9/16); assert.equal(camera.zoom,1);
});
