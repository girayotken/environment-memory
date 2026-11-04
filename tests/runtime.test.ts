import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';
import { FrameSchema, makeCapture } from '../src/domain/contracts.ts';
import { Store } from '../src/server/store.ts';
import { mockObservation, observationRequest } from '../src/server/observer.ts';
import { createApp } from '../src/server/app.ts';
import { examples } from '../src/domain/examples.ts';
import { buildMemory } from '../src/domain/memory.ts';

// A real 64x64 PNG created without image-library or browser dependencies.
function png() {
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(64 * (1 + 64 * 3), 0))), chunk('IEND', Buffer.alloc(0))]);
}
const bytes = png();
const pixels = { imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width: 64, height: 64 };
const frame = () => makeCapture(pixels, 'bench');
const temporary = () => mkdtempSync(join(tmpdir(), 'environment-memory-'));

test('frame boundary rejects simulator truth and unknown metadata', () => {
  const valid = frame();
  for (const key of ['objects', 'transforms', 'scenario', 'groundTruth']) assert.equal(FrameSchema.safeParse({ ...valid, [key]: 'secret-evaluator-value' }).success, false);
  assert.deepEqual(Object.keys(valid).sort(), ['capturedAt', 'frameId', 'height', 'imageDataUrl', 'source', 'width', 'zone']);
});
test('persistence keeps exact evidence across reopen; duplicate capture is idempotent', () => {
  const directory = temporary(); let store = new Store(directory);
  try {
    const input = frame(), saved = store.saveFrame(input);
    assert.deepEqual(store.saveFrame(input), saved); assert.equal(store.listFrames().length, 1);
    assert.throws(() => store.saveFrame({ ...input, zone: 'storage' }), /conflict/);
    assert.throws(() => store.saveFrame({ ...frame(), imageDataUrl: 'data:image/png;base64,YmFk' }), /signature/);
    store.close(); store = new Store(directory);
    assert.deepEqual(store.getImage(saved.id)?.bytes, bytes); assert.equal(store.getFrame(saved.id)?.imageHash, saved.imageHash);
    assert.equal(store.listFrames().length, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('invalid or partial observations cannot replace prior evidence', () => {
  const directory = temporary(), store = new Store(directory);
  try {
    const saved = store.saveFrame(frame()), run = mockObservation(saved.id);
    const committed = store.saveRun(run);
    assert.equal(store.saveRun(mockObservation(saved.id)).id, committed.id);
    const invalid = { ...run, mode: 'live' as const, id: randomUUID(), observations: { summary: 'partial', objects: [{ label: 'truncated' }] } };
    assert.throws(() => store.saveRun(invalid as typeof run));
    assert.equal(store.findRun(saved.id, 'live'), null); assert.deepEqual(store.findRun(saved.id, 'mock'), committed);
    assert.deepEqual(store.getImage(saved.id)?.bytes, bytes);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('provider payload is independent of hidden runtime fields', () => {
  const input = { zone: 'bench' as const, capturedAt: new Date().toISOString(), objects: 'HIDDEN_OBJECTS', transforms: 'HIDDEN_TRANSFORMS', scenario: 'HIDDEN_SCENARIO' };
  const serialized = JSON.stringify(observationRequest(input, pixels.imageDataUrl));
  for (const secret of ['HIDDEN_OBJECTS', 'HIDDEN_TRANSFORMS', 'HIDDEN_SCENARIO']) assert.equal(serialized.includes(secret), false);
  assert.ok(serialized.includes(pixels.imageDataUrl)); assert.ok(serialized.includes(input.capturedAt));
  assert.equal(observationRequest(input, pixels.imageDataUrl).store, false);
});
test('HTTP slice saves, reopens exact image, labels fixture, gates live calls and rejects external origins', async () => {
  const directory = temporary(), app = createApp(directory);
  const previous = process.env.ENABLE_LIVE_META_API; process.env.ENABLE_LIVE_META_API = 'false';
  try {
    const input = frame(), saved = await app.inject({ method: 'POST', url: '/api/frames', payload: input });
    assert.equal(saved.statusCode, 201); const id = saved.json().id;
    const image = await app.inject(`/api/frames/${id}/image`); assert.equal(image.statusCode, 200); assert.deepEqual(image.rawPayload, bytes);
    const sample = await app.inject({ method: 'POST', url: `/api/frames/${id}/observe`, payload: { mode: 'mock' } });
    assert.equal(sample.statusCode, 200); assert.equal(sample.json().mode, 'mock'); assert.match(sample.json().observations.summary, /not inferred/);
    const duplicate = await app.inject({ method: 'POST', url: `/api/frames/${id}/observe`, payload: { mode: 'mock' } });
    assert.equal(duplicate.json().id, sample.json().id);
    const live = await app.inject({ method: 'POST', url: `/api/frames/${id}/observe`, payload: { mode: 'live' } }); assert.equal(live.statusCode, 412);
    assert.equal((await app.inject({ method: 'GET', url: '/api/frames', headers: { origin: 'https://untrusted.example' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/frames', payload: { ...frame(), groundTruth: [] } })).statusCode, 400);
    assert.equal((await app.inject(`/api/frames/${randomUUID()}/image`)).statusCode, 404);
    assert.equal((await app.inject('/api/frames/not-an-id/image')).statusCode, 400);
    assert.equal((await app.inject('/api/frames')).json().length, 1);
  } finally { if (previous === undefined) delete process.env.ENABLE_LIVE_META_API; else process.env.ENABLE_LIVE_META_API = previous; await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('replay import is strict, immutable, idempotent, source separated and survives reopen', async () => {
  const directory = temporary(), app = createApp(directory);
  let id: string;
  try {
    id = (await app.inject({ method: 'POST', url: '/api/frames', payload: frame() })).json().id;
    const url = `/api/frames/${id}/replay`, payload = examples.baseline.data;
    const result = await app.inject({ method: 'POST', url, payload }); assert.equal(result.statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url, payload })).json().id, result.json().id);
    assert.equal((await app.inject({ method: 'POST', url, payload: examples.moved.data })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url, payload: { ...payload, groundTruth: [] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url, payload: { ...payload, provenance: undefined } })).statusCode, 400);
    const live = (await app.inject('/api/memory?stream=live')).json(); assert.equal(live.items.length, 0);
    const authored = (await app.inject(`/api/memory?stream=authored&after=${id}`)).json();
    assert.equal(authored.items.length, 2); assert.equal(authored.items[0].lastSeen.frameId, id);
    assert.equal((await app.inject('/api/memory?stream=not-a-source')).statusCode, 400);
  } finally { await app.close(); }
  const store = new Store(directory);
  try { assert.equal(buildMemory(store.analyzedFrames(), 'authored').items.length, 2); assert.equal(store.getFrame(id!)?.run?.provenance, 'authored_fixture'); }
  finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('legacy database upgrade preserves frames and previous mock runs', () => {
  const directory = temporary(); let store = new Store(directory);
  const saved = store.saveFrame(frame()), run = store.saveRun(mockObservation(saved.id)); store.close();
  const legacy = new DatabaseSync(join(directory, 'memory.sqlite')); legacy.exec('ALTER TABLE runs DROP COLUMN provenance'); legacy.close();
  store = new Store(directory);
  try { assert.equal(store.getFrame(saved.id)?.run?.id, run.id); assert.deepEqual(store.getImage(saved.id)?.bytes, bytes); assert.equal(store.analyzedFrames().length, 1); }
  finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('configured loopback workspace accepts its own origin while other ports and remote origins remain rejected', async () => {
  const directory = temporary(), app = createApp(directory, { port: 7385 });
  try {
    const saved = await app.inject({ method: 'POST', url: '/api/frames', headers: { origin: 'http://localhost:7385' }, payload: frame() });
    assert.equal(saved.statusCode, 201);
    for (const origin of ['http://localhost:7386','https://example.invalid'])
      assert.equal((await app.inject({ method: 'POST', url: '/api/frames', headers: { origin }, payload: frame() })).statusCode, 403);
    assert.equal((await app.inject('/api/frames')).json().length, 1);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
