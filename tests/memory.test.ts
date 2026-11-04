import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildMemory, compareFrames, searchItems, type AnalyzedFrame } from '../src/domain/memory.ts';
import type { Observations } from '../src/domain/contracts.ts';

const object = (label = 'Blue case', locationDescription = 'On the bench', appearance = 'Blue case, black handle, two latches') => ({ label, appearance, locationDescription, uncertainty: 'Authored test; identity unverified.', bbox: null });
const record = (objects: Observations['objects'], time: number, zone: 'bench' | 'storage' = 'bench'): AnalyzedFrame => {
  const id = randomUUID();
  return { frame: { id, capturedAt: new Date(Date.UTC(2026, 9, 27, 10, time)).toISOString(), zone, width:640,height:309,imageUrl: `/api/frames/${id}/image`, imageHash: String(time) },
    run: { id: randomUUID(), frameId: id, mode: 'replay', provenance: 'authored_fixture', model: 'test-only', createdAt: new Date().toISOString(), latencyMs: 0, usage: {}, observations: { summary: 'Test fixture, not inference', objects } } };
};
test('repeat observations link tentatively; duplicate run does not duplicate history', () => {
  const first = record([object()], 1), next = record([object()], 2);
  const view = buildMemory([first, next, next], 'authored');
  assert.equal(view.items.length, 1); assert.equal(view.items[0].history.length, 2); assert.equal(view.analyzedFrames, 2);
  assert.equal(view.items[0].identity, 'tentative'); assert.equal(view.comparison?.changes[0].kind, 'unchanged');
});
test('changed location is only a possibility; absent description retains last-seen evidence', () => {
  const first = record([object(), object('Yellow drill', 'Beside robot', 'Yellow, black base')], 1);
  const next = record([object('Blue case', 'Under the bench')], 2);
  const view = buildMemory([first, next], 'authored');
  assert.deepEqual(view.comparison?.changes.map(c => c.kind), ['possibly_moved', 'not_observed']);
  const drill = searchItems(view.items, 'yellow drill')[0]; assert.equal(drill.lastSeen.frameId, first.frame.id);
  assert.match(view.comparison!.changes[1].explanation, /hidden, out of frame or overlooked/);
  assert.equal(view.comparison!.changes[0].before?.frameId, first.frame.id); assert.equal(view.comparison!.changes[0].after?.frameId, next.frame.id);
});
test('newly observed is not necessarily newly added; other zones never prove absence', () => {
  const first = record([object()], 1), storage = record([], 2, 'storage'), next = record([object(), object('Sensor board')], 3);
  assert.equal(buildMemory([first, storage], 'authored', storage.frame.id).comparison, null);
  const view = buildMemory([first, storage, next], 'authored', next.frame.id);
  assert.equal(view.comparison?.beforeFrameId, first.frame.id); assert.equal(view.comparison?.changes[1].kind, 'newly_observed');
  assert.equal(searchItems(view.items, 'blue case')[0].lastSeen.frameId, next.frame.id);
  assert.equal(buildMemory([first], 'authored', randomUUID()).comparison, null);
});
test('similar objects and changed appearance remain unresolved rather than forced together', () => {
  const first = record([object()], 1), next = record([object(), object('Blue case', 'On shelf')], 2);
  const view = buildMemory([first, next], 'authored');
  assert.equal(view.items.length, 3); assert.ok(view.items.every(i => i.identity === 'unresolved'));
  assert.ok(view.comparison?.changes.every(c => c.kind === 'unresolved'));
  assert.equal(view.items.filter(i => i.candidateItemIds.length).length, 2);
  assert.equal(buildMemory([first, record([object('Blue case', 'On bench', 'Unclear shape')], 3)], 'authored').items.length, 2);
});
test('late old evidence keeps item IDs and does not regress last-seen time', () => {
  const newer = record([object()], 5), old = record([object()], 1);
  const before = buildMemory([newer], 'authored').items[0], after = buildMemory([newer, old], 'authored').items[0];
  assert.equal(before.id, after.id); assert.equal(after.lastSeen.frameId, newer.frame.id);
  assert.deepEqual(after.history.map(h => h.frameId), [old.frame.id, newer.frame.id]);
});
test('live, imported and authored evidence never mix; generic wiring mock is excluded', () => {
  const authored = record([object()], 1), live = record([object('Yellow drill')], 2), imported = record([object('Sensor board')], 3), mock = record([object('Example')], 4);
  live.run.mode = 'live'; delete live.run.provenance;
  imported.run.provenance = 'imported_model_output'; mock.run.mode = 'mock'; delete mock.run.provenance;
  const all = [authored, live, imported, mock];
  assert.deepEqual(buildMemory(all, 'live').items.map(i => i.label), ['Yellow drill']);
  assert.deepEqual(buildMemory(all, 'authored').items.map(i => i.label), ['Blue case']);
  assert.deepEqual(buildMemory(all, 'imported').items.map(i => i.label), ['Sensor board']);
  assert.throws(() => compareFrames(authored, live), /same zone, dimensions and evidence source/);
});
test('identical pixels with differing descriptions cannot establish a physical change', () => {
  const first = record([object()], 1), next = record([object('Blue case', 'Under bench'), object('Sensor')], 2);
  next.frame.imageHash = first.frame.imageHash;
  const comparison = compareFrames(first, next);
  assert.equal(comparison.samePixels, true); assert.ok(comparison.changes.every(c => c.kind === 'unresolved'));
});
test('last-seen search is token based and evidence linked, including ambiguous candidates', () => {
  const view = buildMemory([record([object(), object('Red case', 'On shelf', 'Red with silver latches')], 1)], 'authored');
  assert.equal(searchItems(view.items, 'BLUE LATCHES').length, 1); assert.equal(searchItems(view.items, 'green').length, 0);
  assert.ok(searchItems(view.items, 'blue')[0].lastSeen.imageUrl.startsWith('/api/frames/'));
});
test('resolution experiment is not a comparable visit; skip it for a later matching-size comparison',()=>{
  const first=record([object()],1),small=record([object('Blue box')],2),next=record([object('Blue case','Under bench')],3);
  small.frame.width=320;small.frame.height=155;
  assert.equal(buildMemory([first,small],'authored',small.frame.id).comparison,null);
  assert.throws(()=>compareFrames(first,small),/dimensions/);
  assert.equal(buildMemory([first,small,next],'authored',next.frame.id).comparison?.beforeFrameId,first.frame.id);
});
