import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {cameraFrameSize, createCameraLease} from '../src/client/real-phone-camera.ts';

test('camera sizing keeps orientation and limits the longer side', () => {
  assert.deepEqual(cameraFrameSize(4000, 3000), {width:1920,height:1440});
  assert.deepEqual(cameraFrameSize(1080, 1920), {width:1080,height:1920});
  assert.deepEqual(cameraFrameSize(1080, 1920, 320), {width:180,height:320});
});

test('closing while permission is pending stops the late stream', async () => {
  let resolve!: (stream: MediaStream) => void, stopped = 0;
  const lease = createCameraLease();
  const pending = lease.open(() => new Promise<MediaStream>(done => {resolve = done;}));
  lease.close();
  resolve({getTracks: () => [{stop: () => stopped++}]} as unknown as MediaStream);
  assert.equal(await pending, null); assert.equal(stopped, 1);
});

test('reopening replaces and stops the old stream', async () => {
  let stopped = 0;
  const stream = () => ({getTracks: () => [{stop: () => stopped++}]} as unknown as MediaStream);
  const lease = createCameraLease(); await lease.open(async () => stream()); await lease.open(async () => stream());
  assert.equal(stopped, 1); lease.close(); assert.equal(stopped, 2);
});
